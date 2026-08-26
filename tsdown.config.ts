import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: "esm",
  platform: "node",
  unbundle: true,
  fixedExtension: false,
  dts: true,
  publint: true,
});
