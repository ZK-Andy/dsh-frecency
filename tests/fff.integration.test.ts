import { afterAll, describe, expect, it } from "vitest";
import { FileFinder } from "@ff-labs/fff-node";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Real-engine integration: exercises the resident finder the same way the tools
 * do (create → scan → index ready → grep/glob). Skipped when the platform
 * binary is unavailable — engine coverage is supplementary to the unit suite.
 */
const canLoadEngine = await (async () => {
  try {
    const probe = FileFinder.create({ basePath: tmpdir() });
    if (!probe.ok) return false;
    probe.value.destroy();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!canLoadEngine)("fff-node integration", () => {
  const root = mkdtempSync(join(tmpdir(), "fff-it-"));
  writeFileSync(join(root, "needle.txt"), "the frecency needle is here\n");
  writeFileSync(join(root, "empty.md"), "nothing to see\n");

  afterAll(() => {
    if (finder.value) finder.value.destroy();
  });

  const finder = FileFinder.create({ basePath: root });

  it("creates the resident finder", () => {
    expect(finder.ok).toBe(true);
  });

  it("greps content after the index is ready", async () => {
    if (!finder.ok) return;
    expect((await finder.value.waitForScan(15_000)).ok).toBe(true);
    expect((await finder.value.waitForIndexReady(15_000)).ok).toBe(true);
    const result = finder.value.grep("frecency needle", { mode: "regex" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.length).toBeGreaterThanOrEqual(1);
    const hit = result.value.items.find((item) => item.relativePath === "needle.txt");
    expect(hit?.lineContent).toContain("frecency needle");
  });

  it("globs file paths", () => {
    if (!finder.ok) return;
    const result = finder.value.glob("*.txt");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((item) => item.relativePath)).toContain("needle.txt");
  });
});
