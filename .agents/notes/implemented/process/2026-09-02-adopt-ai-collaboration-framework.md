# Agent Note: adopt-ai-collaboration-framework

Status: implemented

> 放置路径：`.agents/notes/implemented/process/2026-09-02-adopt-ai-collaboration-framework.md`
> 本笔记记录 dsh-frecency 项目采纳 AI 协作开发体系的决策。

## Problem

dsh-frecency 是一个 DeepSeek Harness (dsh) 插件项目，从第一天起就由 coding agent（DSH）+ 人共同开发。若没有一套明确的协作规则，agent 的行为将无约束、决策散落在会话与 commit 里、文档随意膨胀、评审无据可依。需要一个**与具体项目无关**的 AI 协作开发骨架，作为项目规则与流程的单一事实源。

## Decision

从 `/mnt/work/devops-template`（提炼自 `deepseek-ai/deepseek-harness`，MIT）引入 AI 协作体系，按 `docs/ADAPTATION.md` 的 DSH 机制放置：

- 根 `AGENTS.md`：DSH 自动加载的入口规则（常驻命令 + 硬规则，每条 1-3 行 + 链接）。
- `.agents/AGENTS.md`：协作层专属规则 + 技能出处声明（MIT）。
- `.agents/skills/`：11 个技能原版（来自 devops-template，逐字节一致）。
- `.agents/notes/`：ADR 系统（`{proposed,implemented,rejected,archived}/{feature,bug-fix,simplification,architecture,process,testing}/`）。
- `.agents/workflows/`：流程卡（session-modes / feature-flow / session-open / session-close / release-flow）。
- `scripts/`：门禁（verify-adr-format / verify-doc-budgets / verify-md-links）+ change-scope.sh。
- `templates/`：adr-proposed / adr-implemented / agnents-hierarchy。

**关键约定**：
- 中文单语起步（双语镜像 `.zh.md` + `.i18n.yaml` 暂不启用，后续需要再启用）。
- 11 技能全带，使用一段时间后按证据复盘裁剪（触发过 ≥1 次或规则被引用才保留）。
- 先长后立：不等铺满所有目录，按项目真实需要生长。
- 每个事实只有一个家：rationale → Agent Notes；procedure → cookbook；contract → README。

## Alternatives considered

- **从上游 deepseek-harness 直接拷贝而非经 devops-template**：devops-template 已做去 GitHub 化/平台适配，经它搬运是既定实践；直接拷上游会带入 monorepo 路径引用，需额外映射。故经 devops-template。
- **照搬 dotnet-deepseek-harness-desktop 的现成骨架**：该项目是 .NET 桌面壳，命令/语言映射（pnpm→dotnet）对 TS 插件不适用，且会带入 HANDOFF 等 .NET 特有机制。不照搬，取通用方法论。
- **不建体系、依赖 DSH evolve 跨会话记忆**：evolve 是 harness 级经验，不随仓库走、不可版本化、不可评审。协作规则必须入仓库，故建 ADR + skills + 流程卡。

## Consequences

- 收益：agent 一进仓库即可按规则干活；决策入 ADR 可回放；文档预算/死链有门禁；评审有据。
- 代价：骨架文件需维护；11 技能首版后需复盘裁剪；`scripts/` 门禁需在 CI/hooks 接入后才能真正强制。
