import { Router } from 'express';
import { visionWeight } from '../../lib/aiCreditWeights.js';
import { buildMockAnalysisResult, loadPhotosForAnalysis } from '../../lib/aiPhotoLoader.js';
import { buildReanalysisPrompt, buildReanalysisUserContent } from '../../lib/aiProviders.js';
import { extractPhotoIds, extractUploadedFiles, sanitizePreviousResult, validatePreviousResult } from '../../lib/aiRequestHelpers.js';
import { aiRouteHandler } from '../../lib/aiRouteHandler.js';
import { defaultAnalysisSystem, defaultAnalysisUserContent, runAnalysisStream } from '../../lib/aiStreamHandler.js';
import { config, isDemoUser } from '../../lib/config.js';
import { ValidationError } from '../../lib/httpErrors.js';
import { aiRateLimiters } from '../../lib/rateLimiters.js';
import { memoryPhotoUpload } from '../../lib/uploadConfig.js';
import { demoConnectionLimiter } from '../../middleware/demoConnectionLimiter.js';
import { checkAiCredits, requireAiAccess, requirePlusOrAbove } from '../../middleware/requirePlan.js';
import { analyzeImageFields, demoAwareAnalyzeUpload, imageCountFromReq, sendMockJsonStream } from './helpers.js';

const router = Router();

// POST /api/ai/analyze-image/stream
router.post('/analyze-image/stream', demoConnectionLimiter, demoAwareAnalyzeUpload, ...aiRateLimiters, requirePlusOrAbove(), requireAiAccess(), checkAiCredits((req) => visionWeight(imageCountFromReq(req))), aiRouteHandler('stream analyze image', async (req, res) => {
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
router.post('/analyze/stream', ...aiRateLimiters, requirePlusOrAbove(), requireAiAccess(), checkAiCredits((req) => visionWeight(imageCountFromReq(req))), aiRouteHandler('stream analyze photo', async (req, res) => {
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
router.post('/reanalyze/stream', ...aiRateLimiters, requirePlusOrAbove(), requireAiAccess(), checkAiCredits((req) => visionWeight(imageCountFromReq(req))), aiRouteHandler('stream reanalyze photo', async (req, res) => {
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

// POST /api/ai/reanalyze-image/stream — reanalyze uploaded photos with previous result context
router.post('/reanalyze-image/stream', memoryPhotoUpload.fields(analyzeImageFields), ...aiRateLimiters, requirePlusOrAbove(), requireAiAccess(), checkAiCredits((req) => visionWeight(imageCountFromReq(req))), aiRouteHandler('stream reanalyze image', async (req, res) => {
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

export default router;
