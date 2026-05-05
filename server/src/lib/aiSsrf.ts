import dns from 'node:dns';
import { promisify } from 'node:util';
import { Agent } from 'undici';
import { AiAnalysisError } from './aiErrors.js';
import { config as appConfig } from './config.js';

const dnsResolve4 = promisify(dns.resolve4);
const dnsResolve6 = promisify(dns.resolve6);

/** Known AI provider hostnames that are always allowed. */
const ALLOWED_AI_HOSTS = new Set([
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
]);

/** Check if an IP address is in a private/reserved range (SSRF protection). */
function isPrivateIp(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length === 4 && parts.every((p) => p >= 0 && p <= 255)) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local / cloud metadata
    if (parts[0] === 0) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // CGNAT — cloud inter-VM
    if (parts[0] >= 224) return true; // 224/4 multicast + 240/4 reserved
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80:')) return true; // IPv6 link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // IPv6 unique local
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 — check the embedded IPv4
    return isPrivateIp(lower.slice(7));
  }
  return false;
}

/**
 * Validate an AI endpoint URL to prevent SSRF attacks.
 * Returns resolved IPs when DNS pinning is needed (cloud + custom host),
 * undefined when pinning is not needed (allowed host or self-hosted).
 */
export async function validateEndpointUrl(url: string, isDemoUser = false): Promise<string[] | undefined> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AiAnalysisError('NETWORK_ERROR', 'Invalid endpoint URL');
  }

  if (isDemoUser && !ALLOWED_AI_HOSTS.has(parsed.hostname)) {
    throw new AiAnalysisError('NETWORK_ERROR', 'Demo accounts cannot use custom AI endpoints');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AiAnalysisError('NETWORK_ERROR', 'Endpoint URL must use http or https');
  }

  if (ALLOWED_AI_HOSTS.has(parsed.hostname)) return undefined;

  // Self-hosted admin needs LAN access for local AI (Ollama, etc.) — skip DNS check
  if (appConfig.selfHosted) return undefined;

  try {
    const [ipv4s, ipv6s] = await Promise.all([
      dnsResolve4(parsed.hostname).catch(() => [] as string[]),
      dnsResolve6(parsed.hostname).catch(() => [] as string[]),
    ]);
    const allIps = [...ipv4s, ...ipv6s];
    if (allIps.length === 0) {
      throw new AiAnalysisError('NETWORK_ERROR', `Failed to resolve endpoint hostname: ${parsed.hostname}`);
    }
    for (const ip of allIps) {
      if (isPrivateIp(ip)) {
        throw new AiAnalysisError('NETWORK_ERROR', 'Endpoint URL must not resolve to a private or reserved IP address');
      }
    }
    return allIps;
  } catch (err) {
    if (err instanceof AiAnalysisError) throw err;
    throw new AiAnalysisError('NETWORK_ERROR', `Failed to resolve endpoint hostname: ${parsed.hostname}`);
  }
}

/** Create a fetch function that pins DNS to pre-validated IPs (prevents DNS rebinding). */
export function createPinnedFetch(resolvedIps: string[]): typeof globalThis.fetch {
  const ip = resolvedIps[0];
  const family = ip.includes(':') ? 6 : 4;
  const agent = new Agent({
    connect: {
      lookup: (
        _hostname: string,
        _options: unknown,
        cb: (err: Error | null, address: string, family: number) => void,
      ) => {
        cb(null, ip, family);
      },
    },
  });
  return ((input: unknown, init?: unknown) =>
    globalThis.fetch(input as Request, { ...(init as RequestInit), dispatcher: agent } as RequestInit)
  ) as typeof globalThis.fetch;
}

/** Validate `endpointUrl` and return a DNS-pinned fetch when pinning is required, otherwise undefined. */
export async function resolvePinnedFetch(
  endpointUrl: string | null,
  isDemoUser = false,
): Promise<typeof globalThis.fetch | undefined> {
  if (!endpointUrl) return undefined;
  const resolvedIps = await validateEndpointUrl(endpointUrl, isDemoUser);
  return resolvedIps ? createPinnedFetch(resolvedIps) : undefined;
}
