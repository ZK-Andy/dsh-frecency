import { FileFinder, type InitOptions, type Result } from "@ff-labs/fff-node";

export class FrecencyError extends Error {}

export function unwrap<T>(result: Result<T>, what: string): T {
  if (!result.ok) throw new FrecencyError(`fff ${what} failed: ${result.error}`);
  return result.value;
}

const SCAN_TIMEOUT_MS = 30_000;

interface FinderSlot {
  basePath: string;
  finder: FileFinder;
}

/** One resident slot for the session workspace, one for an occasional out-of-workspace `path` argument. */
const slots: { workspace: FinderSlot | null; ephemeral: FinderSlot | null } = {
  workspace: null,
  ephemeral: null,
};

async function acquire(slot: FinderSlot | null, options: InitOptions): Promise<FinderSlot> {
  if (slot && slot.basePath === options.basePath && !slot.finder.isDestroyed) return slot;
  slot?.finder.destroy();
  const finder = unwrap(FileFinder.create(options), "FileFinder.create");  unwrap(await finder.waitForScan(SCAN_TIMEOUT_MS), "waitForScan");
  // The content index builds in the background; wait so an early grep does not
  // silently return zero hits. A timeout surfaces as an error, not a cold miss.
  unwrap(await finder.waitForIndexReady(SCAN_TIMEOUT_MS), "waitForIndexReady");
  return { basePath: options.basePath, finder };
}

/** Resident finder for the session workspace — created once, reused across calls. */
export async function getWorkspaceFinder(basePath: string): Promise<FileFinder> {
  slots.workspace = await acquire(slots.workspace, { basePath });
  return slots.workspace.finder;
}

/** Short-lived finder for a `path` argument outside the workspace; replaces the previous ephemeral slot. */
export async function getEphemeralFinder(basePath: string): Promise<FileFinder> {
  slots.ephemeral = await acquire(slots.ephemeral, { basePath });
  return slots.ephemeral.finder;
}

/** Destroy every resident finder (plugin disposal). Safe to call twice. */
export function releaseFinders(): void {
  for (const key of ["workspace", "ephemeral"] as const) {
    const slot = slots[key];
    if (slot && !slot.finder.isDestroyed) slot.finder.destroy();
    slots[key] = null;
  }
}
