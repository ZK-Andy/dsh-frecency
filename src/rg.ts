import { spawn } from "node:child_process";
import { buildGlobCommand } from "@deepseek-ai/dsh-tool-fs-search";

/**
 * The built-in glob's fixed `rg --files` argv: files mode, modification-time
 * order, hidden and ignored files included, VCS metadata pruned, plus the
 * spawn-seam's `--no-config` injection defense (a host `RIPGREP_CONFIG_PATH` or
 * an `rg.conf` next to the binary could otherwise execute a preprocessor on
 * every file). Delegating to the built-in `buildGlobCommand` keeps this
 * argument-for-argument identical to the built-in tool and avoids a drifting
 * local copy. A `path`-selected subtree rides behind `--` so a leading-dash
 * path is never parsed as a flag.
 */
export function buildGlobArgv(pattern: string, subtree?: string): string[] {
  return ["--no-config", ...buildGlobCommand({ pattern, path: subtree })];
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

/** Cap on the retained stderr diagnostic tail — the built-in seam's `stderrMaxBytes`. */
const STDERR_MAX_BYTES = 8_000;

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
 *
 * `signal` forwards caller cancellation / cooperative tool-call timeout
 * (`@deepseek-ai/dsh-tool-call-timeout-policy` through `exec.signal`) so the
 * rg process tree terminates instead of leaking as an orphan — the same
 * contract the built-in `runRipgrep` honors.
 */
export async function runRgFiles(
  argv: string[],
  cwd: string,
  budget: number,
  signal?: AbortSignal,
): Promise<RgFilesResult> {
  const bin = await resolveRgPath();
  const child = spawn(bin, argv, { cwd, stdio: ["ignore", "pipe", "pipe"], signal });
  const paths: string[] = [];
  let complete = true;
  let killedByBudget = false;
  let pending = "";
  let stderr = "";
  let stderrBytes = 0;
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
          killedByBudget = true;
          // Stop consuming the listing: killing the child breaks the data
          // flow, and the close handler resolves with whatever we collected.
          child.kill();
          return;
        }
        paths.push(line);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk.slice(0, Math.max(0, STDERR_MAX_BYTES - stderrBytes));
      stderrBytes += chunk.length;
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
      // `code === null` marks a signal-terminated child — our own budget kill
      // or an external kill (timeout/cancel). The two are distinguished by the
      // flag we set: a budget kill is an honest truncation (`complete: false`);
      // an external signal kill is NOT success-with-results — it must not
      // masquerade as a complete listing, so it rejects like the built-in tool.
      if (killedByBudget) {
        resolvePromise({ paths, complete: false });
        return;
      }
      if (code === 0 || code === 1) {
        // A natural close may hold one final unterminated entry; trim a
        // trailing blank line into nothing and keep a real last line.
        const tail = pending.trimEnd();
        if (tail.length > 0) paths.push(tail);
        resolvePromise({ paths, complete: true });
        return;
      }
      // rg exits 1 on zero results (built-in seam parity) and 2 on usage
      // errors; anything else (including a signal kill that did NOT come from
      // the budget) is a failure the caller must see.
      reject(new Error(`rg exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });
}
