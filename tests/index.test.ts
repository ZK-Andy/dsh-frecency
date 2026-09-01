import { beforeEach, describe, expect, it, vi } from "vitest";

const registered: string[] = [];
const sections: string[] = [];
let createError: string | null = null;
const effects: (() => void)[] = [];

vi.mock("@ff-labs/fff-node", () => ({
  FileFinder: {
    create: (options: { basePath: string }) => {
      if (createError !== null) return { ok: false, error: createError };
      return {
        ok: true,
        value: {
          isDestroyed: false,
          basePath: options.basePath,
          async waitForScan() {
            return { ok: true, value: true };
          },
          async waitForIndexReady() {
            return { ok: true, value: true };
          },
          destroy() {},
        },
      };
    },
  },
}));

const { apply } = await import("../src/index.ts");
const { releaseFinders } = await import("../src/finder.ts");

function makeCtx() {
  return {
    tools: { register: (definition: { name: string }) => void registered.push(definition.name) },
    systemPrompt: {
      section: (s: { name: string }) => void sections.push(s.name),
      getSectionOrder: () => 42,
    },
    logger: { warn: (message: string) => void warnings.push(message), info: () => {} },
    effect: (_setup: () => () => void) => void effects.push(() => {}),
  };
}

const warnings: string[] = [];

beforeEach(() => {
  registered.length = 0;
  sections.length = 0;
  warnings.length = 0;
  effects.length = 0;
  createError = null;
  releaseFinders();
});

describe("apply", () => {
  it("registers shadow grep/glob plus their system-prompt sections", async () => {
    await apply(makeCtx(), {});
    expect(registered.sort()).toEqual(["glob", "grep"]);
    expect(sections.sort()).toEqual(["tool:glob", "tool:grep"]);
  });

  it("registers nothing when disabled by config", async () => {
    await apply(makeCtx(), { enabled: false });
    expect(registered).toEqual([]);
    expect(sections).toEqual([]);
  });

  it("steps aside loudly when the native engine cannot start", async () => {
    createError = "native binary missing";
    await apply(makeCtx(), {});
    expect(registered).toEqual([]);
    expect(sections).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("native binary missing");
    expect(warnings[0]).toContain("built-in grep/glob stay active");
  });

  it("releases native finders through a cordis effect", async () => {
    const ctx = makeCtx();
    const setups: (() => () => void)[] = [];
    ctx.effect = (setup: () => () => void) => {
      setups.push(setup);
      return setup();
    };
    await apply(ctx, {});
    expect(setups).toHaveLength(1);
  });
});
