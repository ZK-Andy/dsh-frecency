# dsh-frecency — 项目规则

DeepSeek Harness (dsh) 插件：常驻索引 + frecency 排序的文件搜索，覆盖内置 grep/glob。是一套"通用适配"与项目本体分开的两步走——本文件只承载协作层规则，项目技术事实进入 `docs/`（第二步建立）。

## 命令

```sh
# 构建 / 测试 / 门禁（技术栈确定后填充，见 docs/development.md）
# 占位：第二步项目专属初始化时补全
```

## 约定

- 非平凡变更必须携带 Agent Note（见 [.agents/notes/README.md](.agents/notes/README.md)）。
- 会话开场声明模式（讨论/调研/实现/发布），见 [.agents/workflows/session-modes.md](.agents/workflows/session-modes.md)。
- 主开发链路见 [.agents/workflows/feature-flow.md](.agents/workflows/feature-flow.md)。

## 文档纪律

- 每个事实只有一个家：rationale → Agent Notes；procedure → cookbook；contract → README。
- 文档写当前状态，不写变更历史（"previously / now / no longer / renamed" 是 slop）。

## 质量门

```sh
python3 scripts/verify-adr-format.py       # ADR 头/骨架/状态-目录一致性
python3 scripts/verify-doc-budgets.py --manifest scripts/doc-budgets.manifest.json
python3 scripts/verify-md-links.py         # 相对链接/锚点
scripts/change-scope.sh [<base> <head>]   # 变更范围（评审/push 前置）
```

## Git 纪律

- 改写历史必须 `--force-with-lease=<branch>:<observed-oid>`；raw `--force` 永远禁止。
- push 前最小证据：按 diff 面选最窄检查（`change-scope.sh`）。
