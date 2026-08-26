export const authorityStatuses = ["active", "superseded", "archived"] as const;

export type AuthorityStatus = (typeof authorityStatuses)[number];

export const authorityKinds = ["constraint", "decision", "guide", "reference", "plan"] as const;

export type AuthorityKind = (typeof authorityKinds)[number];

export interface Authority {
  path: string;
  status: AuthorityStatus;
  replacement?: string;
  kind?: AuthorityKind;
  scope?: string[];
  reviewed?: string;
}

export interface KnowledgeManifest {
  version: 1;
  entrypoints: {
    human: string;
    agent: string;
    index: string;
  };
  authorities: Authority[];
  verification: Array<{
    name: string;
    command: string[];
  }>;
}

export interface ResolvedLink {
  external?: string;
  fragment?: string;
  path?: string;
  error?: string;
}

export interface ExternalResult {
  ok: boolean;
  classification: "ok" | "http" | "network" | "timeout" | "redirect" | "malformed" | "protocol";
  status?: number;
  detail?: string;
}

export interface ExternalOptions {
  cache?: Map<string, ExternalResult>;
  concurrency?: number;
  exceptions?: Set<string>;
  fetcher?: typeof fetch;
  maxRedirects?: number;
  retries?: number;
  timeoutMs?: number;
}
