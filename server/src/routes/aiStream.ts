import { Router } from 'express';
import { query } from '../db.js';
import { buildCommandContext, buildInventoryContext, buildPlannerSchemaContext } from '../lib/aiContext.js';
import { reorganizeWeight, visionWeight } from '../lib/aiCreditWeights.js';
import { buildMockAnalysisResult, loadPhotosForAnalysis } from '../lib/aiPhotoLoader.js';
import { buildCorrectionPrompt, buildReanalysisPrompt, buildReanalysisUserContent } from '../lib/aiProviders.js';
import { countPhotoIds, countUploadedFiles, extractPhotoIds, extractUploadedFiles, sanitizePreviousResult, validatePreviousResult } from '../lib/aiRequestHelpers.js';
import { aiRouteHandler, validateTextInput } from '../lib/aiRouteHandler.js';
import { sanitizeForPrompt } from '../lib/aiSanitize.js';
import { AiSuggestionsSchema, QueryResultSchema, TagProposalSchema } from '../lib/aiSchemas.js';
import { initSseResponse, pipeAiStreamToResponse, streamAiToWriter } from '../lib/aiStream.js';
import { defaultAnalysisSystem, defaultAnalysisUserContent, resolveUserModel, runAnalysisStream, streamOpts } from '../lib/aiStreamHandler.js';
import { verifyOptionalLocationMembership } from '../lib/binAccess.js';
import { buildTagSuggestionPrompt, type TagSuggestionBin } from '../lib/buildTagSuggestionPrompt.js';
import type { CommandRequest } from '../lib/commandParser.js';
import { buildSystemPrompt as buildCommandSysPrompt, buildUserMessage as buildCommandUserMsg, buildUnifiedSystemPrompt } from '../lib/commandParser.js';
import { config, isDemoUser } from '../lib/config.js';
import { parseHistoryFromBody } from '../lib/conversationHistory.js';
import { ForbiddenError, ValidationError } from '../lib/httpErrors.js';
import { classifyIntent } from '../lib/intentClassifier.js';
import { buildSystemPrompt as buildQuerySysPrompt, buildUserMessage as buildQueryUserMsg, enrichQueryMatches, type RawMatch } from '../lib/inventoryQuery.js';
import { assertReorganizeBinLimit, refundAiCredit } from '../lib/planGate.js';
import { buildPlannerSystemPrompt, buildPlannerUserMessage, QueryPlanSchema, validateQueryPlan } from '../lib/queryPlan.js';
import { executeQueryPlan } from '../lib/queryPlanExecutor.js';
import { aiRateLimiters } from '../lib/rateLimiters.js';
import { detectReorganizeMismatch } from '../lib/reorganizeMismatch.js';
import { buildReorganizePrompt } from '../lib/reorganizePrompt.js';
import { resolveBinCodes } from '../lib/resolveBinCode.js';
import { buildPrompt as buildStructurePrompt, STRUCTURE_TEXT_TOKENS } from '../lib/structureText.js';
import { demoMemoryPhotoUpload, memoryPhotoUpload } from '../lib/uploadConfig.js';
import { authenticate } from '../middleware/auth.js';
import { demoConnectionLimiter, isDemoUser as isDemoConn } from '../middleware/demoConnectionLimiter.js';
import { requireLocationMemberOrAbove } from '../middleware/locationAccess.js';
import { checkAiCredits, requireAiAccess, requirePlusOrAbove } from '../middleware/requirePlan.js';

const streamRouter = Router();
streamRouter.use(authenticate);

const MAX_TAG_BINS_PER_STREAM = 500;

async function sendMockJsonStream(res: import('express').Response, data: object): Promise<void> {
  const writeEvent = initSseResponse(res);
  const json = JSON.stringify(data);
  const chunkSize = 20;
  for (let i = 0; i < json.length; i += chunkSize) {
    writeEvent({ type: 'delta', text: json.slice(i, i + chunkSize) });
    await new Promise((r) => setTimeout(r, 5));
  }
  writeEvent({ type: 'done', text: json });
  res.end();
}

function assertBinsFound(binIds: string[] | undefined, bins: { length: number }): void {
  if (binIds?.length && bins.length === 0) {
    throw new ValidationError('No matching bins found for the provided IDs');
  }
}

