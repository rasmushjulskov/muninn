# One-time Muninn setup prompt

Status: canonical

`muninn setup-prompt` prints this prompt; `muninn init` points here after it creates the minimal contract, and `muninn init --template full` creates placeholders for every default role. Copy everything below into a capable coding agent while it is opened at the repository root.

---

Set up this repository's Muninn project knowledge contract once. Use Muninn's canonical default for structure and the repository's live files for facts. Do not reproduce or invent the default structure yourself.

## Read the real sources first

1. Run `muninn default --path` and read the returned `DEFAULT.md` completely. That file is the authority for target roles, lifecycle semantics, optional collections, manifest shape, and adoption invariants. If the command or file is unavailable, stop and report that Muninn's canonical default cannot be resolved.
2. Read the repository's current `docs/knowledge.yaml` when present, then its `README.md`, `AGENTS.md`, other root instruction files, and existing documentation indexes.
3. Read the repository-owned product/domain context, architecture documents, development guidance, runbooks, decisions, proposals, plans, guides, and solutions.
4. Inspect package manifests, task runners, CI, deployment configuration, source layout, and current validation commands only to verify facts missing from documentation.
5. Inspect the current branch, status, worktrees, and overlapping open work before editing.

`DEFAULT.md` defines where knowledge belongs. The target repository defines what is true. Current repository sources outrank examples, historical notes, and assumptions.

## Safety boundary

- Work only in this repository.
- Preserve every existing file and all unrelated changes.
- Do not reset, delete, move, rename, commit, push, open a pull request, publish, deploy, install global tools, or modify external systems.
- Never invent product facts, architecture, commands, owners, credentials, deployment behavior, or approval state.
- When sources conflict, preserve the conflict, identify it, and use only evidence-backed current authority.

## Adoption procedure

1. Build an authority map before editing. For each role defined by `DEFAULT.md`, name the existing source that already satisfies it, the missing source that must be created, and any conflict requiring human review.
2. Reuse strong authorities in place. Create a default document only for a genuinely missing role. Fill new documents only with facts supported by the live repository; use `TODO: human decision required` for consequential unknowns.
3. Treat placeholder documents scaffolded by `muninn init --template full` (marked with `TODO` and `Status: proposed`) as structure, not facts. Backfill each placeholder from the live repository, then promote it to `canonical`. When an existing document already satisfies the role, point the manifest and index at that document and mark the redundant placeholder superseded by it.
4. Create or update the human route, agent route, knowledge index, lifecycle labels, and manifest according to `DEFAULT.md`. Preserve richer existing instructions instead of replacing them.
5. Keep navigation portable. Use GitHub-renderable relative Markdown links and do not require wikilinks, embeds, block IDs, plugin queries, community plugins, or committed editor state. Preserve `.gitignore` unchanged unless the user explicitly selected Obsidian support; only then append `.obsidian/` when absent while preserving every existing rule and its order.
6. Populate verification only from commands the repository already owns. Add a knowledge-check script to the existing canonical check only when the repository's task runner supports that integration cleanly.
7. Run the installed Muninn binary with `muninn check .` or the repository-owned equivalent. Do not download or execute a mutable `latest` package. Fix deterministic findings without weakening the contract.
8. Run every adoption invariant from `DEFAULT.md`, including idempotence, preservation, direct indexing, portable relative navigation, conditional Obsidian exclusion behavior, non-empty active authority, valid replacement edges, and rejection of an all-archived knowledge set.

## Stop condition

Stop without committing. Report:

- live sources inspected;
- authority map and classifications;
- files created and edited;
- commands run with real results;
- unresolved conflicts or human decisions;
- the exact blocker if the contract cannot pass honestly.

Complete only when the repository satisfies the canonical `DEFAULT.md`, its own current knowledge remains authoritative, and Muninn passes without hiding or misclassifying current information.

---
