import type { ExternalOptions, ExternalResult } from "./types";

interface RequestContext {
  fetcher: typeof fetch;
  maxRedirects: number;
  timeoutMs: number;
}

interface RequestState {
  method: "HEAD" | "GET";
  redirects: number;
  url: string;
}

function timeoutResult(error: unknown): ExternalResult {
  const detail = error instanceof Error ? error.message : String(error);
  const timeout = error instanceof DOMException && error.name === "TimeoutError";
  return { ok: false, classification: timeout ? "timeout" : "network", detail };
}

async function request(
  url: string,
  method: "HEAD" | "GET",
  context: RequestContext,
  redirects = 0,
): Promise<ExternalResult> {
  let response: Response;
  try {
    response = await context.fetcher(url, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(context.timeoutMs),
    });
  } catch (error) {
    return timeoutResult(error);
  }
  return responseResult(response, { url, method, redirects }, context);
}

async function dispose(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Response cleanup must not obscure the link result.
  }
}

function normalizedRedirect(
  location: string,
  state: RequestState,
  status: number,
): { key?: string; failure?: ExternalResult } {
  let redirected: string;
  try {
    redirected = new URL(location, state.url).href;
  } catch {
    return {
      failure: { ok: false, classification: "redirect", status },
    };
  }
  return normalizedKey(redirected);
}

async function responseResult(
  response: Response,
  state: RequestState,
  context: RequestContext,
): Promise<ExternalResult> {
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    await dispose(response);
    if (!location || state.redirects >= context.maxRedirects) {
      return { ok: false, classification: "redirect", status: response.status };
    }
    const normalized = normalizedRedirect(location, state, response.status);
    if (!normalized.key) return normalized.failure!;
    return request(normalized.key, state.method, context, state.redirects + 1);
  }
  if (state.method === "HEAD" && (response.status === 405 || response.status === 501)) {
    await dispose(response);
    return request(state.url, "GET", context, state.redirects);
  }
  await dispose(response);
  return response.ok
    ? { ok: true, classification: "ok", status: response.status }
    : { ok: false, classification: "http", status: response.status };
}

function retryable(result: ExternalResult): boolean {
  return (
    result.classification === "network" ||
    result.classification === "timeout" ||
    (result.classification === "http" && (result.status ?? 0) >= 500)
  );
}

async function requestWithRetries(
  key: string,
  context: RequestContext,
  retries: number,
): Promise<ExternalResult> {
  let result: ExternalResult = { ok: false, classification: "network" };
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    result = await request(key, "HEAD", context);
    if (!retryable(result)) break;
  }
  return result;
}

function normalizedKey(input: string): { key?: string; failure?: ExternalResult } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { failure: { ok: false, classification: "malformed", detail: "malformed URL" } };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      failure: {
        ok: false,
        classification: "protocol",
        detail: `unsupported protocol ${url.protocol}`,
      },
    };
  }
  url.hash = "";
  return { key: url.href };
}

function requestContext(options: ExternalOptions): RequestContext {
  return {
    fetcher: options.fetcher ?? fetch,
    maxRedirects: options.maxRedirects ?? 5,
    timeoutMs: options.timeoutMs ?? 5_000,
  };
}

function isExcepted(options: ExternalOptions, key: string, input: string): boolean {
  return Boolean(options.exceptions?.has(key) || options.exceptions?.has(input));
}

export async function checkExternalUrl(
  input: string,
  options: ExternalOptions = {},
): Promise<ExternalResult> {
  const normalized = normalizedKey(input);
  if (!normalized.key) return normalized.failure!;
  const key = normalized.key;
  if (isExcepted(options, key, input)) {
    return { ok: true, classification: "ok", detail: "excepted" };
  }
  const cached = options.cache?.get(key);
  if (cached) return cached;
  const result = await requestWithRetries(key, requestContext(options), options.retries ?? 1);
  options.cache?.set(key, result);
  return result;
}

export async function externalFailures(
  locations: Map<string, Set<string>>,
  options: ExternalOptions = {},
): Promise<string[]> {
  const entries = [...locations];
  const failures: string[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < entries.length) {
      const [url, sources] = entries[next++]!;
      const result = await checkExternalUrl(url, options);
      if (!result.ok) {
        const detail = result.status
          ? `status ${result.status}`
          : (result.detail ?? result.classification);
        failures.push(`${[...sources].sort().join(", ")}: external link ${url} failed (${detail})`);
      }
    }
  }
  const workers = Math.min(Math.max(options.concurrency ?? 5, 1), entries.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return failures.sort();
}
