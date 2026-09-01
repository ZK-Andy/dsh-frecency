import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeGrepResult {
  items: Record<string, unknown>[];
  nextCursor: Record<string, never> | null;
  regexFallbackError?: string;
  totalMatched: number;
}

interface FakeGlobResult {
  items: { relativePath: string }[];
  totalMatched: number;
}

interface FakeFinderInstance {
  basePath: string;
  grepCalls: { query: string; options: unknown }[];
  globCalls: { pattern: string; options: unknown }[];
  grepResult: { ok: true; value: FakeGrepResult } | { ok: false; error: string };
  globResult: { ok: true; value: FakeGlobResult } | { ok: false; error: string };
  isDestroyed: boolean;
  destroy(): void;
  waitForScan(): Promise<{ ok: true; value: boolean }>;
  waitForIndexReady(): Promise<{ ok: true; value: boolean }>;
}

const instances: FakeFinderInstance[] = [];
let createError: string | null = null;
const defaults = {
  grepResult: { ok: true, value: { items: [], nextCursor: null, totalMatched: 0 } } as FakeFinderInstance["grepResult"],
  globResult: { ok: true, value: { items: [], totalMatched: 0 } } as FakeFinderInstance["globResult"],
  /** Per-page next cursors: popped per grep call; empty queue means exhausted. */
  cursorQueue: [] as Record<string, never>[],
};

const rgDefaults = vi.hoisted(() => ({
  /** `null` = runRgFiles rejects (spawn failure / non-zero rg exit). */
  result: null as { paths: string[]; complete: boolean } | null,
  error: null as string | null,
  calls: [] as { argv: string[]; cwd: string; budget: number }[],
}));

vi.mock("../src/rg.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/rg.ts")>();
  return {
    ...actual,
    runRgFiles: (argv: string[], cwd: string, budget: number) => {
      rgDefaults.calls.push({ argv, cwd, budget });
      if (rgDefaults.error !== null) return Promise.reject(new Error(rgDefaults.error));
      return Promise.resolve(rgDefaults.result ?? { paths: [], complete: true });
    },
  };
});

vi.mock("@ff-labs/fff-node", () => ({
  FileFinder: {
    create: (options: { basePath: string }) => {
      if (createError !== null) return { ok: false, error: createError };
      const instance: FakeFinderInstance = {
        basePath: options.basePath,
        grepCalls: [],
        globCalls: [],
        grepResult: undefined as unknown as FakeFinderInstance["grepResult"],
        globResult: undefined as unknown as FakeFinderInstance["globResult"],
        isDestroyed: false,
        destroy() {
          instance.isDestroyed = true;
        },
        async waitForScan() {
          return { ok: true, value: true };
        },
        async waitForIndexReady() {
          return { ok: true, value: true };
        },
      };
      instance.grep = (query: string, options: unknown) => {
        instance.grepCalls.push({ query, options });
        const base = instance.grepResult ?? defaults.grepResult;
        if (!base.ok) return base;
        return { ok: true, value: { ...base.value, nextCursor: defaults.cursorQueue.shift() ?? null } };
      };
      instance.glob = (pattern: string, options: unknown) => {
        instance.globCalls.push({ pattern, options });
        return instance.globResult ?? defaults.globResult;
      };
      instances.push(instance);
      return { ok: true, value: instance };
    },
  },
}));

const { defineGrepTool } = await import("../src/grep.ts");
const { defineGlobTool } = await import("../src/glob.ts");

const caps = {
  grepMaxMatches: 250,
  grepMaxLineBytes: 1000,
  globMaxResults: 100,
  sampleOverCapGlobResults: false,
  searchMetaMaxBytes: 10_000,
  timeoutMs: 30_000,
};

function execFor(cwd: string) {
  return { agent: { session: { header: { cwd } } } } as never;
}

function fffItem(relativePath: string, lineNumber: number, line: string) {
  return { relativePath, fileName: relativePath.split("/").pop(), lineNumber, lineContent: line };
}

beforeEach(async () => {
  const { releaseFinders } = await import("../src/finder.ts");
  releaseFinders();
  instances.length = 0;
  createError = null;
  defaults.grepResult = { ok: true, value: { items: [], nextCursor: null, totalMatched: 0 } };
  defaults.globResult = { ok: true, value: { items: [], totalMatched: 0 } };
  defaults.cursorQueue = [];
  rgDefaults.result = null;
  rgDefaults.error = null;
  rgDefaults.calls = [];
});

