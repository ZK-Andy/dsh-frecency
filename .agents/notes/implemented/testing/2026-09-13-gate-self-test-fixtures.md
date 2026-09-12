# Agent Note: gate-self-test-fixtures

Status: implemented

> 放置路径：`.agents/notes/implemented/testing/2026-09-13-gate-self-test-fixtures.md`
> 本笔记记录门禁脚本自测夹具的取舍：为什么内嵌 fixture、覆盖什么判据。

## Problem

门禁脚本的判据缺少可复跑的回归证据：`verify-md-links.py` 的排除集合与锚点判据只能靠临时搭树手工验证，同族的 `verify-handoff-structure.py` 已有 `--self-test`（11 个合成树用例），链接门禁缺席；`.agents/notes/README.md` 记录的门禁能力里，`verify-adr-format.py` 同样没有夹具自测，说明「门禁自带夹具」在本仓只是局部惯例而非成文做法。

## Decision

`verify-md-links.py` 内嵌 `--self-test`：离线合成树、不读本仓内容、逐用例断言错误列表。

- 扫描逻辑提为 `_scan(root, include_skills) -> (checked, errors)`：错误以 `(markdown 路径, 消息)` 二元组返回，夹具直接断言消息而不解析格式化后的字符串；判据本身（排除集合、可开关性）的单一事实源是 [exclude-vendored-clone-caches-from-md-links](../process/2026-09-13-exclude-vendored-clone-caches-from-md-links.md)。
- 判据 = 每个用例同时断言消息列表与 `checked` 计数（`Checked N` 只计解析成功的目标，失败项不计）；任一不符打印 `✗` 并以退出码 1 收场，全部相符打印 `== verify-md-links self-test passed ==`。
- 14 个用例覆盖两个判据面：链接解析（含外部与 `://` 跳过、根锚定 `/` 命中与未命中、空 fragment、散文中的文件名不校验）与排除面（`skills/` 默认排除与 `--include-skills` 解除、三个排除片段在任意层级、混合树只报本仓链接）。逐用例语义由脚本内的 `desc` 字符串承载，本笔记不复述。
- 入口为 `python3 scripts/verify-md-links.py --self-test`，须是唯一参数（多余参数落回 argparse 报错）；分流在 argparse 之前，因此无参数调用与既有调用点（CI、`.githooks/pre-commit`）行为不变。

## Alternatives considered

- **用 vitest 写 JS 侧测试**：门禁是 Python 脚本，跨语言要么桥接实现要么子进程调用，夹具成本高于收益；门禁自测留在脚本自身语言内，与既有 `--self-test` 惯例一致。
- **只做冒烟（对本仓内容跑一次门禁）**：本仓内容只能覆盖"当前存在哪些链接"，覆盖不到死锚点、排除集合、`--include-skills` 这些判据分支——判据回退时冒烟仍绿。
- **把夹具外置到 `tests/fixtures/`**：可读性更好，但脚本需在任意工作目录下定位夹具，且与 `verify-handoff-structure.py` 的内嵌形态分叉；两个门禁保持同形更省心。

## Consequences

- 收益：排除集合与锚点判据有可复跑的红/绿证据；改判据时先跑 `--self-test` 即暴露回退，不必依赖临建树手工验证。
- 代价：脚本体量净增约 80 行；夹具与实现同文件，改实现需同步改期望（夹具失败即提醒）。
- 已知缺口：`verify-adr-format.py` 尚无夹具自测，也不校验文件名/日期格式（该条现由评审强制，`.agents/notes/README.md` 已如实标注）；补齐属独立单元，不与链接门禁夹具混做。
