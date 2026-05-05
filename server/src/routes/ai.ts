import { Router } from 'express';
import { d, generateUuid, query } from '../db.js';
import { testProviderConnection } from '../lib/aiCaller.js';
import { AiAnalysisError } from '../lib/aiErrors.js';
import { aiRouteHandler, validateTextInput } from '../lib/aiRouteHandler.js';
import { getUserAiSettings } from '../lib/aiSettings.js';
import { validateEndpointUrl } from '../lib/aiSsrf.js';
import { AI_TASK_GROUPS, type AiTaskGroup, config, getEnvAiConfig, getEnvGroupOverride, isDemoUser, isGroupEnvLocked } from '../lib/config.js';
import { decryptApiKey, encryptApiKey, maskApiKey, resolveMaskedApiKey } from '../lib/crypto.js';
import { ALL_DEFAULT_PROMPTS } from '../lib/defaultPrompts.js';
import { HttpError, ValidationError } from '../lib/httpErrors.js';
import { aiRateLimiters } from '../lib/rateLimiters.js';
import type { StructureTextRequest } from '../lib/structureText.js';
import { structureText } from '../lib/structureText.js';
import { resolveTaskConfig } from '../lib/taskRouting.js';
import { transcribeAudio } from '../lib/transcribe.js';
import { memoryAudioUpload } from '../lib/uploadConfig.js';
import { authenticate } from '../middleware/auth.js';
import { checkAiCredits, requireAiAccess } from '../middleware/requirePlan.js';

const MOCK_AI_SETTINGS = {
  id: null,
  provider: 'openai',
  apiKey: '***mock',
  model: 'mock',
  endpointUrl: null,
  customPrompt: null,
  commandPrompt: null,
  queryPrompt: null,
  structurePrompt: null,
  reorganizationPrompt: null,
  tagSuggestionPrompt: null,
  temperature: null,
  maxTokens: null,
  topP: null,
  requestTimeout: null,
  source: 'env' as const,
} as const;

const VALID_PROVIDERS = ['openai', 'anthropic', 'gemini', 'openai-compatible'] as const;

async function assertValidEndpointUrl(endpointUrl: unknown, isDemo: boolean): Promise<void> {
  if (!endpointUrl || typeof endpointUrl !== 'string') return;
  try {
    await validateEndpointUrl(endpointUrl, isDemo);
  } catch (err) {
    if (err instanceof AiAnalysisError) throw new ValidationError(err.message);
    throw err;
  }
}

const router = Router();

// GET /api/ai/default-prompts — public (no auth), returns default prompt strings
router.get('/default-prompts', (_req, res) => {
  res.json(ALL_DEFAULT_PROMPTS);
});

router.use(authenticate);

