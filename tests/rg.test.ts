import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, utimesSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGlobArgv, GLOB_VCS_EXCLUDES, resolveRgPath, runRgFiles } from "../src/rg.ts";

describe("buildGlobArgv", () => {
  it("mirrors the built-in glob contract argument for argument", () => {
    expect(buildGlobArgv("*.md")).toEqual([
      "--no-config",
      "--files",
      "--glob=*.md",
      "--sort=modified",
      "--no-ignore",
      "--hidden",
      ...GLOB_VCS_EXCLUDES.flatMap((name) => [`--glob=!**/${name}`, `--glob=!**/${name}/**`]),
    ]);
  });

  it("anchors the traversal with -- when a subtree is selected", () => {
    expect(buildGlobArgv("*.md", "docs").slice(-2)).toEqual(["--", "docs"]);
  });
});

describe("runRgFiles (real packaged ripgrep)", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "dsh-frecency-rg-"));
    writeFileSync(join(root, "tracked.txt"), "");
    writeFileSync(join(root, "ignored.txt"), "");
    writeFileSync(join(root, ".hidden"), "");
    writeFileSync(join(root, ".gitignore"), "ignored.txt\n");
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "config"), "");
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "sub", "nested.txt"), "");
    // Distinct mtimes make --sort=modified deterministic.
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    utimesSync(join(root, "tracked.txt"), new Date(base), new Date(base));
    utimesSync(join(root, "ignored.txt"), new Date(base + 60_000), new Date(base + 60_000));
    utimesSync(join(root, ".hidden"), new Date(base + 120_000), new Date(base + 120_000));
    utimesSync(join(root, "sub", "nested.txt"), new Date(base + 180_000), new Date(base + 180_000));
    utimesSync(join(root, ".gitignore"), new Date(base + 240_000), new Date(base + 240_000));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("resolves the packaged ripgrep binary", async () => {
    const bin = await resolveRgPath();
    expect(execFileSync(bin, ["--version"], { encoding: "utf8" })).toContain("ripgrep");
  });

  it("includes hidden and gitignored files, excludes VCS metadata (built-in parity)", async () => {
    const { paths, complete } = await runRgFiles(buildGlobArgv("**/*"), root, 100);
    expect(complete).toBe(true);
    expect(paths).toContain("ignored.txt");
    expect(paths).toContain(".hidden");
    expect(paths).toContain(join("sub", "nested.txt"));
    expect(paths.some((p) => p === join(".git", "config"))).toBe(false);
  });

  it("orders by modification time, oldest first (built-in parity)", async () => {
    const { paths } = await runRgFiles(buildGlobArgv("**/*"), root, 100);
    expect(paths).toEqual(["tracked.txt", "ignored.txt", ".hidden", join("sub", "nested.txt"), ".gitignore"]);
  });

  it("cuts honestly at the budget", async () => {
    const { paths, complete } = await runRgFiles(buildGlobArgv("**/*"), root, 2);
    expect(complete).toBe(false);
    expect(paths).toHaveLength(2);
  });
});
