# Agent Note: mount-via-per-agent-registration

Status: implemented

> 放置路径：`.agents/notes/implemented/architecture/2026-09-02-mount-via-per-agent-registration.md`
> 记录 dsh-frecency 的工具装载决策（per-agent 注册进 agent 自己的层）；引擎选型见 `2026-09-02-adopt-fff-node-frecency-engine`，实现契约见 `docs/architecture.md`。

## Problem

真实 dsh 环境验证（desktop，dsh 0.1.2-alpha.3）推翻了"host 平面同名注册遮蔽内置 grep/glob"的设计假设：DSH 双平面合成下，内置 `grep`/`glob`（`@deepseek-ai/dsh-tool-fs-search`）由 agent 预设在会话创建时挂载于 agent 平面——对会话而言比 host 平面任何注册都更近，dsh-scope `chainLayers` nearest-wins 语义下 host 平面注册永远落败（取证：插件 `apply()` 完整执行、引擎已映射，但会话解析到的是内置 ripgrep）。且同一预设组合的所有行共享一个 scope，同名工具两行并存直接冲突（`tool "grep" is already registered in this scope`）；无预设部署（headless）里 fs-search 与插件同在 host 层，同名注册同样崩溃。若要求用户改用派生预设才能生效，插件即丧失即插即用价值——等同失败。

## Decision

工具注册走 **per-agent 路线**：插件 `apply()` 不再直接注册，而是监听 `agent/created`，对每个新建 agent 经 `agent.ctx.inject(["tools", "systemPrompt"], ...)` 把 grep/glob 与对应 system-prompt 节注册进 **agent 自己的层**——层合并语义下 own 层赢过一切继承层（预设挂的内置工具、host 全局层都一样），因此无论用户选什么预设、部署有没有预设，同名遮蔽都成立；子代理同样逐个获得实例，共享模块级常驻索引。`agent/disposed` 时 dispose 安装 fiber；`agents` 注册表不进 `inject`（声明后 boot 会阻塞等待该服务，headless 组合不提供——实测），只做运行期 best-effort 枚举。`apply()` 保留注册期引擎探测：失败即不安装并显式 warn，回退内置 ripgrep。

## Alternatives considered

- **agent 预设组合行**（`standard` 派生副本，包内附带模板）：诊断阶段证明了平面事实，但同一组合内与 `tool-fs-search` 并置必撞名，整行替换则等于 fork 上游预设——用户被钉死在过期副本上、与其它预设互斥，即插即用价值归零。落败，预设模板已移除。
- **上游 provider seam（web 的 `searchProvider` 模式）**：最正统的终局，需上游改动；per-agent 路线不依赖它，若上游接纳 seam 可再迁移。
- **更名工具（`fff_grep` 等，dsh-fff 路线）**：放弃"同名覆盖、模型零切换"的核心目标。教训：dsh-fff 明确绕开覆盖当时被我判读为"它的形态选择、非 DSH 硬限制"——先行者绕开某机制时，"可能撞过墙"至少与"偏好不同"同权重，应以真实环境实证裁决，静态源码佐证不算数。

## Consequences

- 收益：装完即用，任何预设下遮蔽成立；子代理逐 agent 获得注册、共享一份常驻索引；`agent/disposed` 随 agent 回收，插件卸载经 cordis effect 统一释放。
- 代价：注册从一次变每 agent 一次（定义无状态，代价可忽略）；依赖 `agent/created` 事件面（第一方 dsh-tool-subagent / dsh-file-reference-local 同款先例）；headless 类无 agent 生命周期的部署未验证。
- Deferred：上游 fs-search provider seam 跟进；isDefinition/git 标注扩 schema（v2）。glob 的 ignored/hidden 语义对齐已由 `glob-serves-via-rg-parity` 收口。