// GET /api/ai/settings — get user's AI config
router.get('/settings', requireAiAccess(), aiRouteHandler('get AI settings', async (req, res) => {
  const demo = isDemoUser(req);
  const result = await query(
    'SELECT id, provider, api_key, model, endpoint_url, custom_prompt, command_prompt, query_prompt, structure_prompt, reorganization_prompt, tag_suggestion_prompt, temperature, max_tokens, top_p, request_timeout, is_active, task_model_overrides FROM user_ai_settings WHERE user_id = $1',
    [req.user!.id]
  );

  if (result.rows.length === 0) {
    // Fall back to env-based AI config
    const envConfig = getEnvAiConfig();
    if (envConfig) {
      res.json({
        id: null,
        provider: envConfig.provider,
        apiKey: demo ? 'sk-****' : maskApiKey(envConfig.apiKey),
        model: envConfig.model,
        endpointUrl: envConfig.endpointUrl,
        customPrompt: null,
        commandPrompt: null,
        queryPrompt: null,
        structurePrompt: null,
        reorganizationPrompt: null,
        tagSuggestionPrompt: null,
        temperature: null,
        maxTokens: null,
        topP: null,
        requestTimeout: null,
        taskOverrides: Object.fromEntries(
          AI_TASK_GROUPS.filter(isGroupEnvLocked).map((g) => {
            const o = getEnvGroupOverride(g);
            return [g, { provider: o.provider, model: o.model, endpointUrl: o.endpointUrl, source: 'env' as const }];
          }),
        ),
        taskOverridesEnvLocked: AI_TASK_GROUPS.filter(isGroupEnvLocked),
        source: 'env' as const,
      });
      return;
    }
    // In mock mode, return fake settings so the client enables AI features
    if (config.aiMock) {
      res.json(demo ? { ...MOCK_AI_SETTINGS, apiKey: 'sk-****' } : MOCK_AI_SETTINGS);
      return;
    }
    res.json(null);
    return;
  }

  const activeRow = result.rows.find((r: any) => !!r.is_active) || result.rows[0];

  // Fetch task overrides for this user
  const overridesResult = await query(
    'SELECT task_group, provider, model, endpoint_url FROM user_ai_task_overrides WHERE user_id = $1',
    [req.user!.id],
  );

  const taskOverridesEnvLocked = AI_TASK_GROUPS.filter(isGroupEnvLocked);

  const taskOverrides: Record<string, { provider: string | null; model: string | null; endpointUrl: string | null; source: 'env' | 'user' } | null> = {};
  for (const row of overridesResult.rows) {
    taskOverrides[row.task_group] = {
      provider: row.provider || null,
      model: row.model || null,
      endpointUrl: row.endpoint_url || null,
      source: 'user',
    };
  }
  // Env-locked groups override DB values with env values
  for (const g of taskOverridesEnvLocked) {
    const o = getEnvGroupOverride(g);
    taskOverrides[g] = { provider: o.provider, model: o.model, endpointUrl: o.endpointUrl, source: 'env' };
  }

  // Build providerConfigs from all rows
  const providerConfigs: Record<string, { apiKey: string; model: string; endpointUrl: string | null }> = {};
  for (const r of result.rows) {
    providerConfigs[r.provider] = {
      apiKey: demo ? 'sk-****' : maskApiKey(decryptApiKey(r.api_key)),
      model: r.model,
      endpointUrl: r.endpoint_url || null,
    };
  }

  res.json({
    id: activeRow.id,
    provider: activeRow.provider,
    apiKey: demo ? 'sk-****' : maskApiKey(decryptApiKey(activeRow.api_key)),
    model: activeRow.model,
    endpointUrl: activeRow.endpoint_url,
    customPrompt: activeRow.custom_prompt || null,
    commandPrompt: activeRow.command_prompt || null,
    queryPrompt: activeRow.query_prompt || null,
    structurePrompt: activeRow.structure_prompt || null,
    reorganizationPrompt: activeRow.reorganization_prompt || null,
    tagSuggestionPrompt: activeRow.tag_suggestion_prompt || null,
    temperature: activeRow.temperature ?? null,
    maxTokens: activeRow.max_tokens ?? null,
    topP: activeRow.top_p ?? null,
    requestTimeout: activeRow.request_timeout ?? null,
    providerConfigs,
    taskOverrides,
    taskOverridesEnvLocked,
    source: 'user' as const,
  });
}));

