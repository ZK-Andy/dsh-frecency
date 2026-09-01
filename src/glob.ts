import { defineTool, type ToolDefinition } from "@deepseek-ai/dsh-tools";
import { parseGlobArgs, presentGlobCall, presentGlobResult, toWorkdirRelative } from "@deepseek-ai/dsh-tool-fs-search";
import { unwrap } from "./finder.ts";
import { pluginLog } from "./log.ts";
import { filterByPrefix } from "./mapping.ts";
import { formatGlobPage, globPage, globSearchMeta, type RetentionCaps } from "./presentation.ts";
import { resolveScope } from "./scope.ts";

/** Pages are fetched to exhaustion (bounded): see grep.ts for the truncation-honesty rationale. */
const FETCH_PAGE_SIZE = 500;
const MAX_PAGES = 4;

const PARAMETERS = {
  pattern: {
    type: "string",
    required: true,
    description:
      'Glob pattern to match file paths against (e.g. "**/*.ts", "src/**/*.test.js"). A pattern with no "/" matches the basename at any depth, so "*" and "*.ts" both search the whole tree; include a separator to anchor the depth.',
  },
  path: {
    type: "string",
    description: "Directory to search in. Defaults to the session workspace; a relative path resolves against it.",
  },
} as const;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    root: { type: "string", required: true },
    paths: { type: "array", required: true, items: { type: "string" } },
    truncated: { type: "boolean" },
  },
} as const;

interface GlobValue {
  root: string;
  paths: string[];
  truncated?: boolean;
}

export function defineGlobTool(caps: RetentionCaps & { timeoutMs: number }): ToolDefinition {
  return defineTool({
    name: "glob",
    description:
      `Find files whose paths match a glob pattern over a resident workspace index. Returns matching file paths — ` +
      `never directories — ordered by file frecency (recently accessed and modified files first). ` +
      `Up to ${caps.globMaxResults} paths come back inline; a capped result says so — narrow pattern or path to see more. ` +
      `This tool does not enumerate directory entries.`,
    parameters: PARAMETERS,
    timeoutMs: caps.timeoutMs,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: "text", text: formatGlobPage(globPageFor(value, caps)) }],
      presentationMeta: (_args, value) => globSearchMeta(globPageFor(value, caps), caps),
    },
    async execute(args, exec) {
      const input = parseGlobArgs(args);
      const workdir = exec.agent?.session?.header?.cwd ?? process.cwd();
      const scope = await resolveScope(input.path, workdir);
      const relativePaths: string[] = [];
      let exhausted = false;
      for (let pageIndex = 0; pageIndex < MAX_PAGES && !exhausted; pageIndex += 1) {
        const result = unwrap(scope.finder.glob(input.pattern, { pageSize: FETCH_PAGE_SIZE, pageIndex }), "glob");
        relativePaths.push(...result.items.map((item) => item.relativePath));
        exhausted = result.totalMatched <= relativePaths.length;
      }
      let paths = relativePaths.map((p) => scope.toDisplay(p));
      if (scope.prefix) paths = filterByPrefix(paths.map((path) => ({ path })), scope.prefix).map((e) => e.path);
      pluginLog(`glob "${input.pattern}" served by the resident index — ${paths.length} paths (workdir ${workdir})`);
      return {
        root: input.path === undefined ? "." : toWorkdirRelative(input.path, workdir),
        paths,
        truncated: !exhausted,
      };
    },
    presentCall: presentGlobCall,
    presentResult: presentGlobResult,
  });
}

/** The card/text page: cap logic on the full path list; engine-side incompleteness OR-ed in. */
function globPageFor(value: unknown, caps: RetentionCaps) {
  const { root, paths, truncated } = value as GlobValue;
  const page = globPage(paths, caps, root);
  return truncated === true ? { ...page, truncated: true } : page;
}
