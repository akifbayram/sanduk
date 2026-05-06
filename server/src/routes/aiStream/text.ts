import { Router } from 'express';
import { buildCommandContext, buildInventoryContext, buildPlannerSchemaContext } from '../../lib/aiContext.js';
import { buildCorrectionPrompt } from '../../lib/aiProviders.js';
import { sanitizePreviousResult, validatePreviousResult } from '../../lib/aiRequestHelpers.js';
import { aiRouteHandler, validateTextInput } from '../../lib/aiRouteHandler.js';
import { sanitizeForPrompt } from '../../lib/aiSanitize.js';
import { AiSuggestionsSchema, QueryResultSchema } from '../../lib/aiSchemas.js';
import { pipeAiStreamToResponse } from '../../lib/aiStream.js';
import { resolveUserModel, streamOpts } from '../../lib/aiStreamHandler.js';
import { verifyOptionalLocationMembership } from '../../lib/binAccess.js';
import type { CommandRequest } from '../../lib/commandParser.js';
import { buildSystemPrompt as buildCommandSysPrompt, buildUserMessage as buildCommandUserMsg, buildUnifiedSystemPrompt } from '../../lib/commandParser.js';
import { config, isDemoUser } from '../../lib/config.js';
import { parseHistoryFromBody } from '../../lib/conversationHistory.js';
import { ForbiddenError } from '../../lib/httpErrors.js';
import { classifyIntent } from '../../lib/intentClassifier.js';
import { buildSystemPrompt as buildQuerySysPrompt, buildUserMessage as buildQueryUserMsg } from '../../lib/inventoryQuery.js';
import { buildPlannerSystemPrompt, buildPlannerUserMessage, normalizePlanAliases, QueryPlanSchema, validateQueryPlan } from '../../lib/queryPlan.js';
import { executeQueryPlan } from '../../lib/queryPlanExecutor.js';
import { aiRateLimiters } from '../../lib/rateLimiters.js';
import { buildPrompt as buildStructurePrompt, STRUCTURE_TEXT_TOKENS } from '../../lib/structureText.js';
import { requireLocationMemberOrAbove } from '../../middleware/locationAccess.js';
import { checkAiCredits, requireAiAccess } from '../../middleware/requirePlan.js';
import { assertBinsFound, makeCommandEnrichResult, makeQueryEnrichResult, sendMockJsonStream, validateBinIds } from './helpers.js';

const router = Router();

interface StreamPlannedQueryArgs {
  question: string;
  locationId: string;
  scopedBinIds?: string[];
  scopeNote?: string;
  priorMessages: import('ai').ModelMessage[];
}

async function streamPlannedQuery(
  res: import('express').Response,
  req: import('express').Request,
  args: StreamPlannedQueryArgs,
): Promise<void> {
  const { question, locationId, scopedBinIds, scopeNote = '', priorMessages } = args;
  const [{ settings, model }, schemaCtx] = await Promise.all([
    resolveUserModel(req.user!.id, 'query', isDemoUser(req)),
    buildPlannerSchemaContext(locationId, req.user!.id),
  ]);

  await pipeAiStreamToResponse(res, model, {
    schema: QueryPlanSchema,
    system: buildPlannerSystemPrompt(settings.query_prompt ?? undefined, isDemoUser(req)),
    userContent: buildPlannerUserMessage(`${scopeNote}${question}`, schemaCtx),
    priorMessages,
    ...streamOpts(settings, req, { maxTokens: 800, temperature: 0.2 }),
    enrichResult: async (parsed) => {
      const safe = QueryPlanSchema.safeParse(normalizePlanAliases(parsed));
      if (!safe.success) {
        return { answer: "I couldn't understand that. Try rephrasing your question.", matches: [] };
      }
      const executed = await executeQueryPlan(validateQueryPlan(safe.data), locationId, req.user!.id, scopedBinIds);
      return { answer: executed.answer, matches: executed.matches };
    },
  });
}

// POST /api/ai/query/stream
router.post('/query/stream', ...aiRateLimiters, requireAiAccess(), checkAiCredits(), requireLocationMemberOrAbove(), aiRouteHandler('stream query', async (req, res) => {
  const question = validateTextInput(req.body.question, 'question');
  const { locationId } = req.body;
  const priorMessages = parseHistoryFromBody(req.body);

  if (config.aiDeterministicMatch) {
    await streamPlannedQuery(res, req, { question, locationId, priorMessages });
    return;
  }

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
router.post('/command/stream', ...aiRateLimiters, requireAiAccess(), checkAiCredits(), requireLocationMemberOrAbove(), aiRouteHandler('stream command', async (req, res) => {
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
router.post('/ask/stream', ...aiRateLimiters, requireAiAccess(), checkAiCredits(), requireLocationMemberOrAbove(), aiRouteHandler('stream ask', async (req, res) => {
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
      await streamPlannedQuery(res, req, { question: text, locationId, scopedBinIds: binIds, scopeNote, priorMessages });
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
router.post('/structure-text/stream', ...aiRateLimiters, requireAiAccess(), checkAiCredits(), aiRouteHandler('stream structure-text', async (req, res) => {
  const text = validateTextInput(req.body.text, 'text');
  const { context } = req.body;
  const { settings, model } = await resolveUserModel(req.user!.id, 'structure', isDemoUser(req));

  await pipeAiStreamToResponse(res, model, {
    system: buildStructurePrompt({ text, mode: 'items', context }, settings.structure_prompt ?? undefined, isDemoUser(req)),
    userContent: text,
    ...streamOpts(settings, req, { maxTokens: STRUCTURE_TEXT_TOKENS, temperature: 0.2 }),
  });
}));

// POST /api/ai/correct/stream — correct a previous analysis result
router.post('/correct/stream', ...aiRateLimiters, requireAiAccess(), checkAiCredits(), aiRouteHandler('stream correction', async (req, res) => {
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

export default router;