describe("grep tool", () => {
  it("maps fff matches onto the built-in output shape, engine order preserved", async () => {
    const tool = defineGrepTool(caps);
    defaults.grepResult = {
      ok: true,
      value: { items: [fffItem("src/b.ts", 2, "beta"), fffItem("src/a.ts", 1, "alpha")], nextCursor: null, totalMatched: 2 },
    };
    const value = (await tool.execute!({ pattern: "x" }, execFor("/ws"))) as { matches: unknown[] };
    expect(value).toEqual({
      matches: [
        { path: "src/b.ts", lineNumber: 2, line: "beta" },
        { path: "src/a.ts", lineNumber: 1, line: "alpha" },
      ],
      truncated: false,
    });
    expect(instances[0]!.grepCalls[0]).toEqual({
      query: "x",
      options: { mode: "regex", smartCase: false, pageSize: 500, cursor: null },
    });
  });

  it("applies a workspace-relative path prefix filter", async () => {
    const tool = defineGrepTool(caps);
    defaults.grepResult = {
      ok: true,
      value: { items: [fffItem("src/a.ts", 1, "a"), fffItem("docs/b.md", 1, "b")], nextCursor: null, totalMatched: 2 },
    };
    const value = (await tool.execute!({ pattern: "x", path: "src" }, execFor("/ws"))) as { matches: unknown[] };
    expect(value.matches).toEqual([{ path: "src/a.ts", lineNumber: 1, line: "a" }]);
  });

  it("applies the include glob filter after the engine", async () => {
    const tool = defineGrepTool(caps);
    defaults.grepResult = {
      ok: true,
      value: { items: [fffItem("src/a.ts", 1, "a"), fffItem("src/b.js", 1, "b")], nextCursor: null, totalMatched: 2 },
    };
    const value = (await tool.execute!({ pattern: "x", include: "*.ts" }, execFor("/ws"))) as { matches: unknown[] };
    expect(value.matches).toEqual([{ path: "src/a.ts", lineNumber: 1, line: "a" }]);
  });

  it("reuses the resident finder across calls with the same workspace", async () => {
    const tool = defineGrepTool(caps);
    await tool.execute!({ pattern: "one" }, execFor("/ws"));
    await tool.execute!({ pattern: "two" }, execFor("/ws"));
    expect(instances).toHaveLength(1);
    expect(instances[0]!.grepCalls).toHaveLength(2);
  });

  it("fetches further pages until the engine is exhausted", async () => {
    const tool = defineGrepTool(caps);
    const cursor = { __brand: "GrepCursor" } as Record<string, never>;
    defaults.grepResult = {
      ok: true,
      value: { items: [fffItem("src/a.ts", 1, "a")], nextCursor: cursor, totalMatched: 2 },
    };
    defaults.cursorQueue = [cursor];
    const value = (await tool.execute!({ pattern: "x" }, execFor("/ws"))) as {
      matches: unknown[];
      truncated: boolean;
    };
    expect(instances[0]!.grepCalls).toHaveLength(2);
    expect(instances[0]!.grepCalls[1]!.options).toMatchObject({ cursor });
    expect(value.truncated).toBe(false);
    // The engine contract promises no duplicates across pages; the fixture
    // repeats its one item, so assert on the concatenated page count instead.
    expect(value.matches).toHaveLength(2);
  });

  it("reports engine-side truncation even when the filtered count is small", async () => {
    const tool = defineGrepTool(caps);
    const cursor = { __brand: "GrepCursor" } as Record<string, never>;
    defaults.grepResult = {
      ok: true,
      value: { items: [fffItem("src/a.ts", 1, "a")], nextCursor: cursor, totalMatched: 99_999 },
    };
    defaults.cursorQueue = [cursor, cursor, cursor, cursor];
    // Every page reports more matches behind the cursor until MAX_PAGES runs out.
    const value = (await tool.execute!({ pattern: "x" }, execFor("/ws"))) as { truncated: boolean };
    expect(value.truncated).toBe(true);
    expect(instances[0]!.grepCalls).toHaveLength(4);
  });

  it("surfaces a regex compile fallback as an error instead of literal matching", async () => {
    const tool = defineGrepTool(caps);
    defaults.grepResult = {
      ok: true,
      value: { items: [fffItem("src/a.ts", 1, "a(")], nextCursor: null, totalMatched: 1, regexFallbackError: "unclosed group" },
    };
    await expect(tool.execute!({ pattern: "a(" }, execFor("/ws"))).rejects.toThrow("not a valid regular expression");
  });

  it("surfaces an engine failure as a thrown error (tool call becomes isError)", async () => {
    const tool = defineGrepTool(caps);
    defaults.grepResult = { ok: false, error: "boom" };
    await expect(tool.execute!({ pattern: "x" }, execFor("/ws"))).rejects.toThrow("fff grep failed: boom");
  });

  it("renders through the built-in formatter and projects the matches card meta", async () => {
    const tool = defineGrepTool(caps);
    defaults.grepResult = {
      ok: true,
      value: { items: [fffItem("src/a.ts", 3, "let v = 3")], nextCursor: null, totalMatched: 1 },
    };
    const value = { matches: [{ path: "src/a.ts", lineNumber: 3, line: "let v = 3" }], truncated: false };
    const rendered = tool.output.render({}, value as never);
    expect(rendered[0]).toMatchObject({ type: "text" });
    expect((rendered[0] as { text: string }).text).toContain("src/a.ts");
    const meta = tool.output.presentationMeta!({}, value as never) as { shape: string; total: number };
    expect(meta).toMatchObject({ shape: "matches", total: 1, truncated: false });
  });
});

