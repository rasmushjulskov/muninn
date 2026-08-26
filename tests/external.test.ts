import { afterEach, describe, expect, test } from "bun:test";

import { checkExternalUrl, externalFailures } from "../src/external";
import type { ExternalResult } from "../src/types";

const servers: Array<ReturnType<typeof Bun.serve>> = [];

function fixture() {
  const hits = new Map<string, number>();
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1);
      if (url.pathname === "/redirect") {
        return new Response(null, { status: 302, headers: { location: "/head-disabled" } });
      }
      if (url.pathname === "/head-disabled") {
        return request.method === "HEAD" ? new Response(null, { status: 405 }) : new Response("ok");
      }
      if (url.pathname === "/flaky" && hits.get(url.pathname) === 1) {
        return new Response(null, { status: 503 });
      }
      if (url.pathname === "/loop") {
        return new Response(null, { status: 302, headers: { location: "/loop" } });
      }
      if (url.pathname === "/slow") await Bun.sleep(50);
      if (url.pathname === "/missing") return new Response(null, { status: 404 });
      return new Response(null, { status: 204 });
    },
  });
  servers.push(server);
  return { base: server.url.href.replace(/\/$/, ""), hits };
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

function classification(result: ExternalResult) {
  return result.classification;
}

function requestUrl(input: string | URL | Request): URL {
  return new URL(input instanceof Request ? input.url : input);
}

function requestMethod(init?: RequestInit): string {
  return init?.method ?? "GET";
}

describe("external knowledge-link adapter", () => {
  test("classifies malformed and unsupported URLs before fetch", async () => {
    let calls = 0;
    const fetcher = (() => {
      calls += 1;
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as unknown as typeof fetch;

    expect(await checkExternalUrl("http://%", { fetcher })).toEqual({
      ok: false,
      classification: "malformed",
      detail: "malformed URL",
    });
    expect(await checkExternalUrl("ftp://example.com/file", { fetcher })).toEqual({
      ok: false,
      classification: "protocol",
      detail: "unsupported protocol ftp:",
    });
    expect(calls).toBe(0);
  });

  test("rejects unsupported redirect protocols before another fetch", async () => {
    const calls: string[] = [];
    let cancellations = 0;
    const fetcher = (async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      return new Response(
        new ReadableStream({
          cancel() {
            cancellations += 1;
          },
        }),
        { status: 302, headers: { location: "ftp://example.test/file" } },
      );
    }) as unknown as typeof fetch;

    expect(await checkExternalUrl("https://example.test/start", { fetcher, retries: 0 })).toEqual({
      ok: false,
      classification: "protocol",
      detail: "unsupported protocol ftp:",
    });
    expect(calls).toEqual(["https://example.test/start"]);
    expect(calls.some((url) => url.startsWith("ftp:"))).toBe(false);
    expect(cancellations).toBe(1);
  });

  test("cancels response bodies across terminal, fallback, redirect, and retry paths", async () => {
    let cancellations = 0;
    const attempts = new Map<string, number>();
    const response = (status: number, headers?: ResponseInit["headers"]) =>
      new Response(
        new ReadableStream({
          cancel() {
            cancellations += 1;
          },
        }),
        { status, ...(headers ? { headers } : {}) },
      );
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = requestMethod(init);
      const key = `${method} ${url.pathname}`;
      attempts.set(key, (attempts.get(key) ?? 0) + 1);
      if (url.pathname === "/fallback" && method === "HEAD") return response(405);
      if (url.pathname === "/redirect") return response(302, { location: "/terminal" });
      if (url.pathname === "/retry" && attempts.get(key) === 1) return response(503);
      return response(200);
    }) as unknown as typeof fetch;

    expect((await checkExternalUrl("https://example.test/terminal", { fetcher })).ok).toBe(true);
    expect(cancellations).toBe(1);
    expect((await checkExternalUrl("https://example.test/fallback", { fetcher })).ok).toBe(true);
    expect(cancellations).toBe(3);
    expect((await checkExternalUrl("https://example.test/redirect", { fetcher })).ok).toBe(true);
    expect(cancellations).toBe(5);
    expect((await checkExternalUrl("https://example.test/retry", { fetcher, retries: 1 })).ok).toBe(
      true,
    );
    expect(cancellations).toBe(7);
  });

  test("follows bounded redirects and falls back from HEAD to GET", async () => {
    const { base, hits } = fixture();
    const result = await checkExternalUrl(`${base}/redirect`, { retries: 0 });
    expect(result.ok).toBe(true);
    expect(hits.get("/redirect")).toBe(1);
    expect(hits.get("/head-disabled")).toBe(2);
  });

  test("preserves the redirect budget when falling back from HEAD to GET", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = requestMethod(init);
      calls.push(`${method} ${url.pathname}`);
      if (url.pathname === "/start") {
        return new Response(null, { status: 302, headers: { location: "/fallback" } });
      }
      if (url.pathname === "/fallback" && method === "HEAD")
        return new Response(null, { status: 405 });
      return new Response(null, { status: 302, headers: { location: "/unfetched" } });
    }) as unknown as typeof fetch;

    const result = await checkExternalUrl("https://example.test/start", {
      fetcher,
      maxRedirects: 1,
      retries: 0,
    });
    expect(result.classification).toBe("redirect");
    expect(calls).toEqual(["HEAD /start", "HEAD /fallback", "GET /fallback"]);
  });

  test("retries transient responses and exposes cache and exception seams", async () => {
    const { base, hits } = fixture();
    const cache = new Map<string, ExternalResult>();
    expect((await checkExternalUrl(`${base}/flaky`, { cache, retries: 1 })).ok).toBe(true);
    expect(hits.get("/flaky")).toBe(2);
    expect((await checkExternalUrl(`${base}/flaky`, { cache, retries: 1 })).ok).toBe(true);
    expect(hits.get("/flaky")).toBe(2);
    const excepted = await checkExternalUrl(`${base}/missing`, {
      exceptions: new Set([`${base}/missing`]),
    });
    expect(excepted.detail).toBe("excepted");
    expect(hits.get("/missing")).toBeUndefined();
  });

  test("checks links through a bounded concurrent worker pool", async () => {
    let active = 0;
    let peak = 0;
    const fetcher = (async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Bun.sleep(10);
      active -= 1;
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;
    const locations = new Map<string, Set<string>>();
    for (let index = 0; index < 6; index += 1) {
      locations.set(`https://example.test/${index}`, new Set([`doc-${index}.md`]));
    }

    const failures = await externalFailures(locations, { fetcher, retries: 0, concurrency: 2 });
    expect(failures).toHaveLength(6);
    expect(failures[0]).toContain("external link https://example.test/0 failed (status 404)");
    expect(peak).toBe(2);
  });

  test("classifies redirect limits, HTTP failures, and timeouts", async () => {
    const { base } = fixture();
    expect(
      classification(await checkExternalUrl(`${base}/loop`, { maxRedirects: 1, retries: 0 })),
    ).toBe("redirect");
    const missing = await checkExternalUrl(`${base}/missing`, { retries: 0 });
    expect([classification(missing), missing.status]).toEqual(["http", 404]);
    expect(
      classification(await checkExternalUrl(`${base}/slow`, { retries: 0, timeoutMs: 5 })),
    ).toBe("timeout");
  });
});