function makeQueryEnrichResult(locationId: string, userId: string) {
  return async (parsed: unknown) => {
    const r = parsed as { answer?: string; matches?: unknown[] };
    const matches = Array.isArray(r.matches) ? (r.matches as RawMatch[]) : [];
    const enriched = await enrichQueryMatches(matches, locationId, userId);
    return { answer: r.answer ?? '', matches: enriched };
  };
}

/**
 * Rewrite AI-emitted `bin_code` / `target_bin_code` to UUID `bin_id` /
 * `target_bin_id`. Actions whose bin_code doesn't resolve are dropped so a
 * phantom bin never reaches /api/batch. An unresolved `target_bin_code`
 * drops only the target fields so return_item falls back to the origin bin.
 * The unified /ask prompt can also emit query-shape responses, so matches
 * are enriched here too.
 */
function makeCommandEnrichResult(locationId: string, userId: string) {
  return async (parsed: unknown) => {
    if (!parsed || typeof parsed !== 'object') return parsed;
    const obj = parsed as Record<string, unknown>;
    const out: Record<string, unknown> = { ...obj };

    if (Array.isArray(obj.actions)) {
      const rawActions = obj.actions;
      const codes: string[] = [];
      for (const a of rawActions) {
        if (a && typeof a === 'object') {
          const o = a as Record<string, unknown>;
          if (typeof o.bin_code === 'string') codes.push(o.bin_code);
          if (typeof o.target_bin_code === 'string') codes.push(o.target_bin_code);
        }
      }
      const codeToUuid = await resolveBinCodes(locationId, codes);
      const uuidFor = (code: string) => codeToUuid.get(code.toUpperCase());

      const actions: unknown[] = [];
      for (const a of rawActions) {
        if (!a || typeof a !== 'object') continue;
        const o: Record<string, unknown> = { ...(a as Record<string, unknown>) };

        if (typeof o.bin_code === 'string') {
          const uuid = uuidFor(o.bin_code);
          if (!uuid) continue;
          delete o.bin_code;
          o.bin_id = uuid;
        }

        if (typeof o.target_bin_code === 'string') {
          const uuid = uuidFor(o.target_bin_code);
          delete o.target_bin_code;
          if (uuid) {
            o.target_bin_id = uuid;
          } else {
            delete o.target_bin_name;
          }
        }

        actions.push(o);
      }
      out.actions = actions;
    }

    if (Array.isArray(obj.matches)) {
      const matches = obj.matches as RawMatch[];
      out.matches = await enrichQueryMatches(matches, locationId, userId);
    }

    return out;
  };
}

function validateBinIds(binIds: unknown): string[] | undefined {
  if (!binIds) return undefined;
  if (!Array.isArray(binIds)) return undefined;
  const valid = binIds
    .filter((id): id is string => typeof id === 'string' && /^[a-zA-Z0-9-]{1,36}$/.test(id))
    .slice(0, 100);
  return valid.length > 0 ? valid : undefined;
}

/** Count what the route is about to analyze without throwing — the credit
 *  resolver runs before the route handler can produce its own validation
 *  error, so we charge for "at least 1 photo" even when the request is
 *  malformed. The route handler will then throw the real ValidationError. */
function imageCountFromReq(req: import('express').Request): number {
  return countUploadedFiles(req) || countPhotoIds((req.body ?? {}) as Record<string, unknown>) || 1;
}

function reorganizeBinCountFromReq(req: import('express').Request): number {
  const body = (req.body ?? {}) as { bins?: unknown };
  return Array.isArray(body.bins) ? body.bins.length : 0;
}

/**
 * Some providers (Gemini in particular) rename keys when emitting structured
 * output, even with a Zod schema constraint. Map the common aliases back to
 * the canonical keys before Zod validation.
 */
