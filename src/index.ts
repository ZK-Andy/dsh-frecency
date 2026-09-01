import z from "@deepseek-ai/schemastery";
import { GREP_MAX_LINE_BYTES, SEARCH_META_MAX_BYTES, SEARCH_TIMEOUT_MS } from "@deepseek-ai/dsh-tool-fs-search";
import type { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { getWorkspaceFinder, releaseFinders } from "./finder.ts";
import { defineGlobTool } from "./glob.ts";
import { defineGrepTool } from "./grep.ts";
import { pluginLog, setLogger } from "./log.ts";
import type { RetentionCaps } from "./presentation.ts";

export const name = "dsh-frecency";

export const inject = ["tools", "systemPrompt"] as const;

export const Config = z.object({
  enabled: z.boolean().default(true),
  globMaxResults: z.number().default(100),
  grepMaxMatches: z.number().default(250),
  grepMaxLineBytes: z.number().default(GREP_MAX_LINE_BYTES),
  searchMetaMaxBytes: z.number().default(SEARCH_META_MAX_BYTES),
  timeoutMs: z.number().default(SEARCH_TIMEOUT_MS),
  sampleOverCapGlobResults: z.boolean().default(false),
});

export interface ResolvedConfig {
  enabled: boolean;
  globMaxResults: number;
  grepMaxMatches: number;
  grepMaxLineBytes: number;
  searchMetaMaxBytes: number;
  timeoutMs: number;
  sampleOverCapGlobResults: boolean;
}

export interface PluginContext {
  tools: { register(definition: ToolDefinition): unknown };
  systemPrompt: {
    section(section: { name: string; order: number; text: string }): unknown;
    getSectionOrder(name: string): number;
  };
  agents?: { list(): AgentLike[] };
  on(event: "agent/created" | "agent/disposed", callback: (payload: { agent: AgentLike }) => void): unknown;
  logger: { info?(...args: unknown[]): void; warn(...args: unknown[]): void };
  /** Cordis reversible effect: the returned disposer runs when the plugin's fiber unloads. */
  effect<T>(setup: () => T, label?: string): unknown;
}

/** The slice of a live agent our per-agent install touches (see dsh-tool-subagent for the first-party precedent). */
export interface AgentLike {
  id: string;
  ctx: {
    inject(deps: readonly string[], fn: (runtime: AgentRuntimeContext) => void): { dispose(): Promise<void> | void };
  };
}

export interface AgentRuntimeContext {
  tools: { register(definition: ToolDefinition): unknown };
  systemPrompt: {
    section(section: { name: string; order: number; text: string }): unknown;
    getSectionOrder(name: string): number;
  };
}

type Caps = RetentionCaps & { timeoutMs: number };

function resolveCaps(config: Partial<ResolvedConfig> | undefined): Caps {
  // Default here as well as in Config: direct/unit callers may bypass the loader.
  return {
    globMaxResults: config?.globMaxResults ?? 100,
    grepMaxMatches: config?.grepMaxMatches ?? 250,
    grepMaxLineBytes: config?.grepMaxLineBytes ?? GREP_MAX_LINE_BYTES,
    searchMetaMaxBytes: config?.searchMetaMaxBytes ?? SEARCH_META_MAX_BYTES,
    timeoutMs: config?.timeoutMs ?? SEARCH_TIMEOUT_MS,
    sampleOverCapGlobResults: config?.sampleOverCapGlobResults ?? false,
  };
}

export async function apply(ctx: PluginContext, config?: Partial<ResolvedConfig>): Promise<void> {
  const resolved = config ?? {};
  const caps = resolveCaps(resolved);
  if (resolved.enabled === false) {
    ctx.logger.info?.("dsh-frecency: disabled by config; built-in grep/glob stay active");
    return;
  }

  // Registration-time probe with loud fallback: if the native engine cannot
  // start here, per-agent registration would leave every agent without a
  // working grep/glob. Stepping aside keeps the built-in ripgrep tools visible.
  try {
    await getWorkspaceFinder(process.cwd());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    ctx.logger.warn(`dsh-frecency: resident engine unavailable (${detail}); built-in grep/glob stay active`);
    return;
  }
  ctx.effect(() => () => releaseFinders(), "dsh-frecency: release native finders");
  setLogger(ctx.logger);
  pluginLog("armed; shadow grep/glob will be installed per agent on agent/created");

  // Shadowing must land in each agent's OWN layer: the built-in grep/glob are
  // mounted by agent presets on the agent plane, which beats any host-plane
  // registration, and one preset composition shares a single scope (a second
  // "grep" there collides). An agent-own registration wins every view; the
  // per-agent install fiber unwinds with the agent.
  const installed = new WeakMap<AgentLike, { dispose(): Promise<void> | void }>();
  const install = (agent: AgentLike): void => {
    if (installed.has(agent)) return;
    pluginLog(`installing shadow grep/glob into agent ${agent.id}`);
    installed.set(
      agent,
      agent.ctx.inject(["tools", "systemPrompt"], (runtime) => {
        runtime.tools.register(defineGrepTool(caps));
        runtime.tools.register(defineGlobTool(caps));
        runtime.systemPrompt.section({
          name: "tool:grep",
          order: runtime.systemPrompt.getSectionOrder("TOOL_GREP"),
          text:
            "Use the grep tool — not shell grep or rg — to search file contents. " +
            "Results come from a resident index and are ordered by file frecency (recently accessed or modified files first). " +
            "Use read on a matched file when you need surrounding context.",
        });
        runtime.systemPrompt.section({
          name: "tool:glob",
          order: runtime.systemPrompt.getSectionOrder("TOOL_GLOB"),
          text:
            "Use the glob tool — not shell find — to discover files by path pattern. " +
            "A pattern with no \"/\" matches basenames at any depth, so \"*\" matches every file in the tree rather than its top level. " +
            "Results are files only, never directories, and include hidden and ignored files: a result that fits comes back in modification-time order.",
        });
      }),
    );
  };
  // Best-effort only: "agents" is not declared in `inject` — awaiting it at
  // boot blocks deployments whose composition never provides it (observed on
  // headless). Agents created after boot all announce agent/created anyway.
  try {
    for (const agent of (ctx as PluginContext).agents?.list() ?? []) install(agent);
  } catch {
    // No agent registry in this deployment; agent/created still covers later agents.
  }
  ctx.on("agent/created", ({ agent }) => install(agent));
  ctx.on("agent/disposed", ({ agent }) => {
    const fiber = installed.get(agent);
    if (fiber === undefined) return;
    installed.delete(agent);
    Promise.resolve(fiber.dispose()).catch((error) => {
      ctx.logger.warn(`dsh-frecency: failed to dispose agent install: ${String(error)}`);
    });
  });
}