describe("glob tool", () => {
  it("serves through the built-in rg contract, mapped onto display paths", async () => {
    const tool = defineGlobTool(caps);
    rgDefaults.result = { paths: ["docs/design.md", "README.md"], complete: true };
    const value = (await tool.execute!({ pattern: "*.md" }, execFor("/ws"))) as { root: string; paths: string[] };
    expect(value).toEqual({ root: ".", paths: ["docs/design.md", "README.md"], truncated: false });
    // The exact argv the built-in glob tool spawns: files mode, mtime order,
    // hidden + ignored included, VCS metadata pruned, config injection blocked.
    expect(rgDefaults.calls[0]!.argv).toEqual([
      "--no-config",
      "--files",
      "--glob=*.md",
      "--sort=modified",
      "--no-ignore",
      "--hidden",
      ...[".git", ".svn", ".hg", ".bzr", ".jj", ".sl"].flatMap((name) => [`--glob=!**/${name}`, `--glob=!**/${name}/**`]),
    ]);
    expect(rgDefaults.calls[0]!.cwd).toBe("/ws");
    expect(instances).toHaveLength(0);
  });

  it("narrows the traversal and prefix-filters when a path argument selects a subtree", async () => {
    const tool = defineGlobTool(caps);
    rgDefaults.result = { paths: ["docs/design.md", "README.md"], complete: true };
    const value = (await tool.execute!({ pattern: "*.md", path: "docs" }, execFor("/ws"))) as {
      root: string;
      paths: string[];
    };
    expect(value.paths).toEqual(["docs/design.md"]);
    expect(rgDefaults.calls[0]!.argv.slice(-2)).toEqual(["--", "docs"]);
  });

  it("reports truncation when the fetch budget cut the listing", async () => {
    const tool = defineGlobTool(caps);
    rgDefaults.result = { paths: ["a.txt"], complete: false };
    const value = (await tool.execute!({ pattern: "*" }, execFor("/ws"))) as { truncated: boolean };
    expect(value.truncated).toBe(true);
  });

  it("falls back to the resident index when rg fails, reusing the finder across calls", async () => {
    const tool = defineGlobTool(caps);
    rgDefaults.error = "spawn rg ENOENT";
    defaults.globResult = {
      ok: true,
      value: { items: [{ relativePath: "docs/design.md" }, { relativePath: "README.md" }], totalMatched: 2 },
    };
    await tool.execute!({ pattern: "*.md" }, execFor("/ws"));
    await tool.execute!({ pattern: "*.ts" }, execFor("/ws"));
    expect(instances).toHaveLength(1);
    expect(instances[0]!.globCalls.map((call) => call.pattern)).toEqual(["*.md", "*.ts"]);
  });

  it("falls back to the ephemeral slot for an out-of-workspace path", async () => {
    const tool = defineGlobTool(caps);
    rgDefaults.error = "rg exited with code 2";
    defaults.globResult = { ok: true, value: { items: [{ relativePath: "a.txt" }], totalMatched: 1 } };
    const value = (await tool.execute!({ pattern: "*.txt", path: "/elsewhere" }, execFor("/ws"))) as {
      paths: string[];
    };
    expect(value.paths).toEqual(["/elsewhere/a.txt"]);
    expect(instances[0]!.basePath).toBe("/elsewhere");
  });
});
