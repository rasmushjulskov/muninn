export { checkDocumentation, type CheckOptions } from "./check";
export { checkExternalUrl, externalFailures } from "./external";
export { initializeKnowledge, knowledgeTemplate, type InitOptions, type InitResult } from "./init";
export { loadKnowledgeManifest, manifestFailures } from "./manifest";
export type {
  Authority,
  AuthorityKind,
  AuthorityStatus,
  ExternalOptions,
  ExternalResult,
  KnowledgeManifest,
} from "./types";
