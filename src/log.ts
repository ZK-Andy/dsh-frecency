import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Plugin evidence log. The desktop host.log only carries the Electron shell's
 * own channels — plugin-level logger.info is level-gated away — so serves are
 * proven by appending to a dedicated file next to it.
 */
const LOG_FILE = join(homedir(), ".dsh", "logs", "dsh-frecency.log");

let host: { info?(...args: unknown[]): void } | null = null;

export function setLogger(logger: { info?(...args: unknown[]): void } | undefined): void {
  host = logger ?? null;
}

export function pluginLog(message: string): void {
  host?.info?.(`dsh-frecency: ${message}`);
  // The vitest guard keeps unit runs from touching the user's real dsh home.
  if (process.env.VITEST === undefined) {
    try {
      appendFileSync(LOG_FILE, `[${new Date().toISOString()}] dsh-frecency: ${message}\n`);
    } catch {
      // No writable dsh home (e.g. CI); the in-process log line still stands.
    }
  }
}