function normalizePlanAliases(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const o = parsed as Record<string, unknown>;
  const out: Record<string, unknown> = { ...o };
  // discriminator aliases
  if (out.kind === undefined) {
    if (typeof o.plan === 'string') out.kind = o.plan;
    else if (typeof o.type === 'string') out.kind = o.type;
    else if (typeof o.intent === 'string') out.kind = o.intent;
  }
  // answer-field aliases
  if (out.answer === undefined) {
    if (typeof o.query_answer === 'string') out.answer = o.query_answer;
    else if (typeof o.response === 'string') out.answer = o.response;
    else if (typeof o.message === 'string') out.answer = o.message;
  }
  // terms-field aliases
  if (out.terms === undefined && Array.isArray(o.search_terms)) out.terms = o.search_terms;
  return out;
}

async function streamPlannedQuery(
  res: import('express').Response,
  req: import('express').Request,
  question: string,
  locationId: string,
  scopedBinIds: string[] | undefined,
  scopeNote: string,
  priorMessages: import('ai').ModelMessage[],
): Promise<void> {
  const { settings, model } = await resolveUserModel(req.user!.id, 'query', isDemoUser(req));
  const schemaCtx = await buildPlannerSchemaContext(locationId);

  await pipeAiStreamToResponse(res, model, {
    schema: QueryPlanSchema,
    system: buildPlannerSystemPrompt(settings.query_prompt ?? undefined, isDemoUser(req)),
    userContent: buildPlannerUserMessage(`${scopeNote}${question}`, schemaCtx),
    priorMessages,
    ...streamOpts(settings, req, { maxTokens: 800, temperature: 0.2 }),
    enrichResult: async (parsed) => {
      // Re-validate via Zod safeParse: some providers (notably Gemini) silently
      // rename keys in structured output ("kind" → "plan", "answer" → "query_answer").
      // Normalize known aliases before parsing, then fall back gracefully if the
      // shape still doesn't match.
      const normalized = normalizePlanAliases(parsed);
      const safe = QueryPlanSchema.safeParse(normalized);
      if (!safe.success) {
        return {
          answer: "I couldn't understand that. Try rephrasing your question.",
          matches: [],
        };
      }
      const plan = validateQueryPlan(safe.data);
      const executed = await executeQueryPlan(plan, locationId, req.user!.id, scopedBinIds);
      return { answer: executed.answer, matches: executed.matches };
    },
  });
}

// POST /api/ai/query/stream
streamRouter.post('/query/stream', ...aiRateLimiters, requireAiAccess(), checkAiCredits(), requireLocationMemberOrAbove(), aiRouteHandler('stream query', async (req, res) => {
  const question = validateTextInput(req.body.question, 'question');
  const { locationId } = req.body;
  const priorMessages = parseHistoryFromBody(req.body);

  if (config.aiDeterministicMatch) {
    await streamPlannedQuery(res, req, question, locationId, undefined, '', priorMessages);
    return;
  }

  // ── Legacy path (unchanged) ──
  const [{ settings, model }, context] = await Promise.all([
    resolveUserModel(req.user!.id, 'query', isDemoUser(req)),
    buildInventoryContext(locationId, req.user!.id, undefined, question),
  ]);

  await pipeAiStreamToResponse(res, model, {
    schema: QueryResultSchema,
    system: buildQuerySysPrompt(settings.query_prompt ?? undefined, isDemoUser(req)),
    userContent: buildQueryUserMsg(question, context),
    priorMessages,
    ...streamOpts(settings, req, { maxTokens: 4096, temperature: 0.2 }),
    enrichResult: makeQueryEnrichResult(locationId, req.user!.id),
  });
}));

// POST /api/ai/command/stream
streamRouter.post('/command/stream', ...aiRateLimiters, requireAiAccess(), checkAiCredits(), requireLocationMemberOrAbove(), aiRouteHandler('stream command', async (req, res) => {
  const text = validateTextInput(req.body.text, 'text');
  const { locationId } = req.body;
  const priorMessages = parseHistoryFromBody(req.body);
  const [{ settings, model }, context] = await Promise.all([
    resolveUserModel(req.user!.id, 'command', isDemoUser(req)),
    buildCommandContext(locationId, req.user!.id, undefined, text),
  ]);
  const request: CommandRequest = { text, context };

  // No schema constraint — the prompt's examples and instructions produce
  // reliable JSON, and structured-output mode causes providers like Gemini
  // to aggressively omit optional fields (items, area_name in create_bin).
  await pipeAiStreamToResponse(res, model, {
    system: buildCommandSysPrompt(context.availableColors, context.availableIcons, settings.command_prompt ?? undefined, isDemoUser(req)),
    userContent: buildCommandUserMsg(request),
    priorMessages,
    ...streamOpts(settings, req, { maxTokens: 2500, temperature: 0.2 }),
    enrichResult: makeCommandEnrichResult(locationId, req.user!.id),
  });
}));

