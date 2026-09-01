import { defineTool, type ToolDefinition } from "@deepseek-ai/dsh-tools";
import { parseGlobArgs, presentGlobCall, presentGlobResult, toWorkdirRelative } from "@deepseek-ai/dsh-tool-fs-search";
import { unwrap } from "./finder.ts";
import { filterByPrefix } from "./mapping.ts";
import { formatGlobPage, globPage, globSearchMeta, type RetentionCaps } from "./presentation.ts";
import { resolveScope } from "./scope.ts";

const FETCH_PAGE_SIZE = 1000;

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
  },
} as const;

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
      const result = unwrap(scope.finder.glob(input.pattern, { pageSize: FETCH_PAGE_SIZE }), "glob");
      let paths = result.items.map((item) => item.relativePath);
      if (scope.prefix) {
        paths = filterByPrefix(paths.map((path) => ({ path })), scope.prefix).map((entry) => entry.path);
      }
      return { root: input.path === undefined ? "." : toWorkdirRelative(input.path, workdir), paths };
    },
    presentCall: presentGlobCall,
    presentResult: presentGlobResult,
  });
}

function globPageFor(value: unknown, caps: RetentionCaps) {
  const { root, paths } = value as { root: string; paths: string[] };
  return globPage(paths, caps, root);
}
