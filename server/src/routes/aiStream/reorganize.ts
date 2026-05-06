import { Router } from 'express';
import { query } from '../../db.js';
import { reorganizeWeight } from '../../lib/aiCreditWeights.js';
import { aiRouteHandler } from '../../lib/aiRouteHandler.js';
import { TagProposalSchema } from '../../lib/aiSchemas.js';
import { initSseResponse, streamAiToWriter } from '../../lib/aiStream.js';
import { resolveUserModel, streamOpts } from '../../lib/aiStreamHandler.js';
import { buildTagSuggestionPrompt, type TagSuggestionBin } from '../../lib/buildTagSuggestionPrompt.js';
import { config, isDemoUser } from '../../lib/config.js';
import { ValidationError } from '../../lib/httpErrors.js';
import { assertReorganizeBinLimit, refundAiCredit } from '../../lib/planGate.js';
import { aiRateLimiters } from '../../lib/rateLimiters.js';
import { detectReorganizeMismatch } from '../../lib/reorganizeMismatch.js';
import { buildReorganizePrompt } from '../../lib/reorganizePrompt.js';
import { requireLocationMemberOrAbove } from '../../middleware/locationAccess.js';
import { checkAiCredits, requireAiAccess, requirePlusOrAbove } from '../../middleware/requirePlan.js';
import { MAX_TAG_BINS_PER_STREAM, reorganizeBinCountFromReq, sendMockJsonStream } from './helpers.js';

const router = Router();

// POST /api/ai/reorganize/stream
router.post('/reorganize/stream', ...aiRateLimiters, requirePlusOrAbove(), requireAiAccess(), checkAiCredits((req) => reorganizeWeight(reorganizeBinCountFromReq(req))), requireLocationMemberOrAbove(), aiRouteHandler('stream reorganization', async (req, res) => {
  const { bins: inputBins, maxBins, areaName, userNotes, strictness, granularity,
    ambiguousPolicy, duplicates, outliers, minItemsPerBin, maxItemsPerBin } = req.body;

  if (!Array.isArray(inputBins) || inputBins.length === 0) {
    throw new ValidationError('bins array is required');
  }
  if (maxBins != null && (typeof maxBins !== 'number' || maxBins < 1)) {
    throw new ValidationError('maxBins must be a positive number');
  }
  await assertReorganizeBinLimit(req.user!.id, inputBins.length, res.locals.planInfo);

  const { settings, model } = await resolveUserModel(req.user!.id, 'reorganization', isDemoUser(req));
  const { system, userContent } = buildReorganizePrompt({
    inputBins, maxBins, areaName, userNotes, strictness, granularity, ambiguousPolicy,
    duplicates, outliers, minItemsPerBin, maxItemsPerBin,
    reorganizationPromptOverride: settings.reorganization_prompt,
    demo: isDemoUser(req),
  });

  if (config.aiMock) {
    await sendMockJsonStream(res, {
      bins: [{ name: 'Reorganized Bin', items: inputBins.flatMap((b: { items: string[] }) => b.items) }],
      summary: 'Mock reorganization result.',
    });
    return;
  }

  // Retry up to 3 times if the AI drops or invents items (per-item identity, not just totals)
  const MAX_ATTEMPTS = 3;
  const writeEvent = initSseResponse(res);
  const sOpts = streamOpts(settings, req, { temperature: 0.2, maxTokens: 16000 });
  const allowDupes = ambiguousPolicy === 'multi-bin' || duplicates === 'allow';
  const inputItemNames = inputBins.flatMap((b: { items?: string[] }) => b.items ?? []);
  let finalText: string | null = null;
  let mismatch = false;

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) writeEvent({ type: 'retry', attempt });

      finalText = await streamAiToWriter(writeEvent, model, { system, userContent, ...sOpts });

      if (!finalText) break; // upstream stream error or truncation — error already surfaced

      let outputItemNames: string[];
      try {
        const parsed = JSON.parse(finalText);
        outputItemNames = Array.isArray(parsed.bins)
          ? parsed.bins.flatMap((b: { items?: string[] }) => b.items ?? [])
          : [];
      } catch {
        finalText = null;
        break;
      }

      const result = detectReorganizeMismatch(inputItemNames, outputItemNames, { allowDupes });
      mismatch = result.mismatch;

      if (!mismatch) break; // per-item preservation satisfied — done
    }

    if (!finalText) {
      // Upstream error / parse failure. streamAiToWriter already surfaced an error event.
      return;
    }

    if (mismatch) {
      writeEvent({
        type: 'error',
        message: "Couldn't preserve all items after 3 attempts. Try adjusting options or regenerate.",
      });
      await refundAiCredit(req.user!.id, res.locals.aiCreditWeight ?? 1);
    } else {
      writeEvent({ type: 'done', text: finalText });
    }
  } finally {
    res.end();
  }
}));

