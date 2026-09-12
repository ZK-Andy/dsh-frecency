# Agent Note: enforce-adr-naming-in-host-gate

Status: implemented

> 放置路径：`.agents/notes/implemented/process/2026-09-13-enforce-adr-naming-in-host-gate.md`
> 本笔记记录把 ADR 路径/命名/日期判据移植进本仓门禁的决定与移植边界。

## Problem

`.agents/notes/README.md` 把「路径与状态」「文件名与日期」写成硬规则，并声明由 `scripts/verify-adr-format.py` 机器强制；本仓的 .py 版实际只校验头/骨架/状态-目录——它按 `parts[0]` 是否属于 lifecycle 目录决定是否继续，**不识别路径一律静默跳过**，于是顶层杂散笔记、缺 class 段的二层路径、大写/下划线文件名、非日历日（`2026-02-31`）都能通过门禁。规则的唯一保障因此落在评审的人眼上，而评审不覆盖每次提交。

## Decision

把心源仓 `verify-adr-format.mts` 的命名判据移植进本仓 `.py` 门禁，规则事实仍单家于 [.agents/notes/README.md](../../README.md)：

- 路径必须恰为 `<lifecycle>/<class>/<name>.md` 三段；lifecycle ∈ {proposed, implemented, rejected}，class ∈ 六元封闭集。**不识别路径一律报违约**（fail-closed），豁免面仅顶层 `README.md` / `AGENTS.md`，且只认一层深度——深位同名件照常受检。
- 文件名走 `^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$`；日期须是真实日历日（`2026-02-31`、非闰年 `02-29` 皆违约），不早于 1970，且不晚于 UTC 今日 +1 天（作者本地日期可领先 UTC 一天的容差）。
- `archived/` 与 `.zh.md` 仍整树跳过（归档冻结检查与双语配对规则不在本次移植面）。

## Alternatives considered

- **维持评审强制（把 README 的承诺改成"约定"）**：零实现成本，但规则失去机器兜底：杂散笔记与错日期只能靠人发现，历史证明这正是漏检来源；README 写硬规则而不强制，等于把契约降级成习惯。
- **整件移植心源仓的 `.mts`**：判据最全（含归档冻结校验、py 兼容原语）。落败原因：本仓门禁族是 Python 单轨，引入 TS 需要 Node 工具链与双轨维护，而本仓 notes 树只有 7 篇；移植判据本体即可，工具形态留在本仓既有栈内。
- **只校验文件名、不校验路径形状与 lifecycle/class**：实现最小，但保留"不识别路径静默跳过"的逃逸面——杂散笔记仍能绕过全部检查，恰是本次要堵的口。

## Consequences

- 收益：命名/日期/路径形状由门禁强制，评审不再承担这份机械核对；错误信息给到具体路径与期望形态。真实树实测 7 篇全绿，无需整改存量。
- 代价：`scripts/verify-adr-format.py` 相对 devops-template 源本产生较大漂移（新增判据与 `--self-test`），同步模板时需保留；`--self-test` 夹具随之覆盖命名面（见 [gate-self-test-fixtures](../testing/2026-09-13-gate-self-test-fixtures.md)）。
- 已知缺口：心源仓 `verify-archived-agent-notes.mts` 的归档冻结校验与双语 `.zh.md` 配对规则未移植，本仓 `archived/` 仍为门禁盲区；重新引入归档检查时按该件判据移植。