// POST /api/ai/ask/stream — unified command+query endpoint
streamRouter.post('/ask/stream', ...aiRateLimiters, requireAiAccess(), checkAiCredits(), requireLocationMemberOrAbove(), aiRouteHandler('stream ask', async (req, res) => {
  const text = validateTextInput(req.body.text, 'text');
  const { locationId, binIds: rawBinIds } = req.body;
  const binIds = validateBinIds(rawBinIds);
  const isScoped = (binIds?.length ?? 0) > 0;
  const priorMessages = parseHistoryFromBody(req.body);

  const scopeNote = isScoped
    ? '\nSELECTION SCOPE: The user selected specific bins. The inventory context below contains ONLY these bins. Apply actions or answer based only on the bins provided.\n'
    : '';
  let intent = classifyIntent(text);

  // When the deterministic planner is enabled, prefer routing ambiguous bare-noun
  // and conversational follow-up messages to the planner. The planner can decide
  // (via refusal kind) when it cannot help, which is more useful than the legacy
  // command path attempting to interpret a search intent as an action. This
  // covers cases like "tools" (single noun), "yes" (confirmation after a near-miss),
  // and "the red ones" (pronoun reference).
  if (intent === 'ambiguous' && config.aiDeterministicMatch) {
    const trimmed = text.trim();
    const hasCommandVerb = /\b(add|remove|delete|move|create|update|put|take|pin|unpin|set|change|rename|tag|untag|clear|make|mark|assign|merge|split|restore)\b/i.test(trimmed);
    const wordCount = trimmed.split(/\s+/).length;
    const isConfirmation = priorMessages.length > 0 && /^(yes|yeah|yep|sure|ok(ay)?|the\s+(first|second|third|last|one|other)|that\s+one|those)\b/i.test(trimmed);
    const isShortNoun = wordCount <= 4 && !hasCommandVerb;
    if (isConfirmation || isShortNoun) {
      intent = 'query';
    }
  }

  if (intent === 'query') {
    if (config.aiDeterministicMatch) {
      await streamPlannedQuery(res, req, text, locationId, binIds, scopeNote, priorMessages);
      return;
    }
    const [{ settings, model }, queryContext] = await Promise.all([
      resolveUserModel(req.user!.id, 'query', isDemoUser(req)),
      buildInventoryContext(locationId, req.user!.id, binIds, text),
    ]);
    assertBinsFound(binIds, queryContext.bins);

    await pipeAiStreamToResponse(res, model, {
      schema: QueryResultSchema,
      system: buildQuerySysPrompt(settings.query_prompt ?? undefined, isDemoUser(req)),
      userContent: buildQueryUserMsg(`${scopeNote}${text}`, queryContext),
      priorMessages,
      ...streamOpts(settings, req, { maxTokens: 4096, temperature: 0.2 }),
      enrichResult: makeQueryEnrichResult(locationId, req.user!.id),
    });
  } else {
    const [{ settings, model }, context] = await Promise.all([
      resolveUserModel(req.user!.id, 'command', isDemoUser(req)),
      buildCommandContext(locationId, req.user!.id, binIds, text),
    ]);
    assertBinsFound(binIds, context.bins);

    const system = intent === 'command'
      ? buildCommandSysPrompt(context.availableColors, context.availableIcons, settings.command_prompt ?? undefined, isDemoUser(req))
      : buildUnifiedSystemPrompt(context.availableColors, context.availableIcons, settings.command_prompt ?? undefined, settings.query_prompt ?? undefined, isDemoUser(req), isScoped);
    const request: CommandRequest = { text: intent === 'command' ? `${scopeNote}${text}` : text, context };
    await pipeAiStreamToResponse(res, model, {
      system,
      userContent: buildCommandUserMsg(request),
      priorMessages,
      ...streamOpts(settings, req, { maxTokens: 2500, temperature: 0.2 }),
      enrichResult: makeCommandEnrichResult(locationId, req.user!.id),
    });
  }
}));

