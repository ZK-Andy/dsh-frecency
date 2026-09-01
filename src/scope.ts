import { isAbsolute, resolve } from "node:path";
import type { FileFinder } from "@ff-labs/fff-node";
import { getEphemeralFinder, getWorkspaceFinder } from "./finder.ts";
import { isInsideRoot, prefixWithinRoot } from "./mapping.ts";

export interface SearchScope {
  finder: FileFinder;
  /** Absolute base path the finder indexed. */
  basePath: string;
  /** Workspace-relative prefix a `path` argument selected, or `undefined` for the whole root. */
  prefix: string | undefined;
}

/**
 * Bind one search call to a finder. A `path` argument inside the workspace reuses
 * the resident workspace finder with a prefix filter; a path outside it gets the
 * ephemeral slot (at most one such finder alive at a time).
 */
export async function resolveScope(pathArg: string | undefined, workdir: string): Promise<SearchScope> {
  if (pathArg === undefined) {
    return { finder: await getWorkspaceFinder(workdir), basePath: workdir, prefix: undefined };
  }
  const requested = isAbsolute(pathArg) ? resolve(pathArg) : resolve(workdir, pathArg);
  if (requested === resolve(workdir) || isInsideRoot(workdir, requested)) {
    return { finder: await getWorkspaceFinder(workdir), basePath: workdir, prefix: prefixWithinRoot(requested, workdir) };
  }
  return { finder: await getEphemeralFinder(requested), basePath: requested, prefix: undefined };
}