// PUT /api/ai/settings — upsert AI config
router.put('/settings', requireAiAccess(), aiRouteHandler('save AI settings', async (req, res) => {
  if (isDemoUser(req)) {
    const isMaskedKey = (k: unknown) => k === '****' || k === 'sk-****';
    const hasApiKey = !!req.body.apiKey && !isMaskedKey(req.body.apiKey);
    const hasProviderApiKey = req.body.providerConfigs
      && Object.values(req.body.providerConfigs).some((c: any) => c?.apiKey && !isMaskedKey(c.apiKey));
    if (hasApiKey || hasProviderApiKey) {
      throw new HttpError(403, 'DEMO_RESTRICTION', 'Demo accounts cannot configure API keys. Use server-configured keys or mock mode.');
    }
    const PROMPT_FIELDS = ['customPrompt', 'commandPrompt', 'queryPrompt', 'structurePrompt', 'reorganizationPrompt', 'tagSuggestionPrompt'] as const;
    if (PROMPT_FIELDS.some(f => req.body[f] != null)) {
      throw new HttpError(403, 'DEMO_RESTRICTION', 'Demo accounts cannot customize AI prompts');
    }
  }

  const { provider, apiKey, model, endpointUrl, customPrompt, commandPrompt, queryPrompt, structurePrompt, reorganizationPrompt, tagSuggestionPrompt } = req.body;
  const { temperature: rawTemp, maxTokens: rawMaxTokens, topP: rawTopP, requestTimeout: rawTimeout } = req.body;

  if (!provider || !apiKey || !model) {
    throw new ValidationError('provider, apiKey, and model are required');
  }

  if (!(VALID_PROVIDERS as readonly string[]).includes(provider)) {
    throw new ValidationError('Invalid provider');
  }

  for (const [field, value] of [['customPrompt', customPrompt], ['commandPrompt', commandPrompt], ['queryPrompt', queryPrompt], ['structurePrompt', structurePrompt], ['reorganizationPrompt', reorganizationPrompt], ['tagSuggestionPrompt', tagSuggestionPrompt]] as const) {
    if (value && typeof value === 'string' && value.length > 10000) {
      throw new ValidationError(`${field.replace(/([A-Z])/g, ' $1').toLowerCase().trim()} must be 10000 characters or less`);
    }
  }

  // Validate advanced AI parameters
  const finalTemperature = rawTemp != null ? Number(rawTemp) : null;
  if (finalTemperature != null && (Number.isNaN(finalTemperature) || finalTemperature < 0 || finalTemperature > 2)) {
    throw new ValidationError('temperature must be between 0 and 2');
  }

  const finalMaxTokens = rawMaxTokens != null ? Math.round(Number(rawMaxTokens)) : null;
  if (finalMaxTokens != null && (Number.isNaN(finalMaxTokens) || finalMaxTokens < 100 || finalMaxTokens > 16000)) {
    throw new ValidationError('maxTokens must be between 100 and 16000');
  }

  const finalTopP = rawTopP != null ? Number(rawTopP) : null;
  if (finalTopP != null && (Number.isNaN(finalTopP) || finalTopP < 0 || finalTopP > 1)) {
    throw new ValidationError('topP must be between 0 and 1');
  }

  const finalTimeout = rawTimeout != null ? Math.round(Number(rawTimeout)) : null;
  if (finalTimeout != null && (Number.isNaN(finalTimeout) || finalTimeout < 10 || finalTimeout > 300)) {
    throw new ValidationError('requestTimeout must be between 10 and 300 seconds');
  }

  await assertValidEndpointUrl(endpointUrl, isDemoUser(req));

  const finalApiKey = await resolveMaskedApiKey(apiKey, req.user!.id, provider);
  const encryptedKey = encryptApiKey(finalApiKey);
  const finalCustomPrompt = (customPrompt && typeof customPrompt === 'string' && customPrompt.trim()) ? customPrompt.trim() : null;
  const finalCommandPrompt = (commandPrompt && typeof commandPrompt === 'string' && commandPrompt.trim()) ? commandPrompt.trim() : null;
  const finalQueryPrompt = (queryPrompt && typeof queryPrompt === 'string' && queryPrompt.trim()) ? queryPrompt.trim() : null;
  const finalStructurePrompt = (structurePrompt && typeof structurePrompt === 'string' && structurePrompt.trim()) ? structurePrompt.trim() : null;
  const finalReorganizationPrompt = (reorganizationPrompt && typeof reorganizationPrompt === 'string' && reorganizationPrompt.trim()) ? reorganizationPrompt.trim() : null;
  const finalTagSuggestionPrompt = (tagSuggestionPrompt && typeof tagSuggestionPrompt === 'string' && tagSuggestionPrompt.trim()) ? tagSuggestionPrompt.trim() : null;

  // Deactivate all other rows for this user
  await query(
    `UPDATE user_ai_settings SET is_active = FALSE, updated_at = ${d.now()} WHERE user_id = $1`,
    [req.user!.id]
  );

  // Upsert the row for this (user, provider) and set it active
  const newId = generateUuid();
  const result = await query(
    `INSERT INTO user_ai_settings (id, user_id, provider, api_key, model, endpoint_url, custom_prompt, command_prompt, query_prompt, structure_prompt, reorganization_prompt, tag_suggestion_prompt, temperature, max_tokens, top_p, request_timeout, task_model_overrides, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, TRUE)
     ON CONFLICT (user_id, provider) DO UPDATE SET
       api_key = $4, model = $5, endpoint_url = $6, custom_prompt = $7, command_prompt = $8, query_prompt = $9, structure_prompt = $10, reorganization_prompt = $11, tag_suggestion_prompt = $12, temperature = $13, max_tokens = $14, top_p = $15, request_timeout = $16, task_model_overrides = $17, is_active = TRUE, updated_at = ${d.now()}
     RETURNING id, provider, api_key, model, endpoint_url, custom_prompt, command_prompt, query_prompt, structure_prompt, reorganization_prompt, tag_suggestion_prompt, temperature, max_tokens, top_p, request_timeout, task_model_overrides`,
    [newId, req.user!.id, provider, encryptedKey, model, endpointUrl || null, finalCustomPrompt, finalCommandPrompt, finalQueryPrompt, finalStructurePrompt, finalReorganizationPrompt, finalTagSuggestionPrompt, finalTemperature, finalMaxTokens, finalTopP, finalTimeout, null]
  );

  // Fetch all rows to build providerConfigs
  const allRows = await query(
    'SELECT provider, api_key, model, endpoint_url FROM user_ai_settings WHERE user_id = $1',
    [req.user!.id]
  );
  const providerConfigs: Record<string, { apiKey: string; model: string; endpointUrl: string | null }> = {};
  for (const r of allRows.rows) {
    providerConfigs[r.provider] = {
      apiKey: maskApiKey(decryptApiKey(r.api_key)),
      model: r.model,
      endpointUrl: r.endpoint_url || null,
    };
  }

  const row = result.rows[0];
  res.json({
    id: row.id,
    provider: row.provider,
    apiKey: maskApiKey(decryptApiKey(row.api_key)),
    model: row.model,
    endpointUrl: row.endpoint_url,
    customPrompt: row.custom_prompt || null,
    commandPrompt: row.command_prompt || null,
    queryPrompt: row.query_prompt || null,
    structurePrompt: row.structure_prompt || null,
    reorganizationPrompt: row.reorganization_prompt || null,
    tagSuggestionPrompt: row.tag_suggestion_prompt || null,
    temperature: row.temperature ?? null,
    maxTokens: row.max_tokens ?? null,
    topP: row.top_p ?? null,
    requestTimeout: row.request_timeout ?? null,
    providerConfigs,
    source: 'user' as const,
  });
}));