// POST /api/ai/structure-text/stream
streamRouter.post('/structure-text/stream', ...aiRateLimiters, requireAiAccess(), checkAiCredits(), aiRouteHandler('stream structure-text', async (req, res) => {
  const text = validateTextInput(req.body.text, 'text');
  const { context } = req.body;
  const { settings, model } = await resolveUserModel(req.user!.id, 'structure', isDemoUser(req));

  await pipeAiStreamToResponse(res, model, {
    system: buildStructurePrompt({ text, mode: 'items', context }, settings.structure_prompt ?? undefined, isDemoUser(req)),
    userContent: text,
    ...streamOpts(settings, req, { maxTokens: STRUCTURE_TEXT_TOKENS, temperature: 0.2 }),
  });
}));

// Dynamic multer selector: demo users get 3 MB/file limit, others get the standard limit.
const analyzeImageFields = [
  { name: 'photo', maxCount: 1 },
  { name: 'photos', maxCount: 5 },
];
const DEMO_REQUEST_MAX_BYTES = 15 * 1024 * 1024;

function demoAwareAnalyzeUpload(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction): void {
  const upload = isDemoConn(req) ? demoMemoryPhotoUpload : memoryPhotoUpload;
  upload.fields(analyzeImageFields)(req, res, (err) => {
    if (err) { next(err); return; }
    if (isDemoConn(req)) {
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const total = [...(files?.photo || []), ...(files?.photos || [])].reduce((sum, f) => sum + f.size, 0);
      if (total > DEMO_REQUEST_MAX_BYTES) {
        res.status(422).json({ error: 'VALIDATION_ERROR', message: 'Total upload size exceeds 15 MB' });
        return;
      }
    }
    next();
  });
}

// POST /api/ai/analyze-image/stream
streamRouter.post('/analyze-image/stream', demoConnectionLimiter, demoAwareAnalyzeUpload, ...aiRateLimiters, requirePlusOrAbove(), requireAiAccess(), checkAiCredits((req) => visionWeight(imageCountFromReq(req))), aiRouteHandler('stream analyze image', async (req, res) => {
  const allFiles = extractUploadedFiles(req);
  if (config.aiMock) { await sendMockJsonStream(res, buildMockAnalysisResult()); return; }

  await runAnalysisStream({
    req,
    res,
    images: allFiles.map((f) => ({ buffer: f.buffer, mimeType: f.mimetype })),
    locationId: req.body?.locationId,
    buildSystem: defaultAnalysisSystem(isDemoUser(req)),
    buildUserContent: defaultAnalysisUserContent,
  });
}));

// POST /api/ai/analyze/stream — stream analysis of stored photos
streamRouter.post('/analyze/stream', ...aiRateLimiters, requirePlusOrAbove(), requireAiAccess(), checkAiCredits((req) => visionWeight(imageCountFromReq(req))), aiRouteHandler('stream analyze photo', async (req, res) => {
  const ids = extractPhotoIds(req.body);
  if (config.aiMock) { await sendMockJsonStream(res, buildMockAnalysisResult()); return; }

  const loaded = await loadPhotosForAnalysis(ids, req.user!.id);
  if (!loaded) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Photo not found or access denied' });
    return;
  }

  await runAnalysisStream({
    req,
    res,
    images: loaded.images.map((img) => ({ buffer: img.buffer, mimeType: img.mimeType })),
    buildSystem: defaultAnalysisSystem(isDemoUser(req)),
    buildUserContent: defaultAnalysisUserContent,
  });
}));

