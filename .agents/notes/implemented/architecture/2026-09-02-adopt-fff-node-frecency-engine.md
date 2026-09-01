# Agent Note: adopt-fff-node-frecency-engine

Status: implemented

> 放置路径：`.agents/notes/implemented/architecture/2026-09-02-adopt-fff-node-frecency-engine.md`
> 本笔记记录 dsh-frecency 的核心技术选择（搜索引擎与内置工具覆盖机制）；背景/目标/权衡全文见 `docs/design.md`，此处不复制。

## Problem

dsh 内置 grep/glob（`@deepseek-ai/dsh-tool-fs-search`）每次调用 spawn 全新 ripgrep 进程、从零扫描，无缓存。长会话与多子代理场景下检索是重复的：扫描成本反复支出，大块 stdout 各自堆进同一 Node 堆。需要选定文件搜索引擎与接入机制，实现常驻索引 + frecency 排序，并让模型沿用同名 `grep`/`glob` 工具。

## Decision

**引擎：`@ff-labs/fff-node`（0.10.6，Rust fff 的 Node 绑定）；接入机制：`ctx.tools.register()` 同名遮蔽内置 grep/glob。**

- 引擎选型依据：常驻索引命中热内存（单次 sub-10ms）、原生 frecency 打分与 git 状态标注、`peerDependencies` 为空 + 仅 `ffi-rs` 一个依赖（零 pi ABI 纠缠）。
- 接入选型依据：DSH 工具注册表是分层作用域，nearest scope 同名条目遮蔽较远者——同名注册即替换内置实现，无需专门 provider seam；进程内调用无协议开销。
- 前期验证（2026-09-02，机械校验通过）：pnpm + `allowBuilds` 安装成功；`ffi-rs` 1.3.7 与 `@ff-labs/fff-bin-*` 均纯预编译包、零 install 脚本（`allowBuilds` 实际非必需）；Node 26 进程内实测 `FileFinder.create()` ~11ms、grep 命中带行号/`matchRanges`/gitStatus/frecency 分数。设计文档标注的唯一技术卡点解除。
- 实现 API 事实（以实测为准）：`create()`/`grep()` 等返回 `Result` 包装（取 `.value`）；`grep(query, options)` 签名；内容索引异步构建，grep 前 `await waitForIndexReady(timeout)`。

## Alternatives considered

- **已有 `dsh-fff`（纯 JS）**：子序列打分性能弱于 Rust 引擎，且明确不做 read/grep 工具覆盖，只新增 `fff_grep` 等新名字——无法满足"覆盖内置"目标。走零依赖单文件分发是它的形态取舍，非 DSH 硬限制。
- **fff MCP server（`fff-mcp`）**：进程外、经 MCP 协议往返，开销重；且 MCP 工具无法遮蔽内置 `grep`/`glob` 工具名。
- **Tantivy 等全文索引引擎**：面向文档级检索打分，本场景是单仓库、sub-10ms、不落盘反向索引，不同类。
- **不引入引擎、优化内置调用**（如缓存 ripgrep 结果）：缓存粒度粗、失效复杂，拿不到 frecency/定义标注/git 感知。

## Consequences

- 收益：重复检索命中常驻索引；模型无感切换（同工具名）；frecency + git 状态让模型优先触达活跃文件；多子代理共享一份索引。
- 代价：内存换性能（14k 文件仓库约 26MB 常驻），需预留可配置开关供大仓库/低复用场景回退内置 ripgrep；遮蔽后需自带 `SearchResultView` 对齐内置卡片呈现。
- 边界承诺：只降低重复检索成本，不消除子代理各自上下文在 Node 堆的累积；frecency 对冷文件/首次搜索提升有限。
- 遗留复验：同名遮蔽机制需在真实 dsh 环境复验 presentation 一致性（见 HANDOFF-todos）。
