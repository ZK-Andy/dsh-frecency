import { describe, expect, it } from "vitest";
import {
  formatGlobPage,
  formatRetainedGrep,
  globPage,
  globSearchMeta,
  grepSearchMeta,
  retainGrepMatches,
  type RetentionCaps,
} from "../src/presentation.ts";
import type { GrepToolMatch } from "../src/mapping.ts";

const caps: RetentionCaps = {
  grepMaxMatches: 3,
  grepMaxLineBytes: 20,
  globMaxResults: 3,
  sampleOverCapGlobResults: false,
  searchMetaMaxBytes: 10_000,
};

function match(i: number): GrepToolMatch {
  return { path: `src/file${Math.floor(i / 2)}.ts`, lineNumber: i + 1, line: `const x${i} = ${i};` };
}

describe("retainGrepMatches", () => {
  it("keeps the head, reports the truncation, and counts everything seen", () => {
    const retained = retainGrepMatches([0, 1, 2, 3, 4].map(match), caps);
    expect(retained.items).toHaveLength(3);
    expect(retained.seen).toBe(5);
    expect(retained.truncated).toBe(true);
  });

  it("previews lines over the byte cap", () => {
    const long = { path: "a.ts", lineNumber: 1, line: "x".repeat(100) };
    const retained = retainGrepMatches([long], caps);
    expect(retained.items[0]!.line.length).toBeLessThan(100);
  });

  it("is not truncated under the cap", () => {
    const retained = retainGrepMatches([match(0)], caps);
    expect(retained.truncated).toBe(false);
    expect(retained.seen).toBe(1);
  });
});

describe("grepSearchMeta", () => {
  it("groups matches by file with the built-in card shape", () => {
    const meta = grepSearchMeta(retainGrepMatches([0, 1, 2].map(match), caps), caps) as {
      shape: string;
      files: { path: string; matches: unknown[] }[];
      truncated: boolean;
      total: number;
    };
    expect(meta.shape).toBe("matches");
    expect(meta.files).toHaveLength(2);
    expect(meta.total).toBe(3);
    expect(meta.truncated).toBe(false);
  });

  it("drops tail file groups and flags truncation when the byte budget is exceeded", () => {
    const tight: RetentionCaps = { ...caps, searchMetaMaxBytes: 200 };
    const meta = grepSearchMeta(retainGrepMatches([0, 1, 2, 3, 4].map(match), tight), tight) as {
      files: unknown[];
      truncated: boolean;
    };
    expect(meta.files.length).toBeLessThan(3);
    expect(meta.truncated).toBe(true);
  });

  it("byte-caps the paths shape too (glob cards)", () => {
    const tight: RetentionCaps = { ...caps, searchMetaMaxBytes: 60 };
    const page = globPage(["very/long/path/one.ts", "very/long/path/two.ts", "very/long/path/three.ts"], caps, ".");
    const meta = globSearchMeta(page, tight) as { paths: unknown[]; truncated: boolean };
    expect(meta.paths.length).toBeLessThan(3);
    expect(meta.truncated).toBe(true);
  });
});

describe("formatRetainedGrep", () => {
  it("uses the built-in no-match wording", () => {
    expect(formatRetainedGrep(retainGrepMatches([], caps))).toBe("No matches found");
  });

  it("formats retained matches through the built-in formatter", () => {
    const text = formatRetainedGrep(retainGrepMatches([0, 1].map(match), caps));
    expect(text).toContain("src/file0.ts");
    expect(text).toContain("const x0 = 0;");
  });
});

describe("globPage + formatGlobPage", () => {
  const paths = ["a/1.ts", "a/2.ts", "b/3.ts", "c/4.ts", "d/5.ts"];

  it("returns everything under the cap", () => {
    const page = globPage(paths.slice(0, 2), caps, ".");
    expect(page).toEqual({ items: paths.slice(0, 2), truncated: false, seen: 2 });
    expect(formatGlobPage(page)).toBe(paths.slice(0, 2).join("\n"));
  });

  it("keeps the head and reports the cap without sampling", () => {
    const page = globPage(paths, caps, ".");
    expect(page.items).toHaveLength(3);
    expect(page.truncated).toBe(true);
    expect(formatGlobPage(page)).toContain("Showing 3 of 5 paths");
  });

  it("samples across top-level entries when enabled", () => {
    const sampling: RetentionCaps = { ...caps, sampleOverCapGlobResults: true };
    const page = globPage(paths, sampling, ".");
    expect(page.items).toHaveLength(3);
    const tops = new Set(page.items.map((p) => p.split("/")[0]));
    expect(tops.size).toBe(3);
  });

  it("uses the built-in no-match wording", () => {
    expect(formatGlobPage(globPage([], caps, "."))).toBe("No files found");
  });
});

describe("globSearchMeta", () => {
  it("carries the paths card shape", () => {
    const meta = globSearchMeta(globPage(["a.ts"], caps, "."), caps) as {
      shape: string;
      paths: string[];
      truncated: boolean;
      total: number;
    };
    expect(meta).toEqual({ shape: "paths", paths: ["a.ts"], truncated: false, total: 1 });
  });
});
