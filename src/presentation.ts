import { ItemRetainer, type RetainedItems } from "@deepseek-ai/dsh-output-retention";
import type { JsonValue } from "@deepseek-ai/dsh-util-values";
import {
  formatGlobOutput,
  formatGrepOutput,
  previewLine,
  sampleAcrossTopLevel,
} from "@deepseek-ai/dsh-tool-fs-search";
import type { GrepToolMatch } from "./mapping.ts";

export interface RetentionCaps {
  grepMaxMatches: number;
  grepMaxLineBytes: number;
  globMaxResults: number;
  sampleOverCapGlobResults: boolean;
  searchMetaMaxBytes: number;
}

export interface Retained<T> {
  items: T[];
  truncated: boolean;
  seen: number;
}

function retainHead<T>(items: T[], maxItems: number, prepare: (item: T) => T): RetainedItems<T> {
  const retainer = new ItemRetainer<T>({ kind: "head", maxItems });
  for (const item of items) retainer.push(prepare(item));
  return retainer.finish();
}

/** Mirror of the built-in grep retention: inline head cap plus per-line byte preview. */
export function retainGrepMatches(matches: GrepToolMatch[], caps: RetentionCaps): RetainedItems<GrepToolMatch> {
  return retainHead(matches, caps.grepMaxMatches, (match) => ({
    ...match,
    line: previewLine(match.line, caps.grepMaxLineBytes),
  }));
}

/** Mirror of the built-in `grepSearchMeta`: the search card projects from this shape. */
export function grepSearchMeta(retained: RetainedItems<GrepToolMatch>, caps: RetentionCaps): JsonValue {
  const files = new Map<string, { path: string; matches: { lineNumber: number; line: string }[] }>();
  for (const match of retained.items) {
    let file = files.get(match.path);
    if (!file) {
      file = { path: match.path, matches: [] };
      files.set(match.path, file);
    }
    file.matches.push({ lineNumber: match.lineNumber, line: match.line });
  }
  return capMetaBytes(
    {
      shape: "matches",
      files: [...files.values()],
      truncated: retained.truncated,
      total: retained.seen,
    },
    caps.searchMetaMaxBytes,
  ) as unknown as JsonValue;
}

/** Mirror of the built-in `globSearchMeta`. */
export function globSearchMeta(page: Retained<string>, caps: RetentionCaps): JsonValue {
  return capMetaBytes(
    { shape: "paths", paths: page.items, truncated: page.truncated, total: page.seen },
    caps.searchMetaMaxBytes,
  ) as unknown as JsonValue;
}

/** Bound serialized meta by dropping whole tail file groups (never the truncation flags). */
function capMetaBytes(meta: JsonValue, maxBytes: number): JsonValue {
  const obj = meta as Record<string, unknown>;
  const files = obj["files"];
  if (!Array.isArray(files)) return meta;
  while (files.length > 1 && Buffer.byteLength(JSON.stringify(obj), "utf8") > maxBytes) {
    files.pop();
  }
  return meta;
}

/** Mirror of the built-in `formatRetainedGrep` (no spill reference: dsh-frecency does not spill). */
export function formatRetainedGrep(retained: RetainedItems<GrepToolMatch>): string {
  if (retained.seen === 0) return "No matches found";
  return formatGrepOutput(retained, undefined);
}

/**
 * Mirror of the built-in `globCardPage`: one computation feeds both the
 * model-facing text and the card meta so they agree on which paths survived
 * the cap. An over-cap result either keeps the head or samples across
 * top-level entries, matching `sampleOverCapGlobResults`.
 */
export function globPage(
  paths: string[],
  caps: RetentionCaps,
  root: string,
): Retained<string> & { sample?: { items: string[]; shown: number; total: number } } {
  if (paths.length <= caps.globMaxResults) return { items: paths, truncated: false, seen: paths.length };
  if (!caps.sampleOverCapGlobResults) {
    return { items: paths.slice(0, caps.globMaxResults), truncated: true, seen: paths.length };
  }
  const sample = sampleAcrossTopLevel(paths, caps.globMaxResults, root);
  return { items: sample.items, truncated: true, seen: paths.length, sample };
}

/** Mirror of the built-in `formatGlobPage`/`formatGlobOutput` pair over one computed page. */
export function formatGlobPage(page: ReturnType<typeof globPage>): string {
  if (page.seen === 0) return "No files found";
  if (!page.truncated) return page.items.join("\n");
  if (page.sample) return formatGlobOutput(page.sample, page.seen, undefined);
  const basis =
    `Showing ${page.items.length} of ${page.seen} paths. ` +
    "The complete result was capped by the inline limit; narrow pattern or path to see more.";
  return `${page.items.join("\n")}\n\n(${basis})`;
}
