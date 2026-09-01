# dsh-frecency — 项目规则

DeepSeek Harness (dsh) 插件：常驻索引 + frecency 排序的文件搜索，覆盖内置 grep/glob。本文件是**每会话自动加载的挂载面**：强制规则内联于此，细节单一事实源在流程卡与 `docs/`。

## 会话开场（强制）

每次会话开始/恢复，按 [session-open](.agents/workflows/session-open.md) 检查单顺序执行：读 HANDOFF 家庭 → git 对账 → 门禁基线 → 测试基线 → **声明会话模式**（讨论/调研/实现/发布）→ 向用户复述关键状态后等待命令。**任何动作先于模式声明**；模式切换必须显式（边界见 [session-modes](.agents/workflows/session-modes.md)）。

## 流程卡（索引）

- [session-modes](.agents/workflows/session-modes.md)——模式契约：讨论/调研/实现/发布的许可边界；**开场必须声明，切换必须显式，越界先停问**。
- [session-open](.agents/workflows/session-open.md) / [session-close](.agents/workflows/session-close.md)——会话开、收尾检查单；**收尾必过检查单**：提交对账、决策落 durable 家、README 漂移即同步、未推送数如实报告。
- [feature-flow](.agents/workflows/feature-flow.md)——开发主链路；**非平凡变更必须同变更携带 Agent Note（ADR）**（见 [.agents/notes/README.md](.agents/notes/README.md)），评审按三重审核执行契约（R1/R2/R3 角色定义在彼）。
- [release-flow](.agents/workflows/release-flow.md)——发版链路。

## 文档纪律

- 每个事实只有一个家：rationale → Agent Notes；procedure → cookbook；contract → README。
- 文档写当前状态，不写变更历史（"previously / now / no longer / renamed" 是 slop）。

## 质量门

```sh
python3 scripts/verify-adr-format.py       # ADR 头/骨架/状态-目录一致性
python3 scripts/verify-handoff-structure.py # HANDOFF 家庭结构
python3 scripts/verify-doc-budgets.py --manifest scripts/doc-budgets.manifest.json
python3 scripts/verify-md-links.py         # 相对链接/锚点
scripts/change-scope.sh [<base> <head>]   # 变更范围（评审/push 前置）
```

## 命令

```sh
pnpm install
pnpm check        # typecheck + build (tsdown) + test (vitest)，本地与 CI 同口径
scripts/setup-hooks.sh   # git hooks 指向 .githooks/（pre-commit/pre-push 增量快检）
```

## Git 纪律

- 改写历史必须 `--force-with-lease=<branch>:<observed-oid>`；**raw `--force` 永远禁止**。
- push 前最小证据：按 diff 面选最窄检查（`change-scope.sh`）。