// POST /api/ai/reanalyze/stream — stream reanalysis of stored photos with previous result context
streamRouter.post('/reanalyze/stream', ...aiRateLimiters, requirePlusOrAbove(), requireAiAccess(), checkAiCredits((req) => visionWeight(imageCountFromReq(req))), aiRouteHandler('stream reanalyze photo', async (req, res) => {
  const ids = extractPhotoIds(req.body);
  const safePrevious = sanitizePreviousResult(validatePreviousResult(req.body.previousResult));

  if (config.aiMock) { await sendMockJsonStream(res, buildMockAnalysisResult()); return; }

  const loaded = await loadPhotosForAnalysis(ids, req.user!.id);
  if (!loaded) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Photo not found or access denied' });
    return;
  }

  await runAnalysisStream({
    req,
    res,
    images: loaded.images.map((img) => ({ buffer: img.buffer, mimeType: img.mimeType })),
    buildSystem: () => buildReanalysisPrompt(),
    buildUserContent: ({ imageParts }) => buildReanalysisUserContent(safePrevious, imageParts),
  });
}));

// POST /api/ai/correct/stream — correct a previous analysis result
streamRouter.post('/correct/stream', ...aiRateLimiters, requireAiAccess(), checkAiCredits(), aiRouteHandler('stream correction', async (req, res) => {
  const { correction, locationId } = req.body;

  const safePrevious = sanitizePreviousResult(validatePreviousResult(req.body.previousResult));
  const correctionText = validateTextInput(correction, 'correction', 1000);

  if (config.aiMock) {
    await sendMockJsonStream(res, {
      name: safePrevious.name,
      items: [...safePrevious.items.slice(0, -1), `Corrected: ${correctionText.slice(0, 50)}`],
    });
    return;
  }

  if (!await verifyOptionalLocationMembership(locationId, req.user!.id)) {
    throw new ForbiddenError('Not a member of this location');
  }
  const { settings, model } = await resolveUserModel(req.user!.id, 'analysis', isDemoUser(req));

  const sanitizedCorrection = sanitizeForPrompt(correctionText);
  const userMessage = `<previous_result>\n${JSON.stringify(safePrevious, null, 2)}\n</previous_result>\n\n<correction_feedback>\n${sanitizedCorrection}\n</correction_feedback>`;

  await pipeAiStreamToResponse(res, model, {
    system: buildCorrectionPrompt(),
    userContent: userMessage,
    schema: AiSuggestionsSchema,
    ...streamOpts(settings, req, { maxTokens: 2500 }),
  });
}));

// POST /api/ai/reanalyze-image/stream — reanalyze uploaded photos with previous result context
streamRouter.post('/reanalyze-image/stream', memoryPhotoUpload.fields([
  { name: 'photo', maxCount: 1 },
  { name: 'photos', maxCount: 5 },
]), ...aiRateLimiters, requirePlusOrAbove(), requireAiAccess(), checkAiCredits((req) => visionWeight(imageCountFromReq(req))), aiRouteHandler('stream reanalyze image', async (req, res) => {
  const allFiles = extractUploadedFiles(req);

  let rawPrev: unknown = null;
  try {
    rawPrev = typeof req.body?.previousResult === 'string'
      ? JSON.parse(req.body.previousResult)
      : req.body?.previousResult;
  } catch {
    throw new ValidationError('previousResult must be valid JSON');
  }
  const safePrevious = sanitizePreviousResult(validatePreviousResult(rawPrev));

  if (config.aiMock) { await sendMockJsonStream(res, buildMockAnalysisResult()); return; }

  await runAnalysisStream({
    req,
    res,
    images: allFiles.map((f) => ({ buffer: f.buffer, mimeType: f.mimetype })),
    locationId: req.body?.locationId,
    buildSystem: () => buildReanalysisPrompt(),
    buildUserContent: ({ imageParts }) => buildReanalysisUserContent(safePrevious, imageParts),
  });
}));

// POST /api/ai/reorganize/stream
streamRouter.post('/reorganize/stream', ...aiRateLimiters, requirePlusOrAbove(), requireAiAccess(), checkAiCredits((req) => reorganizeWeight(reorganizeBinCountFromReq(req))), requireLocationMemberOrAbove(), aiRouteHandler('stream reorganization', async (req, res) => {
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
streamRouter.post('/reorganize-tags/stream', ...aiRateLimiters, requirePlusOrAbove(), requireAiAccess(), checkAiCredits((req) => reorganizeWeight(reorganizeBinCountFromReq(req))), requireLocationMemberOrAbove(), aiRouteHandler('stream tag suggestions', async (req, res) => {
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

export { streamRouter };
