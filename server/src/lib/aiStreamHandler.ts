import type { UserContent } from 'ai';
import type { Request, Response } from 'express';
import { resizeImageForAi } from './aiImageResize.js';
import { buildSystemPrompt as buildAnalysisPrompt, buildAnalysisUserText, IMAGE_TOKENS_MULTI, IMAGE_TOKENS_SINGLE } from './aiProviders.js';
import { AiSuggestionsSchema } from './aiSchemas.js';
import type { TaskType, UserAiSettings } from './aiSettings.js';
import { getConfigForTask, getUserAiSettings } from './aiSettings.js';
import { resolvePinnedFetch } from './aiSsrf.js';
import { pipeAiStreamToResponse, withClientDisconnect } from './aiStream.js';
import { verifyOptionalLocationMembership } from './binAccess.js';
import { isDemoUser } from './config.js';
import { ForbiddenError } from './httpErrors.js';
import { createSdkModel } from './sdkProviderFactory.js';
import { resolveTaskConfig, TASK_GROUP_MAP } from './taskRouting.js';

/** Resolve a user's AI settings + SDK model for the given task, with DNS-pinned fetch when an endpoint is configured. */
export async function resolveUserModel(userId: string, task: TaskType, demo = false): Promise<{
  settings: UserAiSettings;
  model: ReturnType<typeof createSdkModel>;
}> {
  const settings = await getUserAiSettings(userId);
  const group = TASK_GROUP_MAP[task];
  const taskConfig = group
    ? await resolveTaskConfig(userId, group, settings.config)
    : getConfigForTask(settings, task);
  const pinnedFetch = await resolvePinnedFetch(taskConfig.endpointUrl, demo);
  const model = createSdkModel(taskConfig, pinnedFetch);
  return { settings, model };
}

/** Compose common stream options from user settings with optional per-route overrides. */
export function streamOpts(
  settings: UserAiSettings,
  req: Request,
  overrides?: { maxTokens?: number; temperature?: number },
): { maxTokens: number; temperature: number; topP: number | undefined; abortSignal: AbortSignal } {
  const timeoutSignal = AbortSignal.timeout((settings.request_timeout ?? 300) * 1000);
  return {
    maxTokens: overrides?.maxTokens ?? settings.max_tokens ?? 4096,
    temperature: overrides?.temperature ?? settings.temperature ?? 0.3,
    topP: settings.top_p ?? undefined,
    abortSignal: withClientDisconnect(req, timeoutSignal),
  };
}

/** A loaded image ready for inclusion as a user-message image part. */
interface AnalysisImage {
  buffer: Buffer;
  mimeType: string;
}

export interface AnalysisStreamArgs {
  req: Request;
  res: Response;
  /** Images to analyze. */
  images: AnalysisImage[];
  /** Location ID for membership check. Omit when the caller already verified access (e.g. the stored-photo loader joins on `location_members`). */
  locationId?: string;
  /** System-prompt builder. Receives user settings so it can read custom_prompt. */
  buildSystem: (settings: UserAiSettings) => string;
  /** User-content builder. Receives image parts so callers can wrap them (e.g. reanalysis). */
  buildUserContent: (args: { imageParts: Array<{ type: 'image'; image: Buffer; mimeType: string }>; imageCount: number }) => UserContent;
  /** Optional maxTokens override; defaults to the image-token budget based on image count. */
  maxTokens?: number;
}

/**
 * Shared flow for image-analysis streaming endpoints.
 *
 * Handles: location membership check, analysis-task model resolution,
 * image-part assembly, and SSE piping.
 */
export async function runAnalysisStream(args: AnalysisStreamArgs): Promise<void> {
  const { req, res, images, locationId, buildSystem, buildUserContent, maxTokens } = args;
  if (!await verifyOptionalLocationMembership(locationId, req.user!.id)) {
    throw new ForbiddenError('Not a member of this location');
  }
  const { settings, model } = await resolveUserModel(req.user!.id, 'analysis', isDemoUser(req));

  const resized = await Promise.all(
    images.map((img) => resizeImageForAi(img.buffer, img.mimeType)),
  );
  const imageParts = resized.map((img) => ({
    type: 'image' as const,
    image: img.buffer,
    mimeType: img.mimeType,
  }));

  await pipeAiStreamToResponse(res, model, {
    system: buildSystem(settings),
    userContent: buildUserContent({ imageParts, imageCount: images.length }),
    schema: AiSuggestionsSchema,
    ...streamOpts(settings, req, {
      maxTokens: maxTokens ?? (images.length > 1 ? IMAGE_TOKENS_MULTI : IMAGE_TOKENS_SINGLE),
    }),
  });
}

/** Convenience: default system-prompt builder used by the vanilla analyze flows. */
export function defaultAnalysisSystem(demo: boolean): (settings: UserAiSettings) => string {
  return (settings) => buildAnalysisPrompt(settings.custom_prompt, demo);
}

/** Convenience: default user-content builder that appends the standard analyze text after the images. */
export function defaultAnalysisUserContent(args: { imageParts: Array<{ type: 'image'; image: Buffer; mimeType: string }>; imageCount: number }): UserContent {
  return [
    ...args.imageParts,
    { type: 'text' as const, text: buildAnalysisUserText(args.imageCount) },
  ];
}
