import { spawn } from "node:child_process";

/**
 * Directory names that must never appear in a discovery listing: VCS metadata
 * stores. Mirrors the built-in `GLOB_VCS_EXCLUDES` — each name is excluded with
 * TWO negated globs: an any-depth directory glob that matches — and prunes —
 * the directory during traversal, and a contents glob that still excludes the
 * internals when the search root itself is at or inside the directory.
 */
export const GLOB_VCS_EXCLUDES = [".git", ".svn", ".hg", ".bzr", ".jj", ".sl"];

/**
 * The built-in glob's fixed `rg --files` argv (`buildGlobCommand` plus the
 * spawn-seam's `--no-config`, minus the trailing `-- path`): files mode,
 * modification-time order, hidden and ignored files included, VCS metadata
 * pruned. Serving glob through this same argv is what makes the shadow
 * semantically indistinguishable from the built-in tool. `--no-config` is the
 * built-in spawn seam's injection defense: a host `RIPGREP_CONFIG_PATH` (or an
 * `rg.conf` next to the binary) could otherwise execute a preprocessor on
 * every file.
 */
export function buildGlobArgv(pattern: string, subtree?: string): string[] {
  return [
    "--no-config",
    "--files",
    `--glob=${pattern}`,
    "--sort=modified",
    "--no-ignore",
    "--hidden",
    ...GLOB_VCS_EXCLUDES.flatMap((name) => [`--glob=!**/${name}`, `--glob=!**/${name}/**`]),
    ...(subtree === undefined ? [] : ["--", subtree]),
  ];
}

let rgPathPromise: Promise<string> | null = null;

/**
 * The ripgrep binary the built-in tools run, resolved by the built-in package
 * itself (`resolveRgPath` is a public export: pkg sidecar aware, packaged
 * `@vscode/ripgrep` binary). PATH `rg` is the fallback for deployments where
 * the optional peer is missing. Memoized; a failed resolution falls through to
 * the engine glob at call time, never breaks boot.
 */
export function resolveRgPath(): Promise<string> {
  rgPathPromise ??= import("@deepseek-ai/dsh-tool-fs-search")
    .then((m) => m.resolveRgPath())
    .catch(() => "rg");
  return rgPathPromise;
}

export interface RgFilesResult {
  /** Paths relative to `cwd`, in rg output order (modification time). */
  paths: string[];
  /** False when the fetch budget cut the listing short. */
  complete: boolean;
}

/**
 * Stream `rg --files ...` rooted at `cwd`, collecting at most `budget`
 * entries. Streaming (not execFile) bounds memory: a huge tree is killed at
 * the budget instead of buffering the full listing. rg emits NUL-free
 * newline-separated relative paths in `--files` mode; blank lines are skipped.
 */
export async function runRgFiles(argv: string[], cwd: string, budget: number): Promise<RgFilesResult> {
  const bin = await resolveRgPath();
  const child = spawn(bin, argv, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  const paths: string[] = [];
  let complete = true;
  let pending = "";
  let stderr = "";
  let settled = false;
  return await new Promise<RgFilesResult>((resolvePromise, reject) => {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      let index: number;
      while ((index = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        if (line.length === 0) continue;
        if (paths.length === budget) {
          complete = false;
          child.kill();
          return;
        }
        paths.push(line);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      // `code === null` is our own budget kill; rg exits 1 on zero results
      // (built-in seam parity) and 2 on usage errors.
      if (code === 0 || code === 1 || code === null) {
        // A budget kill leaves `pending` holding a truncated partial line —
        // drop it; a natural close may hold one final unterminated entry.
        if (complete) {
          const tail = pending.trimEnd();
          if (tail.length > 0) paths.push(tail);
        }
        resolvePromise({ paths, complete });
      } else {
        reject(new Error(`rg exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
      }
    });
  });
}
