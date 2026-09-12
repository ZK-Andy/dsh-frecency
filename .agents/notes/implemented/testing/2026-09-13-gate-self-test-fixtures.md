# Agent Note: gate-self-test-fixtures

Status: implemented

> 放置路径：`.agents/notes/implemented/testing/2026-09-13-gate-self-test-fixtures.md`
> 本笔记记录门禁脚本自测夹具的取舍：为什么内嵌 fixture、覆盖什么判据。

## Problem

门禁脚本的判据自身没有回归保护。`verify-md-links.py` 的排除集合与锚点判据在 2026-09-13 只靠一次性 fixture 实证（临建临时树手工跑一次），改动后无人复核；同族的 `verify-handoff-structure.py` 已有 `--self-test`（11 个合成树用例），链接门禁缺席。而 `.agents/notes/README.md` 承诺的 `verify-adr-format.py --self-test` 在本仓 .py 版并不存在，说明"门禁自带夹具"在本仓只是局部惯例而非成文做法。

## Decision

`verify-md-links.py` 内嵌 `--self-test`：离线合成树、不读本仓内容、逐用例断言错误列表。

- 扫描逻辑提为 `_scan(root, include_skills) -> (checked, errors)`，与 `verify-handoff-structure.py` 的 `_scan` 同形，夹具直接调它而不经 argparse 或 stdout 抓取。
- 判据 = 每个用例把实际错误去掉 `<临时路径>: ` 前缀后与期望逐项相等；任一不符打印 `✗` 并以退出码 1 收场，全部相符打印 `== verify-md-links self-test passed ==`。
- 10 个用例覆盖两类判据：链接解析（解析成功 / 缺失目标 / 死锚点 / 标题 slug / 显式 `<a id>` / 无链接）与排除面（`skills/` 默认排除与 `--include-skills` 解除 / 三个排除片段在任意层级 / 被排除目录的悬空链接保持沉默而本仓链接照报）。
- 入口为 `python3 scripts/verify-md-links.py --self-test`，在 argparse 之前分流，因此无参数调用与既有调用点（CI、`.githooks/pre-commit`）行为不变。

## Alternatives considered

- **用 vitest 写 JS 侧测试**：门禁是 Python 脚本，跨语言要么桥接实现要么子进程调用，夹具成本高于收益；门禁自测留在脚本自身语言内，与既有 `--self-test` 惯例一致。
- **只做冒烟（对本仓内容跑一次门禁）**：本仓内容只能覆盖"当前存在哪些链接"，覆盖不到死锚点、排除集合、`--include-skills` 这些判据分支——判据回退时冒烟仍绿。
- **把夹具外置到 `tests/fixtures/`**：可读性更好，但脚本需在任意工作目录下定位夹具，且与 `verify-handoff-structure.py` 的内嵌形态分叉；两个门禁保持同形更省心。
- **顺手补齐 `verify-adr-format.py --self-test` 与命名校验**：两者都是 `.agents/notes/README.md` 承诺、本仓 .py 版缺席的能力，属独立单元（ADR 格式判据 + 文件名正则），不与链接门禁的夹具混做。

## Consequences

- 收益：排除集合与锚点判据有可复跑的红/绿证据；改判据时先跑 `--self-test` 即暴露回退，不必依赖临建树手工验证。
- 代价：脚本体量增加约 60 行；夹具与实现同文件，改实现需同步改期望（夹具失败即提醒）。
- 已知缺口：`.agents/notes/README.md` 记的 `verify-adr-format.py --self-test` 与"文件名/路径命名规则"机器校验在本仓 .py 版均不存在（开关与校验都缺席），本次未补。
