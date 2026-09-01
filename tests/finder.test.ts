import { beforeEach, describe, expect, it, vi } from "vitest";

let created: FakeFinder[] = [];

class FakeFinder {
  static nextScanReady = true;
  static nextIndexReady = true;
  static nextCreateFails = false;

  isDestroyed = false;
  basePath: string;
  destroyed = 0;

  constructor(options: { basePath: string }) {
    if (FakeFinder.nextCreateFails) throw new Error("native binary missing");
    this.basePath = options.basePath;
    created.push(this);
  }

  async waitForScan() {
    if (!FakeFinder.nextScanReady) return { ok: false, error: "scan timeout" };
    return { ok: true, value: true };
  }

  async waitForIndexReady() {
    if (!FakeFinder.nextIndexReady) return { ok: false, error: "index timeout" };
    return { ok: true, value: true };
  }

  destroy() {
    this.isDestroyed = true;
    this.destroyed += 1;
  }
}

vi.mock("@ff-labs/fff-node", () => ({
  FileFinder: {
    create: (options: { basePath: string }) => {
      try {
        return { ok: true, value: new FakeFinder(options) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  },
}));

const { getEphemeralFinder, getWorkspaceFinder, releaseFinders } = await import("../src/finder.ts");

beforeEach(() => {
  created = [];
  FakeFinder.nextScanReady = true;
  FakeFinder.nextIndexReady = true;
  FakeFinder.nextCreateFails = false;
  releaseFinders();
});

describe("getWorkspaceFinder", () => {
  it("reuses one resident finder per base path", async () => {
    await getWorkspaceFinder("/ws");
    await getWorkspaceFinder("/ws");
    expect(created).toHaveLength(1);
  });

  it("destroys and rebuilds when the base path changes", async () => {
    const first = await getWorkspaceFinder("/ws");
    await getWorkspaceFinder("/other");
    expect(first.destroyed).toBe(1);
    expect(created).toHaveLength(2);
    expect(created[1]!.basePath).toBe("/other");
  });

  it("rebuilds after the previous finder was destroyed externally", async () => {
    const first = await getWorkspaceFinder("/ws");
    first.isDestroyed = true;
    await getWorkspaceFinder("/ws");
    expect(created).toHaveLength(2);
  });

  it("propagates a create failure and a scan failure as errors", async () => {
    FakeFinder.nextCreateFails = true;
    await expect(getWorkspaceFinder("/ws")).rejects.toThrow("native binary missing");
    FakeFinder.nextCreateFails = false;
    FakeFinder.nextScanReady = false;
    await expect(getWorkspaceFinder("/ws")).rejects.toThrow("waitForScan");
  });

  it("destroys the finder when the index readiness wait fails", async () => {
    FakeFinder.nextIndexReady = false;
    await expect(getWorkspaceFinder("/ws")).rejects.toThrow("waitForIndexReady");
    expect(created[0]!.destroyed).toBe(1);
    // The slot stays clean: the next acquire starts from scratch.
    FakeFinder.nextIndexReady = true;
    await getWorkspaceFinder("/ws");
    expect(created).toHaveLength(2);
  });

  it("serializes concurrent acquires onto one shared finder", async () => {
    const [a, b] = await Promise.all([getWorkspaceFinder("/ws"), getWorkspaceFinder("/ws")]);
    expect(a).toBe(b);
    expect(created).toHaveLength(1);
  });

  it("settles concurrent acquires on different base paths without leaks or double destroy", async () => {
    const [a, b] = await Promise.all([getWorkspaceFinder("/ws"), getWorkspaceFinder("/other")]);
    expect(created).toHaveLength(2);
    expect(a.destroyed).toBe(1);
    expect(b.destroyed).toBe(0);
  });
});

describe("getEphemeralFinder", () => {
  it("keeps at most one ephemeral finder, replacing the previous", async () => {
    const first = await getEphemeralFinder("/outside-1");
    await getEphemeralFinder("/outside-2");
    expect(first.destroyed).toBe(1);
    expect(created).toHaveLength(2);
  });

  it("never evicts the workspace slot", async () => {
    const workspace = await getWorkspaceFinder("/ws");
    await getEphemeralFinder("/outside");
    await getWorkspaceFinder("/ws");
    expect(workspace.destroyed).toBe(0);
    expect(created).toHaveLength(2);
  });
});

describe("releaseFinders", () => {
  it("destroys every live finder and is safe to call twice", async () => {
    await getWorkspaceFinder("/ws");
    await getEphemeralFinder("/outside");
    releaseFinders();
    expect(created.every((f) => f.destroyed === 1)).toBe(true);
    releaseFinders();
    expect(created.every((f) => f.destroyed === 1)).toBe(true);
  });
});
