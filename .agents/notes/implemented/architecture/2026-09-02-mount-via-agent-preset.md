# Agent Note: mount-via-agent-preset

Status: implemented

> 放置路径：`.agents/notes/implemented/architecture/2026-09-02-mount-via-agent-preset.md`
> 记录 dsh-frecency 的装载平面决策（agent 预设组合行，非 host bundle 同名遮蔽）；工具机制与引擎选型见 `2026-09-02-adopt-fff-node-frecency-engine`，实现契约见 `docs/architecture.md`。

## Problem

真实 dsh 环境验证（desktop，dsh 0.1.2-alpha.3）发现：经 profile bundle（`dsh plugin add` → `dsh.profile.bundles` 层栈）挂载的插件在 `apply()` 里 `ctx.tools.register()` 同名注册 `grep`/`glob`，会话内的工具调用仍由内置 ripgrep 服务。取证链：插件 `apply()` 完整执行（`libfff_c.so` 仅在 `FileFinder.create()` 时映射、真宿主进程已映射、注册无任何报错），但 glob 引擎返回 6 条 vs 会话 195 条、grep 引擎 64 项 vs 会话 44 行——会话解析到的实现不是插件层。

根因是 DSH 的**双平面合成**：host 平面（profile bundle 层栈）与 agent 平面（agent 预设组合，会话创建时挂载、按 scope 父子链继承）。内置 grep/glob（`@deepseek-ai/dsh-tool-fs-search`）由 agent 预设的行（`standard` 等预设的 `tool-fs-search`）挂载，对会话而言比 host 平面的任何注册都更近；dsh-scope `chainLayers` 的 nearest-wins 语义下，host 平面的同名注册永远落败。旁证：headless profile 无预设机制，fs-search 与本插件同在 host include 层，同名注册直接崩溃（`tool "grep" is already registered`）——同层不可重名，遮蔽只可能来自更近的层。

## Decision

dsh-frecency 的工具注册走 **agent 平面**：包内附带从 shipped `standard` 预设派生的预设模板（`preset/`），用户复制到 `~/.dsh/.agent-presets/dsh-frecency/` 并让会话选择该预设；组合行插在 `tool-fs-search` 之后——同一组合内后行更近，nearest-wins 语义下遮蔽生效。host 平面的 bundle 挂载保留（`dsh plugin add` 继续管依赖与包生命周期），但以 `enabled: false` 配置显式置惰，避免双份注册与双份索引。

## Alternatives considered

- **上游 provider seam（web 的 `searchProvider` 模式）**：给 fs-search 加配置选择搜索引擎是正解（anysearch 即循此：`- id: web` 配置覆盖 + `ctx.web.registerSearchProvider`，全程不同名竞争），零用户操作；但依赖上游改动，先以预设组合交付，上游接纳后迁移。
- **更名工具（`fff_grep` 等）**：放弃"同名覆盖、模型零切换"的核心目标；anysearch 能用新名字是因为搜索目标本就是新增能力，而 grep/glob 是模型默认路径。
- **host 平面补丁覆盖 agent 预设**：平面隔离，profile 补丁触及不到 agent 平面组合。
- **直接改 shipped 预设文件**：污染上游包，dsh 升级即失。

## Consequences

- 收益：遮蔽在真实环境成立；npm 分发与依赖管理不变；`dsh plugin remove` 仍可卸载；预设行摘除即回退内置。
- 代价：安装从一步变两步（plugin add + 复制预设并选择）；预设模板复制自 standard@0.1.2-alpha.3，上游预设演进需手动同步（peerDependencies 锁同版本）；同机双挂载（host 惰性 + 预设活跃）。
- Deferred：上游 fs-search provider seam 跟进；引擎 glob 与内置 glob 的 ignored/hidden 语义对齐；isDefinition/git 标注扩 schema（v2）。