// DELETE /api/ai/settings — remove AI config
router.delete('/settings', requireAiAccess(), aiRouteHandler('delete AI settings', async (req, res) => {
  await query('DELETE FROM user_ai_task_overrides WHERE user_id = $1', [req.user!.id]);
  await query('DELETE FROM user_ai_settings WHERE user_id = $1', [req.user!.id]);
  res.json({ deleted: true });
}));

// POST /api/ai/structure-text — structure dictated/typed text into items
router.post('/structure-text', ...aiRateLimiters, requireAiAccess(), checkAiCredits(), aiRouteHandler('structure text', async (req, res) => {
  const text = validateTextInput(req.body.text, 'text');
  const { context } = req.body;

  // Mock mode: return fake AI response without calling any provider
  if (config.aiMock) {
    res.json({ items: [text] });
    return;
  }

  const settings = await getUserAiSettings(req.user!.id);
  const taskConfig = await resolveTaskConfig(req.user!.id, 'quickText', settings.config);

  const request: StructureTextRequest = {
    text,
    mode: 'items',
    context: context ? {
      binName: context.binName || undefined,
      existingItems: Array.isArray(context.existingItems) ? context.existingItems : undefined,
    } : undefined,
  };

  const result = await structureText(taskConfig, request, settings.structure_prompt || undefined, settings, isDemoUser(req));
  res.json(result);
}));

