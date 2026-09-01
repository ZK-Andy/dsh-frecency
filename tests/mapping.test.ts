import { describe, expect, it } from "vitest";
import { filterByGlob, filterByPrefix, isInsideRoot, prefixWithinRoot, toMatch } from "../src/mapping.ts";

describe("toMatch", () => {
  it("maps fff fields onto the built-in match shape, gitStatus always carried", () => {
    expect(
      toMatch({
        relativePath: "docs/design.md",
        fileName: "design.md",
        gitStatus: "clean",
        lineContent: "hello",
        lineNumber: 7,
        col: 1,
        byteOffset: 0,
        matchRanges: [[0, 5]],
        isBinary: false,
        size: 10,
        modified: 0,
        totalFrecencyScore: 0,
        accessFrecencyScore: 0,
        modificationFrecencyScore: 0,
      }),
    ).toEqual({ path: "docs/design.md", lineNumber: 7, line: "hello", gitStatus: "clean" });
  });

  it("carries gitStatus through with its engine value", () => {
    expect(
      toMatch({
        relativePath: "src/a.ts",
        fileName: "a.ts",
        gitStatus: "modified",
        lineContent: "x",
        lineNumber: 1,
        col: 0,
        byteOffset: 0,
        matchRanges: [[0, 1]],
        isBinary: false,
        size: 2,
        modified: 0,
        totalFrecencyScore: 0,
        accessFrecencyScore: 0,
        modificationFrecencyScore: 0,
      }),
    ).toEqual({ path: "src/a.ts", lineNumber: 1, line: "x", gitStatus: "modified" });
  });

  it("carries isDefinition on a definition line and omits it otherwise", () => {
    const base = {
      fileName: "a.ts",
      relativePath: "src/a.ts",
      gitStatus: "clean",
      lineContent: "fn",
      lineNumber: 1,
      col: 0,
      byteOffset: 0,
      matchRanges: [[0, 2]],
      isBinary: false,
      size: 2,
      modified: 0,
      totalFrecencyScore: 0,
      accessFrecencyScore: 0,
      modificationFrecencyScore: 0,
    };
    expect(toMatch({ ...base, isDefinition: true })).toMatchObject({ isDefinition: true });
    expect(toMatch({ ...base, isDefinition: false })).not.toHaveProperty("isDefinition");
    expect(toMatch({ ...base })).not.toHaveProperty("isDefinition");
  });
});

describe("prefixWithinRoot", () => {
  const workspace = "/ws";

  it("is undefined for the workspace root itself", () => {
    expect(prefixWithinRoot("/ws", "/ws")).toBeUndefined();
  });

  it("gives the workspace-relative prefix for a subdirectory", () => {
    expect(prefixWithinRoot("/ws/src/lib", "/ws")).toBe("src/lib");
  });

  it("normalizes separators", () => {
    expect(prefixWithinRoot("/ws/src", "/ws")).toBe("src");
  });
});

describe("filterByPrefix", () => {
  const items = [
    { path: "src/a.ts" },
    { path: "src/deep/b.ts" },
    { path: "srcx/c.ts" },
    { path: "other/d.ts" },
  ];

  it("keeps the subtree and rejects prefix look-alikes", () => {
    expect(filterByPrefix(items, "src").map((i) => i.path)).toEqual(["src/a.ts", "src/deep/b.ts"]);
  });

  it("keeps an exact file match", () => {
    expect(filterByPrefix(items, "src/a.ts").map((i) => i.path)).toEqual(["src/a.ts"]);
  });
});

describe("filterByGlob", () => {
  const items = [{ path: "src/a.ts" }, { path: "src/b.js" }, { path: "src/c.jsx" }, { path: "src/d.tsx" }, { path: "top.ts" }];

  it("matches by basename anywhere in the tree (rg --glob semantics)", () => {
    expect(filterByGlob(items, "*.ts").map((i) => i.path)).toEqual(["src/a.ts", "top.ts"]);
  });

  it("expands brace alternation", () => {
    expect(filterByGlob(items, "*.{js,jsx}").map((i) => i.path)).toEqual(["src/b.js", "src/c.jsx"]);
  });

  it("anchors depth when the pattern has a separator", () => {
    expect(filterByGlob(items, "src/*.ts").map((i) => i.path)).toEqual(["src/a.ts"]);
  });
});

describe("isInsideRoot", () => {
  it("accepts strict descendants only", () => {
    expect(isInsideRoot("/ws", "/ws/src")).toBe(true);
    expect(isInsideRoot("/ws", "/ws")).toBe(false);
    expect(isInsideRoot("/ws", "/ws-other/x")).toBe(false);
    expect(isInsideRoot("/ws", "/etc")).toBe(false);
  });
});
