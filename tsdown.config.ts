import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  dts: true,
  platform: "node",
  // The dsh installation supplies every @deepseek-ai/* package this plugin
  // imports, so they are not dependencies and the default externalization
  // would inline them into the published bundle.
  deps: { neverBundle: [/^@deepseek-ai\//] },
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
});