// POST /api/ai/test — test connection with provided credentials.
// Intentionally does NOT consume an AI credit: this is a UX action to verify
// a key/endpoint, and burning a credit per click punishes users for trying.
router.post('/test', ...aiRateLimiters, requireAiAccess(), aiRouteHandler('test connection', async (req, res) => {
  if (isDemoUser(req)) {
    throw new HttpError(403, 'DEMO_RESTRICTION', 'Demo accounts cannot configure API keys. Use server-configured keys or mock mode.');
  }

  const { provider, apiKey, model, endpointUrl } = req.body;

  if (!provider || !apiKey || !model) {
    throw new ValidationError('provider, apiKey, and model are required');
  }

  // Mock mode: return success without calling any provider
  if (config.aiMock) {
    res.json({ success: true });
    return;
  }

  const finalApiKey = await resolveMaskedApiKey(apiKey, req.user!.id, provider);
  await testProviderConnection({
    provider,
    apiKey: finalApiKey,
    model,
    endpointUrl: endpointUrl || null,
  }, isDemoUser(req));
  res.json({ success: true });
}));

// PUT /api/ai/task-overrides/:taskGroup
router.put('/task-overrides/:taskGroup', requireAiAccess(), aiRouteHandler('save task override', async (req, res) => {
  const group = req.params.taskGroup as AiTaskGroup;
  if (!(AI_TASK_GROUPS as readonly string[]).includes(group)) {
    throw new ValidationError(`Invalid task group: ${group}. Valid: ${AI_TASK_GROUPS.join(', ')}`);
  }
  if (isGroupEnvLocked(group)) {
    throw new HttpError(409, 'ENV_LOCKED', `Task routing for ${group} is configured by server environment`);
  }
  if (isDemoUser(req)) {
    throw new HttpError(403, 'DEMO_RESTRICTION', 'Demo accounts cannot configure task routing');
  }

  const { provider, model, endpointUrl } = req.body;
  if (provider && !(VALID_PROVIDERS as readonly string[]).includes(provider)) {
    throw new ValidationError('Invalid provider');
  }

  await assertValidEndpointUrl(endpointUrl, isDemoUser(req));

  const id = generateUuid();
  await query(
    `INSERT INTO user_ai_task_overrides (id, user_id, task_group, provider, model, endpoint_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, task_group) DO UPDATE SET
       provider = $4, model = $5, endpoint_url = $6, updated_at = ${d.now()}`,
    [id, req.user!.id, group, provider || null, model || null, endpointUrl || null],
  );
  res.json({ taskGroup: group, provider: provider || null, model: model || null, endpointUrl: endpointUrl || null });
}));

// DELETE /api/ai/task-overrides/:taskGroup
router.delete('/task-overrides/:taskGroup', requireAiAccess(), aiRouteHandler('delete task override', async (req, res) => {
  const group = req.params.taskGroup as AiTaskGroup;
  if (!(AI_TASK_GROUPS as readonly string[]).includes(group)) {
    throw new ValidationError(`Invalid task group: ${group}`);
  }
  if (isGroupEnvLocked(group)) {
    throw new HttpError(409, 'ENV_LOCKED', `Task routing for ${group} is configured by server environment`);
  }
  await query('DELETE FROM user_ai_task_overrides WHERE user_id = $1 AND task_group = $2', [req.user!.id, group]);
  res.json({ deleted: true });
}));

// POST /api/ai/transcribe — transcribe audio to text
router.post('/transcribe', memoryAudioUpload.single('audio'), ...aiRateLimiters, requireAiAccess(), checkAiCredits(), aiRouteHandler('transcribe audio', async (req, res) => {
  const file = req.file;
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new ValidationError('No audio file provided');
  }

  if (config.aiMock) {
    res.json({ text: 'three AA batteries, a Phillips screwdriver, some zip ties' });
    return;
  }

  const settings = await getUserAiSettings(req.user!.id);
  const taskConfig = await resolveTaskConfig(req.user!.id, 'quickText', settings.config);

  if (taskConfig.provider === 'anthropic') {
    throw new ValidationError('Anthropic does not support audio transcription. Switch to OpenAI or Gemini for dictation.');
  }

  const result = await transcribeAudio(taskConfig, file.buffer, file.mimetype);
  res.json(result);
}));

export default router;
