#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { packagedAssetPath, readPackagedAsset } from "./assets";
import { checkDocumentation, type CheckOptions } from "./check";
import { initializeKnowledge } from "./init";

const usage = `Usage:
  muninn --version
  muninn check [root] [--external] [--manifest path]
  muninn init [root] [--template full|minimal|<dir>] [--obsidian]
  muninn default --path
  muninn setup-prompt [--path]

External options (require --external):
  --timeout <ms>        Per-request timeout (default: 5000)
  --retries <count>     Transient retries (default: 1)
  --max-redirects <n>   Redirect limit (default: 5)
  --concurrency <n>     Concurrent requests (default: 5)`;

function integer(value: string | undefined, option: string): number {
  if (!value || !/^\d+$/.test(value)) throw new Error(`${option} needs a non-negative integer`);
  return Number(value);
}

function displayPath(root: string): string {
  return relative(process.cwd(), resolve(root)).split(sep).join("/") || ".";
}

function checkOptions(args: string[]): { options: CheckOptions; root: string } {
  const options: CheckOptions = {};
  let root = process.cwd();
  let positional = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--external") options.external = true;
    else if (argument === "--manifest") {
      const value = args[++index];
      if (!value) throw new Error("--manifest needs a value");
      options.manifest = value;
    } else if (
      ["--timeout", "--retries", "--max-redirects", "--concurrency"].includes(argument ?? "")
    ) {
      const value = integer(args[++index], argument!);
      options.externalOptions ??= {};
      if (argument === "--timeout") options.externalOptions.timeoutMs = value;
      else if (argument === "--retries") options.externalOptions.retries = value;
      else if (argument === "--max-redirects") options.externalOptions.maxRedirects = value;
      else options.externalOptions.concurrency = value;
    } else if (argument?.startsWith("-")) throw new Error(`unknown option: ${argument}`);
    else if (argument && !positional) {
      root = argument;
      positional = true;
    } else throw new Error(`unexpected argument: ${argument}`);
  }
  if (options.externalOptions && !options.external) {
    throw new Error("--timeout, --retries, --max-redirects, and --concurrency require --external");
  }
  return { options, root };
}

async function runCheck(args: string[]): Promise<number> {
  const { options, root } = checkOptions(args);
  const failures = await checkDocumentation(root, options);
  if (failures.length) {
    console.error(failures.join("\n"));
    return 1;
  }
  console.log(`project knowledge checks passed for ${displayPath(root)}`);
  return 0;
}

function runInit(args: string[]): number {
  let root: string | undefined;
  let template: string | undefined;
  let obsidian = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--template") {
      const value = args[++index];
      if (!value) throw new Error("--template needs a value");
      template = value;
    } else if (argument === "--obsidian") {
      obsidian = true;
    } else if (argument?.startsWith("-")) throw new Error(`unknown option: ${argument}`);
    else if (root === undefined) root = argument;
    else throw new Error("init accepts at most one root");
  }
  const result = initializeKnowledge(root ?? process.cwd(), { template, obsidian });
  for (const name of result.created) console.log(`created ${name}`);
  for (const name of result.skipped) console.log(`kept existing ${name}`);
  console.log(
    `\ninitialized ${displayPath(root ?? process.cwd())}: ${result.created.length} created, ${result.skipped.length} kept`,
  );
  console.log(
    "\nTo backfill the scaffold from this repository's existing knowledge, run `muninn setup-prompt` and paste the one-time prompt into a coding agent.",
  );
  console.log("Getting started: https://github.com/rasmushjulskov/muninn#quick-start");
  return 0;
}

function runDefault(args: string[]): number {
  if (args.length === 0) throw new Error("default requires --path");
  if (args.length !== 1 || args[0] !== "--path") throw new Error("default accepts only --path");
  console.log(packagedAssetPath("DEFAULT.md"));
  return 0;
}

function runSetupPrompt(args: string[]): number {
  if (args.length === 0) {
    process.stdout.write(readPackagedAsset("SETUP_PROMPT.md"));
    return 0;
  }
  if (args.length !== 1 || args[0] !== "--path") {
    throw new Error("setup-prompt accepts no arguments or --path");
  }
  console.log(packagedAssetPath("SETUP_PROMPT.md"));
  return 0;
}

async function runCli(args = process.argv.slice(2)): Promise<number> {
  try {
    const [command, ...rest] = args;
    if (command === "check") return await runCheck(rest);
    if (command === "init") return runInit(rest);
    if (command === "default") return runDefault(rest);
    if (command === "setup-prompt") return runSetupPrompt(rest);
    if (command === "--version" || command === "-v") {
      if (rest.length) throw new Error("--version accepts no arguments");
      const packageJson = JSON.parse(
        readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
      ) as { version?: unknown };
      if (typeof packageJson.version !== "string") throw new Error("package version is invalid");
      console.log(packageJson.version);
      return 0;
    }
    if (command === "--help" || command === "-h") {
      console.log(usage);
      return 0;
    }
    throw new Error(command ? `unknown command: ${command}` : "missing command");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage);
    return 2;
  }
}

process.exit(await runCli());
