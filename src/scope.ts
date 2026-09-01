import { isAbsolute, resolve } from "node:path";
import { realpathSync } from "node:fs";
import type { FileFinder } from "@ff-labs/fff-node";
import { getEphemeralFinder, getWorkspaceFinder } from "./finder.ts";
import { isInsideRoot, prefixWithinRoot } from "./mapping.ts";

/**
 * Physical position when the path exists (symlinks resolve), lexical fallback
 * otherwise — a not-yet-existing `path` argument must still be usable.
 */
function normalize(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

export interface SearchScope {
  finder: FileFinder;
  /** Absolute base path the finder indexed. */
  basePath: string;
  /** Workspace-relative prefix a `path` argument selected, or `undefined` for the whole root. */
  prefix: string | undefined;
  /** Whether engine-relative results must be surfaced as absolute paths (out-of-workspace scope). */
  displayAbsolute: boolean;
  /** Convert an engine-relative result path to the path the model should see. */
  toDisplay(relativePath: string): string;
}

/**
 * Bind one search call to a finder. A `path` argument inside the workspace reuses
 * the resident workspace finder with a prefix filter; a path outside it gets the
 * ephemeral slot (at most one such finder alive at a time), with results surfaced
 * as absolute paths so downstream `read` calls resolve.
 */
export async function resolveScope(pathArg: string | undefined, workdir: string): Promise<SearchScope> {
  if (pathArg === undefined) {
    const finder = await getWorkspaceFinder(workdir);
    return { finder, basePath: workdir, prefix: undefined, displayAbsolute: false, toDisplay: (p) => p };
  }
  const requested = isAbsolute(pathArg) ? resolve(pathArg) : resolve(workdir, pathArg);
  const workspaceRoot = normalize(workdir);
  const searchRoot = normalize(requested);
  if (searchRoot === workspaceRoot || isInsideRoot(workspaceRoot, searchRoot)) {
    const finder = await getWorkspaceFinder(workdir);
    return {
      finder,
      basePath: workdir,
      prefix: prefixWithinRoot(searchRoot, workspaceRoot),
      displayAbsolute: false,
      toDisplay: (p) => p,
    };
  }
  const finder = await getEphemeralFinder(searchRoot);
  return {
    finder,
    basePath: searchRoot,
    prefix: undefined,
    displayAbsolute: true,
    toDisplay: (p) => resolve(searchRoot, p),
  };
}
