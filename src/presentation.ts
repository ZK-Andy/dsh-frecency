import { ItemRetainer, type RetainedItems } from "@deepseek-ai/dsh-output-retention";
import type { JsonValue } from "@deepseek-ai/dsh-util-values";
import {
  formatGlobOutput,
  formatGrepMatches,
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

/**
 * Bound serialized meta by dropping whole tail groups — matches the built-in
 * `capMetaBytes` for both shapes (`files` and `paths`): a meta that had to drop
 * groups reports `truncated: true`, never a cropped "complete" impression.
 */
function capMetaBytes(meta: JsonValue, maxBytes: number): JsonValue {
  const obj = meta as Record<string, unknown>;
  const groups = obj["files"] ?? obj["paths"];
  if (!Array.isArray(groups)) return meta;
  let dropped = false;
  while (groups.length > 0 && Buffer.byteLength(JSON.stringify(obj), "utf8") > maxBytes) {
    groups.pop();
    dropped = true;
  }
  if (dropped) obj["truncated"] = true;
  return meta;
}

/**
 * Built-in `formatRetainedGrep` shape with an honest footer: dsh-frecency does
 * not spill, so the cap note never claims a saved complete result.
 */
export function formatRetainedGrep(retained: RetainedItems<GrepToolMatch>): string {
  if (retained.seen === 0) return "No matches found";
  const noun = retained.seen === 1 ? "match" : "matches";
  const header = retained.truncated ? `Found ${retained.kept} of ${retained.seen} matches` : `Found ${retained.seen} ${noun}`;
  const body = formatGrepMatches(retained.items);
  if (!retained.truncated) return `${header}\n\n${body}`;
  return (
    `${header}\n\n${body}\n\n` +
    `(Showing ${retained.kept} of ${retained.seen} matches. The complete result was capped by the inline limit; ` +
    "narrow pattern, path, or include to see more.)"
  );
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
