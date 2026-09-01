import { isAbsolute, relative, resolve, sep } from "node:path";
import picomatch from "picomatch";
import type { GrepMatch } from "@ff-labs/fff-node";

export interface GrepToolMatch {
  path: string;
  lineNumber: number;
  line: string;
  /** Whether this line is a code definition (engine-classified; present only on definition lines). */
  isDefinition?: boolean;
  /** The file's git working-tree status ("clean", "modified", …); the engine always reports it. */
  gitStatus: string;
}

export function toMatch(item: GrepMatch): GrepToolMatch {
  return {
    path: item.relativePath,
    lineNumber: item.lineNumber,
    line: item.lineContent,
    // The engine emits `isDefinition` only on definition lines; gated on === true
    // so an explicit `false` on a non-definition line is dropped (not surfaced as a
    // false-y field the ADR promises is omitted).
    ...(item.isDefinition === true ? { isDefinition: true } : {}),
    gitStatus: item.gitStatus,
  };
}

/**
 * The relative prefix a `path` argument selects inside the search root, or
 * `undefined` when the argument is absent (whole root). An exact file path
 * falls out naturally: only the identity match survives the prefix test.
 */
export function prefixWithinRoot(searchRoot: string, workspaceRoot: string): string | undefined {
  if (resolve(searchRoot) === resolve(workspaceRoot)) return undefined;
  const rel = relative(resolve(workspaceRoot), resolve(searchRoot)).split(/[/\\]/).join(sep);
  return rel.length > 0 ? rel : undefined;
}

export function filterByPrefix<T extends { path: string }>(items: T[], prefix: string): T[] {
  const bounded = prefix.endsWith(sep) ? prefix.slice(0, -sep.length) : prefix;
  return items.filter((item) => item.path === bounded || item.path.startsWith(`${bounded}${sep}`));
}

/** ripgrep `--glob` semantics: the pattern matches against the path or its basename, hidden names included. */
export function filterByGlob<T extends { path: string }>(items: T[], include: string): T[] {
  const byPath = picomatch(include, { dot: true });
  const byBasename = picomatch(include, { dot: true, basename: true });
  return items.filter((item) => byPath(item.path) || byBasename(item.path));
}

/** Whether `candidate` is a strict descendant of `root` (either may be relative; both resolve against cwd). */
export function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}
