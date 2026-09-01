import { beforeEach, describe, expect, it, vi } from "vitest";

let createError: string | null = null;
const effects: (() => void)[] = [];
const warnings: string[] = [];

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

interface FixtureAgent {
  id: string;
  registered: string[];
  sections: string[];
  disposed: boolean;
}

function makeAgent(id: string): FixtureAgent & import("../src/index.ts").AgentLike {
  const agent: FixtureAgent = { id, registered: [], sections: [], disposed: false };
  return {
    id,
    get registered() {
      return agent.registered;
    },
    get sections() {
      return agent.sections;
    },
    get disposed() {
      return agent.disposed;
    },
    ctx: {
      inject(_deps, fn) {
        fn({
          tools: { register: (definition: { name: string }) => void agent.registered.push(definition.name) },
          systemPrompt: {
            section: (s: { name: string }) => void agent.sections.push(s.name),
            getSectionOrder: () => 42,
          },
        });
        return {
          dispose: async () => {
            agent.disposed = true;
          },
        };
      },
    },
  } as FixtureAgent & import("../src/index.ts").AgentLike;
}

function makeCtx(agents: ReturnType<typeof makeAgent>[] = []) {
  const listeners: Record<string, ((payload: { agent: unknown }) => void)[]> = {};
  return {
    agents: { list: () => agents },
    on(event: string, callback: (payload: { agent: unknown }) => void) {
      (listeners[event] ??= []).push(callback);
    },
    emit(event: string, agent: unknown) {
      for (const callback of listeners[event] ?? []) callback({ agent });
    },
    logger: { warn: (message: string) => void warnings.push(message), info: () => {} },
    effect: (_setup: () => () => void) => void effects.push(() => {}),
  };
}

beforeEach(() => {
  effects.length = 0;
  warnings.length = 0;
  createError = null;
  releaseFinders();
});

describe("apply", () => {
  it("installs shadow tools into each agent's own layer via agent/created", async () => {
    const ctx = makeCtx();
    await apply(ctx, {});
    const agent = makeAgent("a1");
    ctx.emit("agent/created", agent);
    expect(agent.registered.sort()).toEqual(["glob", "grep"]);
    expect(agent.sections.sort()).toEqual(["tool:glob", "tool:grep"]);
  });

  it("installs into agents that already exist at apply time", async () => {
    const agent = makeAgent("existing");
    await apply(makeCtx([agent]), {});
    expect(agent.registered.sort()).toEqual(["glob", "grep"]);
  });

  it("ignores a repeated created announcement for the same agent", async () => {
    const ctx = makeCtx();
    await apply(ctx, {});
    const agent = makeAgent("a1");
    ctx.emit("agent/created", agent);
    ctx.emit("agent/created", agent);
    expect(agent.registered).toEqual(["grep", "glob"]);
  });

  it("disposes the install fiber when the agent is disposed", async () => {
    const ctx = makeCtx();
    await apply(ctx, {});
    const agent = makeAgent("a1");
    ctx.emit("agent/created", agent);
    ctx.emit("agent/disposed", agent);
    expect(agent.disposed).toBe(true);
  });

  it("installs nothing when disabled by config", async () => {
    const ctx = makeCtx();
    await apply(ctx, { enabled: false });
    const agent = makeAgent("a1");
    ctx.emit("agent/created", agent);
    expect(agent.registered).toEqual([]);
    expect(agent.sections).toEqual([]);
  });

  it("steps aside loudly when the native engine cannot start", async () => {
    createError = "native binary missing";
    const ctx = makeCtx();
    await apply(ctx, {});
    const agent = makeAgent("a1");
    ctx.emit("agent/created", agent);
    expect(agent.registered).toEqual([]);
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
