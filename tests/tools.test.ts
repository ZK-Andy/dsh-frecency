import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeFinderInstance {
  basePath: string;
  grepCalls: { query: string; options: unknown }[];
  globCalls: { pattern: string; options: unknown }[];
  grepResult: { ok: true; value: { items: Record<string, unknown>[] } } | { ok: false; error: string };
  globResult: { ok: true; value: { items: { relativePath: string }[] } } | { ok: false; error: string };
  isDestroyed: boolean;
  destroy(): void;
  waitForScan(): Promise<{ ok: true; value: boolean }>;
  waitForIndexReady(): Promise<{ ok: true; value: boolean }>;
}

const instances: FakeFinderInstance[] = [];
let createError: string | null = null;
const defaults = {
  grepResult: { ok: true, value: { items: [] as Record<string, unknown>[] } } as FakeFinderInstance["grepResult"],
  globResult: { ok: true, value: { items: [] as { relativePath: string }[] } } as FakeFinderInstance["globResult"],
};

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
        return instance.grepResult ?? defaults.grepResult;
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
  defaults.grepResult = { ok: true, value: { items: [] } };
  defaults.globResult = { ok: true, value: { items: [] } };
});

describe("grep tool", () => {
  it("maps fff matches onto the built-in output shape, engine order preserved", async () => {
    const tool = defineGrepTool(caps);
    defaults.grepResult = {
      ok: true,
      value: { items: [fffItem("src/b.ts", 2, "beta"), fffItem("src/a.ts", 1, "alpha")] },
    };
    const value = (await tool.execute!({ pattern: "x" }, execFor("/ws"))) as { matches: unknown[] };
    expect(value).toEqual({
      matches: [
        { path: "src/b.ts", lineNumber: 2, line: "beta" },
        { path: "src/a.ts", lineNumber: 1, line: "alpha" },
      ],
    });
    expect(instances[0]!.grepCalls[0]).toEqual({ query: "x", options: { mode: "regex", pageSize: 1000 } });
  });

  it("applies a workspace-relative path prefix filter", async () => {
    const tool = defineGrepTool(caps);
    defaults.grepResult = {
      ok: true,
      value: { items: [fffItem("src/a.ts", 1, "a"), fffItem("docs/b.md", 1, "b")] },
    };
    const value = (await tool.execute!({ pattern: "x", path: "src" }, execFor("/ws"))) as { matches: unknown[] };
    expect(value.matches).toEqual([{ path: "src/a.ts", lineNumber: 1, line: "a" }]);
  });

  it("applies the include glob filter after the engine", async () => {
    const tool = defineGrepTool(caps);
    defaults.grepResult = {
      ok: true,
      value: { items: [fffItem("src/a.ts", 1, "a"), fffItem("src/b.js", 1, "b")] },
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

  it("surfaces an engine failure as a thrown error (tool call becomes isError)", async () => {
    const tool = defineGrepTool(caps);
    defaults.grepResult = { ok: false, error: "boom" };
    await expect(tool.execute!({ pattern: "x" }, execFor("/ws"))).rejects.toThrow("fff grep failed: boom");
  });

  it("renders through the built-in formatter and projects the matches card meta", async () => {
    const tool = defineGrepTool(caps);
    defaults.grepResult = { ok: true, value: { items: [fffItem("src/a.ts", 3, "let v = 3")] } };
    const value = { matches: [{ path: "src/a.ts", lineNumber: 3, line: "let v = 3" }] };
    const rendered = tool.output.render({}, value as never);
    expect(rendered[0]).toMatchObject({ type: "text" });
    expect((rendered[0] as { text: string }).text).toContain("src/a.ts");
    const meta = tool.output.presentationMeta!({}, value as never) as { shape: string; total: number };
    expect(meta).toMatchObject({ shape: "matches", total: 1, truncated: false });
  });
});

describe("glob tool", () => {
  it("maps fff items onto paths with the built-in root field", async () => {
    const tool = defineGlobTool(caps);
    defaults.globResult = {
      ok: true,
      value: { items: [{ relativePath: "docs/design.md" }, { relativePath: "README.md" }] },
    };
    const value = (await tool.execute!({ pattern: "*.md" }, execFor("/ws"))) as { root: string; paths: string[] };
    expect(value).toEqual({ root: ".", paths: ["docs/design.md", "README.md"] });
    expect(instances[0]!.globCalls[0]!.pattern).toBe("*.md");
  });

  it("prefix-filters when a path argument selects a subtree", async () => {
    const tool = defineGlobTool(caps);
    defaults.globResult = {
      ok: true,
      value: { items: [{ relativePath: "docs/design.md" }, { relativePath: "README.md" }] },
    };
    const value = (await tool.execute!({ pattern: "*.md", path: "docs" }, execFor("/ws"))) as {
      root: string;
      paths: string[];
    };
    expect(value.paths).toEqual(["docs/design.md"]);
  });

  it("reuses the resident finder across calls", async () => {
    const tool = defineGlobTool(caps);
    await tool.execute!({ pattern: "*.md" }, execFor("/ws"));
    await tool.execute!({ pattern: "*.ts" }, execFor("/ws"));
    expect(instances).toHaveLength(1);
  });
});