// POST /api/ai/reorganize-tags/stream
router.post('/reorganize-tags/stream', ...aiRateLimiters, requirePlusOrAbove(), requireAiAccess(), checkAiCredits((req) => reorganizeWeight(reorganizeBinCountFromReq(req))), requireLocationMemberOrAbove(), aiRouteHandler('stream tag suggestions', async (req, res) => {
  const { bins: inputBins, locationId, changeLevel, granularity, maxTagsPerBin, userNotes } = req.body ?? {};

  if (!Array.isArray(inputBins) || inputBins.length === 0) throw new ValidationError('bins array is required');
  if (inputBins.length > MAX_TAG_BINS_PER_STREAM) throw new ValidationError(`At most ${MAX_TAG_BINS_PER_STREAM} bins per run`);
  await assertReorganizeBinLimit(req.user!.id, inputBins.length, res.locals.planInfo);
  if (!['additive', 'moderate', 'full'].includes(changeLevel)) throw new ValidationError('changeLevel must be additive, moderate, or full');
  if (!['broad', 'medium', 'specific'].includes(granularity)) throw new ValidationError('granularity must be broad, medium, or specific');
  if (maxTagsPerBin != null && (typeof maxTagsPerBin !== 'number' || maxTagsPerBin < 1 || maxTagsPerBin > 10)) {
    throw new ValidationError('maxTagsPerBin must be between 1 and 10');
  }

  const bins: TagSuggestionBin[] = inputBins.map((b: any) => ({
    id: String(b.id ?? ''),
    name: String(b.name ?? ''),
    items: Array.isArray(b.items) ? b.items.map((i: unknown) => String(i)) : [],
    tags: Array.isArray(b.tags) ? b.tags.map((t: unknown) => String(t)) : [],
    areaName: b.areaName ? String(b.areaName) : null,
  }));

  const availableTagsRows = await query<{ tag: string; parent: string | null }>(
    `SELECT tag, parent_tag AS parent FROM tag_colors WHERE location_id = $1 ORDER BY tag`,
    [locationId],
  );
  const availableTags = availableTagsRows.rows.map((r) => ({ tag: r.tag, parent: r.parent }));

  const inputBinIds = new Set(bins.map((b) => b.id));

  const { settings, model } = await resolveUserModel(req.user!.id, 'tagSuggestion', isDemoUser(req));
  const { system, userContent } = buildTagSuggestionPrompt({
    inputBins: bins,
    availableTags,
    changeLevel,
    granularity,
    maxTagsPerBin,
    userNotes,
    promptOverride: settings.tag_suggestion_prompt ?? null,
    demo: isDemoUser(req),
  });

  if (config.aiMock) {
    await sendMockJsonStream(res, {
      taxonomy: { newTags: [], renames: [], merges: [], parents: [] },
      assignments: bins.slice(0, 1).map((b) => ({ binId: b.id, add: ['tools'], remove: [] })),
      summary: 'Mock tag suggestion result.',
    });
    return;
  }

  const MAX_ATTEMPTS = 3;
  const writeEvent = initSseResponse(res);
  const sOpts = streamOpts(settings, req, { temperature: 0.2, maxTokens: 8000 });
  let finalText: string | null = null;
  let hardFailure = false;

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) writeEvent({ type: 'retry', attempt });

      finalText = await streamAiToWriter(writeEvent, model, { system, userContent, ...sOpts });
      if (!finalText) break;

      let parsed: unknown;
      try {
        parsed = JSON.parse(finalText);
      } catch {
        if (attempt === MAX_ATTEMPTS) hardFailure = true;
        continue;
      }
      const schemaResult = TagProposalSchema.safeParse(parsed);
      if (!schemaResult.success) {
        if (attempt === MAX_ATTEMPTS) hardFailure = true;
        continue;
      }
      const invalid = schemaResult.data.assignments.filter((a) => !inputBinIds.has(a.binId));
      if (invalid.length > 0) {
        if (attempt === MAX_ATTEMPTS) hardFailure = true;
        continue;
      }

      // Preset enforcement — soft failure: strip and proceed. Per-bin removes
      // are allowed at every level; only taxonomy-wide edits are gated.
      if (changeLevel === 'additive') {
        schemaResult.data.taxonomy.renames = [];
        schemaResult.data.taxonomy.merges = [];
        schemaResult.data.taxonomy.parents = [];
      }

      finalText = JSON.stringify(schemaResult.data);
      break;
    }

    if (hardFailure || !finalText) {
      writeEvent({ type: 'error', message: 'AI returned an invalid response after 3 attempts' });
      await refundAiCredit(req.user!.id, res.locals.aiCreditWeight ?? 1);
      return;
    }

    writeEvent({ type: 'done', text: finalText });
  } finally {
    res.end();
  }
}));

export default router;
