import { defineTool, type ToolDefinition } from "@deepseek-ai/dsh-tools";
import { parseGrepArgs, presentGrepCall, presentGrepResult } from "@deepseek-ai/dsh-tool-fs-search";
import { unwrap } from "./finder.ts";
import { filterByGlob, filterByPrefix, toMatch, type GrepToolMatch } from "./mapping.ts";
import { formatRetainedGrep, grepSearchMeta, retainGrepMatches, type RetentionCaps } from "./presentation.ts";
import { resolveScope } from "./scope.ts";

/** Over-fetch headroom so `include`/`path` filtering still fills the inline cap. */
const FETCH_PAGE_SIZE = 1000;

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
  },
} as const;

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
        { type: "text", text: formatRetainedGrep(retainGrepMatches((value as { matches: GrepToolMatch[] }).matches, caps)) },
      ],
      presentationMeta: (_args, value) =>
        grepSearchMeta(retainGrepMatches((value as { matches: GrepToolMatch[] }).matches, caps), caps),
    },
    async execute(args, exec) {
      const input = parseGrepArgs(args);
      const workdir = exec.agent?.session?.header?.cwd ?? process.cwd();
      const scope = await resolveScope(input.path, workdir);
      const result = unwrap(scope.finder.grep(input.pattern, { mode: "regex", pageSize: FETCH_PAGE_SIZE }), "grep");
      let matches = result.items.map(toMatch);
      if (scope.prefix) matches = filterByPrefix(matches, scope.prefix);
      if (input.include) matches = filterByGlob(matches, input.include);
      return { matches };
    },
    presentCall: presentGrepCall,
    presentResult: presentGrepResult,
  });
}
