import { defineTool, type ToolDefinition } from "@deepseek-ai/dsh-tools";
import { parseGlobArgs, presentGlobCall, presentGlobResult, toWorkdirRelative } from "@deepseek-ai/dsh-tool-fs-search";
import { getEphemeralFinder, getWorkspaceFinder, unwrap } from "./finder.ts";
import type { FileFinder } from "@ff-labs/fff-node";
import { pluginLog } from "./log.ts";
import { filterByPrefix } from "./mapping.ts";
import { buildGlobArgv, runRgFiles } from "./rg.ts";
import { formatGlobPage, globPage, globSearchMeta, type RetentionCaps } from "./presentation.ts";
import { resolveScopeBase, type ScopeBase } from "./scope.ts";

/** Pages are fetched to exhaustion (bounded): see grep.ts for the truncation-honesty rationale. */
const FETCH_PAGE_SIZE = 500;
const MAX_PAGES = 4;
/** Same fetch budget the engine loop used: entries collected before honest truncation. */
const GLOB_FETCH_BUDGET = MAX_PAGES * FETCH_PAGE_SIZE;

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
      `Find files whose paths match a glob pattern. Returns matching file paths — ` +
      `never directories — including hidden and ignored files (VCS metadata directories are excluded). ` +
      `Up to ${caps.globMaxResults} paths come back in modification-time order; a capped result says so — ` +
      `narrow pattern or path to see more. ` +
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
      const base = resolveScopeBase(input.path, workdir);
      // Semantic parity with the built-in glob: its contract includes hidden
      // and ignored files (VCS metadata excluded), which the resident index
      // does not hold and GlobOptions cannot request. Serve through the same
      // fixed `rg --files` invocation the built-in tool runs, rooted at the
      // scope base; a `path`-selected subtree narrows the traversal.
      let relativePaths: string[];
      let exhausted: boolean;
      try {
        const rgResult = await runRgFiles(buildGlobArgv(input.pattern, base.prefix), base.basePath, GLOB_FETCH_BUDGET);
        relativePaths = rgResult.paths;
        exhausted = rgResult.complete;
        pluginLog(`glob "${input.pattern}" served by rg parity — ${relativePaths.length} paths (workdir ${workdir})`);
      } catch (error) {
        // rg unavailable or failed: degrade to the resident index (which
        // misses gitignored files) rather than failing the call — the
        // call-time face of the same step-aside philosophy as apply().
        const detail = error instanceof Error ? error.message : String(error);
        pluginLog(`glob "${input.pattern}" rg unavailable (${detail}); serving from the resident index`);
        const finder = base.ephemeral ? await getEphemeralFinder(base.basePath) : await getWorkspaceFinder(workdir);
        const served = await serveFromIndex(finder, input.pattern);
        relativePaths = served.relativePaths;
        exhausted = served.exhausted;
        pluginLog(
          `glob "${input.pattern}" served by the resident index — ${relativePaths.length} paths (workdir ${workdir})`,
        );
      }
      let paths = relativePaths.map((p) => base.toDisplay(p));
      if (base.prefix) paths = filterByPrefix(paths.map((path) => ({ path })), base.prefix).map((e) => e.path);
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

/** Pages are fetched to exhaustion (bounded): see grep.ts for the truncation-honesty rationale. */
async function serveFromIndex(
  finder: FileFinder,
  pattern: string,
): Promise<{ relativePaths: string[]; exhausted: boolean }> {
  const relativePaths: string[] = [];
  let exhausted = false;
  for (let pageIndex = 0; pageIndex < MAX_PAGES && !exhausted; pageIndex += 1) {
    const result = unwrap(finder.glob(pattern, { pageSize: FETCH_PAGE_SIZE, pageIndex }), "glob");
    relativePaths.push(...result.items.map((item) => item.relativePath));
    exhausted = result.totalMatched <= relativePaths.length;
  }
  return { relativePaths, exhausted };
}

/** The card/text page: cap logic on the full path list; engine-side incompleteness OR-ed in. */
function globPageFor(value: unknown, caps: RetentionCaps) {
  const { root, paths, truncated } = value as GlobValue;
  const page = globPage(paths, caps, root);
  return truncated === true ? { ...page, truncated: true } : page;
}
