/** Host logger captured at apply time; plugin execution logs land in the host log (~/.dsh/logs/host.log). */
let info: ((message: string) => void) | null = null;

export function setLogger(logger: { info?(...args: unknown[]): void } | undefined): void {
  info = logger?.info !== undefined ? (message: string) => logger.info?.(`dsh-frecency: ${message}`) : null;
}

export function pluginLog(message: string): void {
  info?.(message);
}
