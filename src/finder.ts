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

interface SlotState {
  slot: FinderSlot | null;
  inflight: Promise<FileFinder> | null;
}

const states: Record<"workspace" | "ephemeral", SlotState> = {
  workspace: { slot: null, inflight: null },
  ephemeral: { slot: null, inflight: null },
};

/** Set by releaseFinders(); blocks in-flight acquires from writing back a fresh finder after disposal. */
let released = false;

function destroyFinder(finder: FileFinder): void {
  if (!finder.isDestroyed) finder.destroy();
}

async function acquire(state: SlotState, options: InitOptions): Promise<FileFinder> {
  for (;;) {
    const current = state.slot;
    if (current && current.basePath === options.basePath && !current.finder.isDestroyed) {
      return current.finder;
    }
    // Serialize create/swap per slot: concurrent calls either join the
    // in-flight acquire or loop until the slot settles under their base path.
    if (state.inflight) {
      await state.inflight.catch(() => {});
      continue;
    }
    const create = (async () => {
      if (current) destroyFinder(current.finder);
      const finder = unwrap(FileFinder.create(options), "FileFinder.create");
      try {
        // The content index builds in the background; wait so an early grep
        // does not silently return zero hits. A timeout surfaces as an error,
        // not a cold miss.
        unwrap(await finder.waitForScan(SCAN_TIMEOUT_MS), "waitForScan");
        unwrap(await finder.waitForIndexReady(SCAN_TIMEOUT_MS), "waitForIndexReady");
      } catch (error) {
        destroyFinder(finder);
        throw error;
      }
      if (released) {
        destroyFinder(finder);
        throw new FrecencyError("dsh-frecency released while acquiring finder");
      }
      state.slot = { basePath: options.basePath, finder };
      return finder;
    })();
    state.inflight = create;
    try {
      return await create;
    } finally {
      state.inflight = null;
    }
  }
}

/** Resident finder for the session workspace — created once, reused across calls. */
export async function getWorkspaceFinder(basePath: string): Promise<FileFinder> {
  released = false;
  return acquire(states.workspace, { basePath });
}

/** Short-lived finder for a `path` argument outside the workspace; replaces the previous ephemeral slot. */
export async function getEphemeralFinder(basePath: string): Promise<FileFinder> {
  released = false;
  return acquire(states.ephemeral, { basePath });
}

/** Destroy every resident finder (plugin disposal). Safe to call twice. */
export function releaseFinders(): void {
  released = true;
  for (const key of ["workspace", "ephemeral"] as const) {
    const slot = states[key].slot;
    if (slot) destroyFinder(slot.finder);
    states[key].slot = null;
  }
}
