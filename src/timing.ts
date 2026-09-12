import { performance } from "node:perf_hooks";

/**
 * Latency marks for the index-ready and serve log lines. The clock lives in
 * its own module so the log channel stays a channel, and the mark is returned
 * as a closure so a timestamp can never be passed where a duration is expected.
 */
export function startTimer(): () => number {
  const startedAt = performance.now();
  return () => Math.round(performance.now() - startedAt);
}
