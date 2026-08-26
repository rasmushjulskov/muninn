import { describe, expect, test } from "bun:test";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

import { packagedAssetPath, readPackagedAsset } from "../src/assets";

const workspace = resolve(import.meta.dir, "..");
const cli = resolve(workspace, "src/cli.ts");

function captureCli(args: string[]): { code: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["bun", cli, ...args], { stdout: "pipe", stderr: "pipe" });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

describe("packaged onboarding assets", () => {
  test("resolves canonical source-mode paths and content", () => {
    for (const name of ["DEFAULT.md", "SETUP_PROMPT.md"] as const) {
      const expected = realpathSync(resolve(workspace, name));
      expect(packagedAssetPath(name)).toBe(expected);
      expect(readPackagedAsset(name)).toBe(readFileSync(expected, "utf8"));
    }
  });

  test("prints the setup prompt exactly and returns both asset paths", async () => {
    const prompt = captureCli(["setup-prompt"]);
    expect(prompt).toEqual({ code: 0, stdout: readPackagedAsset("SETUP_PROMPT.md"), stderr: "" });

    for (const [command, name] of [
      ["default", "DEFAULT.md"],
      ["setup-prompt", "SETUP_PROMPT.md"],
    ] as const) {
      expect(captureCli([command, "--path"])).toEqual({
        code: 0,
        stdout: `${packagedAssetPath(name)}\n`,
        stderr: "",
      });
    }
  });

  test("rejects unsupported asset command options and arguments deterministically", async () => {
    const cases: Array<[string[], string]> = [
      [["default"], "default requires --path"],
      [["default", "--unknown"], "default accepts only --path"],
      [["default", "--path", "extra"], "default accepts only --path"],
      [["setup-prompt", "--unknown"], "setup-prompt accepts no arguments or --path"],
      [["setup-prompt", "--path", "extra"], "setup-prompt accepts no arguments or --path"],
    ];
    for (const [args, message] of cases) {
      const result = captureCli(args);
      expect(result.code).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr.split("\n")[0]).toBe(message);
    }
  });
});
