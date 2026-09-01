import { defineTool, type ToolDefinition } from "@deepseek-ai/dsh-tools";
import { parseGrepArgs, presentGrepCall, presentGrepResult } from "@deepseek-ai/dsh-tool-fs-search";
import type { GrepCursor, GrepMatch, GrepOptions, GrepResult } from "@ff-labs/fff-node";
import { FrecencyError, unwrap } from "./finder.ts";
import { filterByGlob, filterByPrefix, toMatch, type GrepToolMatch } from "./mapping.ts";
import { formatRetainedGrep, grepSearchMeta, retainGrepMatches, type RetentionCaps } from "./presentation.ts";
import { resolveScope } from "./scope.ts";

/**
 * Engine pages are fetched to exhaustion (bounded): a single page would leave
 * `nextCursor` unfetched and force a lying `truncated: false` after filters.
 */
const FETCH_PAGE_SIZE = 500;
const MAX_PAGES = 4;

const PARAMETERS = {
  pattern: {
    type: "string",
    required: true,
    description: "Regular expression to search for (ripgrep syntax).",
  },
  path: {
    type: "string",
    description: "File or directory to search. Defaults to the session workspace; a relative path resolves against it.",
  },
  include: {
    type: "string",
    description: 'One glob filter for which files to search (e.g. "*.ts", "*.{js,jsx}"). Not a list; negation is not supported.',
  },
} as const;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    matches: {
      type: "array",
      required: true,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", required: true },
          lineNumber: { type: "integer", required: true },
          line: { type: "string", required: true },
        },
      },
    },
    truncated: { type: "boolean" },
  },
} as const;

interface GrepValue {
  matches: GrepToolMatch[];
  truncated?: boolean;
}

export function defineGrepTool(caps: RetentionCaps & { timeoutMs: number }): ToolDefinition {
  return defineTool({
    name: "grep",
    description:
      `Search file contents with a ripgrep regular expression over a resident workspace index. ` +
      `Returns matching lines with line numbers, grouped by file, ordered by file frecency ` +
      `(recently accessed and modified files first). Returns the first ${caps.grepMaxMatches} matches inline; ` +
      `a capped result says so — narrow pattern or path to see more. Use read on a matched file for surrounding context.`,
    parameters: PARAMETERS,
    timeoutMs: caps.timeoutMs,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [
        { type: "text", text: formatRetainedGrep(combinedRetention(value, caps)) },
      ],
      presentationMeta: (_args, value) => grepSearchMeta(combinedRetention(value, caps), caps),
    },
    async execute(args, exec) {
      const input = parseGrepArgs(args);
      const workdir = exec.agent?.session?.header?.cwd ?? process.cwd();
      const scope = await resolveScope(input.path, workdir);
      const items: GrepMatch[] = [];
      let cursor: GrepCursor | null = null;
      let exhausted = false;
      for (let page = 0; page < MAX_PAGES && !exhausted; page += 1) {
        const options: GrepOptions = { mode: "regex", smartCase: false, pageSize: FETCH_PAGE_SIZE, cursor };
        const result = unwrap<GrepResult>(scope.finder.grep(input.pattern, options), "grep");
        // The engine silently falls back to literal matching on a bad regex;
        // surface it instead, like the built-in tool's SEARCH_FAILED.
        if (result.regexFallbackError !== undefined) {
          throw new FrecencyError(`grep pattern is not a valid regular expression: ${result.regexFallbackError}`);
        }
        items.push(...result.items);
        cursor = result.nextCursor;
        exhausted = cursor === null;
      }
      let matches = items.map((item) => ({ ...toMatch(item), path: scope.toDisplay(item.relativePath) }));
      if (scope.prefix) matches = filterByPrefix(matches, scope.prefix);
      if (input.include) matches = filterByGlob(matches, input.include);
      return { matches, truncated: !exhausted };
    },
    presentCall: presentGrepCall,
    presentResult: presentGrepResult,
  });
}

/** Retention with engine-side incompleteness OR-ed into the truncation flag. */
function combinedRetention(value: unknown, caps: RetentionCaps & { timeoutMs: number }) {
  const { matches, truncated } = value as GrepValue;
  const retained = retainGrepMatches(matches, caps);
  return truncated === true ? { ...retained, truncated: true } : retained;
}
