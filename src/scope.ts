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

/**
 * Scope basis without engine binding: where a search roots, how results are
 * displayed. Shared by the engine-backed tools (grep) and the rg-parity glob,
 * which must not create a finder just to know where to run.
 */
export interface ScopeBase {
  /** Absolute base path a search is rooted at. */
  basePath: string;
  /** Workspace-relative prefix a `path` argument selected, or `undefined` for the whole root. */
  prefix: string | undefined;
  /** Whether results must be surfaced as absolute paths (out-of-workspace scope). */
  displayAbsolute: boolean;
  /** Whether engine access goes through the ephemeral slot (out-of-workspace scope). */
  ephemeral: boolean;
  /** Convert a base-relative result path to the path the model should see. */
  toDisplay(relativePath: string): string;
}

/**
 * Bind one search call to a scope. A `path` argument inside the workspace roots
 * at the workspace with a prefix filter; a path outside it roots at itself and
 * surfaces results as absolute paths so downstream `read` calls resolve.
 */
export function resolveScopeBase(pathArg: string | undefined, workdir: string): ScopeBase {
  if (pathArg === undefined) {
    return { basePath: workdir, prefix: undefined, displayAbsolute: false, ephemeral: false, toDisplay: (p) => p };
  }
  const requested = isAbsolute(pathArg) ? resolve(pathArg) : resolve(workdir, pathArg);
  const workspaceRoot = normalize(workdir);
  const searchRoot = normalize(requested);
  if (searchRoot === workspaceRoot || isInsideRoot(workspaceRoot, searchRoot)) {
    return {
      basePath: workdir,
      prefix: prefixWithinRoot(searchRoot, workspaceRoot),
      displayAbsolute: false,
      ephemeral: false,
      toDisplay: (p) => p,
    };
  }
  return {
    basePath: searchRoot,
    prefix: undefined,
    displayAbsolute: true,
    ephemeral: true,
    toDisplay: (p) => resolve(searchRoot, p),
  };
}

export interface SearchScope extends ScopeBase {
  finder: FileFinder;
}

/**
 * Bind one search call to a finder. A `path` argument inside the workspace reuses
 * the resident workspace finder with a prefix filter; a path outside it gets the
 * ephemeral slot (at most one such finder alive at a time).
 */
export async function resolveScope(pathArg: string | undefined, workdir: string): Promise<SearchScope> {
  const base = resolveScopeBase(pathArg, workdir);
  const finder = base.ephemeral ? await getEphemeralFinder(base.basePath) : await getWorkspaceFinder(workdir);
  return { ...base, finder };
}
