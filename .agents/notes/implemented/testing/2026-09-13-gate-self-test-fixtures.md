# Agent Note: gate-self-test-fixtures

Status: implemented

> 放置路径：`.agents/notes/implemented/testing/2026-09-13-gate-self-test-fixtures.md`
> 本笔记记录门禁脚本自测夹具的取舍：为什么内嵌 fixture、覆盖什么判据。

## Problem

门禁脚本的判据缺少可复跑的回归证据：判据一改，只能临时搭树手工验证。`verify-handoff-structure.py` 先有 `--self-test`（11 个合成树用例），`verify-md-links.py` 与 `verify-adr-format.py` 都没有夹具，「门禁自带夹具」在本仓只是局部惯例而非成文做法。

## Decision

门禁脚本内嵌 `--self-test`：离线合成树、不读本仓内容、逐用例断言 `checked` 与错误列表。

- 各门禁的扫描逻辑提为 `_scan(...) -> (checked, errors)`，夹具直接调它而不经参数解析或 stdout 抓取；`verify-md-links.py` 的错误以 `(路径, 消息)` 二元组返回，夹具不解析格式化后的字符串。
- 判据 = 每个用例同时断言 `checked` 计数与**完整错误串列表**（相等比较，不是子串包含：路径前缀与文案漂移都算失败）；任一不符打印 `✗` 并以退出码 1 收场，全部相符打印 `== <gate> self-test passed ==`。
- `verify-md-links.py`：覆盖链接解析（外部与 `://` 跳过、根锚定 `/` 命中与未命中、空 fragment、散文文件名不校验）与排除面（`skills/` 默认排除与 `--include-skills` 解除、三个排除片段任意层级、混合树只报本仓链接）；判据本身单家于 [exclude-vendored-clone-caches-from-md-links](../process/2026-09-13-exclude-vendored-clone-caches-from-md-links.md)。
- `verify-adr-format.py`：覆盖路径段数（fail-closed）、lifecycle/class 封闭集、slug 正则、日历日与容差两侧（UTC 今日 +1 通过、+2 拒绝）、1970 下界、状态-目录一致性、骨架缺失、implemented 禁用 spec 标题，以及 archived、`.zh.md`、顶层豁免三条跳过面；判据本身单家于 [enforce-adr-naming-in-host-gate](../process/2026-09-13-enforce-adr-naming-in-host-gate.md)。
- 入口都是 `--self-test`，且必须是**唯一参数**（三个门禁同一形态：多余参数落回参数解析器报错，实测 `--self-test extra` 与 `--self-test --bogus` 均 exit 2）；分流在参数解析之前，因此无参数调用与既有调用点（CI、`.githooks/*`）行为不变。
- 逐用例语义由脚本内的 `desc` 字符串承载，本笔记不复述。

## Alternatives considered

- **用 vitest 写 JS 侧测试**：门禁是 Python 脚本，跨语言要么桥接实现要么子进程调用，夹具成本高于收益；门禁自测留在脚本自身语言内，与既有 `--self-test` 惯例一致。
- **只做冒烟（对本仓内容跑一次门禁）**：本仓内容只能覆盖"当前存在哪些链接"，覆盖不到死锚点、排除集合、`--include-skills` 这些判据分支——判据回退时冒烟仍绿。
- **把夹具外置到 `tests/fixtures/`**：可读性更好，但脚本需在任意工作目录下定位夹具，且与 `verify-handoff-structure.py` 的内嵌形态分叉；两个门禁保持同形更省心。

## Consequences

- 收益：命名/路径/日期判据、排除集合与锚点判据都有可复跑的红/绿证据；改判据时先跑 `--self-test` 即暴露回退，不必依赖临时搭树手工验证。
- 代价：两个脚本体量净增约 80 行（md-links）与约 120 行（adr-format）；夹具与实现同文件，改实现需同步改期望（夹具失败即提醒）。
- 已知缺口：`verify-doc-budgets.py` 尚无夹具自测；归档冻结检查与双语配对规则未机器化（判据家与缺口见 [enforce-adr-naming-in-host-gate](../process/2026-09-13-enforce-adr-naming-in-host-gate.md)）。
