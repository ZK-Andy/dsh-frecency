# Agent Note: annotate-grep-with-definition-and-git-status

Status: implemented

> 放置路径：`.agents/notes/implemented/feature/2026-09-02-annotate-grep-with-definition-and-git-status.md`
> 记录 grep 工具扩输出 schema：把引擎已算出的 `isDefinition` 与 `gitStatus` 额外发给模型。遮蔽机制见 `2026-09-02-mount-via-per-agent-registration`，引擎选型见 `2026-09-02-adopt-fff-node-frecency-engine`。

## Problem

v1（commit `3df72aa` 起）的 grep 工具输出 schema 与内置逐字段对齐，仅暴露 `{path, lineNumber, line}`。但引擎（`@ff-labs/fff-node`）每个匹配项实际带 17+ 字段，其中两类对模型决策有价值却一直被 v1 丢弃：`isDefinition`（该行是否为代码定义）与 `gitStatus`（该文件在 git 中的工作树状态）。

模型依赖 grep 定位目标后继续 `read`/`edit`：当同一 pattern 命中数十行时，无法区分哪行是函数/类定义、哪行只是调用；改代码后搜索时也不知道命中文件是否处于已修改状态。这两类信息引擎已算好，v1 只是没放进输出，属信息浪费。

## Decision

grep 工具输出 schema 扩为 `{path, lineNumber, line}` + 两个可选字段：`isDefinition`（boolean，定义行为 true，非定义行省略）与 `gitStatus`（string，该文件 git 工作树状态）。`isDefinition` 依赖引擎 `classifyDefinitions: true` 选项——`GrepOptions` 增设为 `classifyDefinitions: true`；`gitStatus` 引擎 grep 恒带，无需开关。两个字段均设为可选（非必填），最小化对内置 schema 的偏离，且 `isDefinition` 天然是 optional（引擎非定义行不返回）。

## Alternatives considered

- **只加 `gitStatus` 不加 `isDefinition`**：git 状态价值明确且零成本（引擎恒带），但定义优先正是 V2 的核心收益——模型靠它快速甄别定义行，弃它则只做了一半。落败。
- **不加 `classifyDefinitions`、在 TS 侧用正则近似判定义**：TS 侧正则要覆盖 struct/fn/class/import 等各语言结构，成本高、易漂移，且与引擎 Rust 分类不一致。落败——引擎已有原文支持的分类能力，应直接启用。
- **保持 v1 schema 不变（只靠行内容让模型自己猜）**：模型每命中都得读行内容再猜是否定义，搜索后还需额外 read 确认；git 状态无从得知。落败——信息已算好却不用，纯浪费。
- **把 `isDefinition` 设为必填**：引擎对非定义行**省略**该字段（实测），必填会导致输出校验失败。落败——必须 optional。

## Consequences

- 收益：模型能在 grep 命中集里甄别定义行（`isDefinition`），改码后能直接看命中文件的 git 状态（`gitStatus`）；额外引擎成本可忽略（`classifyDefinitions` 是逐行轻量启发式分类，仅标注不改匹配集/排序）。
- 代价：输出 schema 偏离内置（多两个可选字段）；需复验内置卡片 UI / 呈现层对额外字段的容忍度——内置 `formatGrepMatches`/`grepSearchMeta`/`isGrepMatch` 均只消费 `path`/`lineNumber`/`line`，对本插件呈现层同样乐观忽略，实测确认无破坏。
- 边界：`isDefinition` 是引擎启发式分类，非绝对准确（实测偶发把 `const { x } = await import(...)` 判为定义行），模型应视其为"可能定义"的提示而非结论。
- Testing：`classifyDefinitions` 开关 + 字段透传在单元层可 mock 验证（`GrepMatch` 带/不带 `isDefinition` 的两种分支）；真实引擎集成在现有 fff 集成测试覆盖。

## Related

- 遮蔽机制：`2026-09-02-mount-via-per-agent-registration`。
- 引擎选型：`2026-09-02-adopt-fff-node-frecency-engine`。
- 本笔记收口 `mount-via-per-agent-registration` Deferred 中的"isDefinition/git 标注扩 schema（v2）"。
