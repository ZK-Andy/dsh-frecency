# Agent Note: perf-memory-baseline

Status: implemented

> 放置路径：`.agents/notes/implemented/testing/2026-09-13-perf-memory-baseline.md`
> 本笔记记录性能/内存基线的测量口径、工具入仓与对外声明收敛。

## Problem

`docs/design.md` §7 与 `docs/testing.md` 的「性能与内存基线」都要求测「大仓库重复检索延迟（内置 spawn vs 常驻索引）、宿主 RSS、单份索引常驻内存」，但三项从未执行：`docs/` 无基线文档、journal 无计时记录。同时 README 双语已对外发布量化声明（"single-digit milliseconds per call" / 「单次调用毫秒级」），没有本地证据支撑。遮蔽（同名覆盖内置工具）也让人以为内置臂不可测——实际上内置 grep/glob 没有索引、每次 spawn 一个 ripgrep，两个机制都能脱离 harness 直接调用。

## Decision

以**机制级两臂**测量作为设计文档 §7 的性能/内存口径，工具与结果同时入仓：

- 工具 `scripts/bench-resident-index.mjs`：`gen` 生成确定性合成树、`run` 同树同 pattern 对比两臂（索引臂用 `src/grep.ts` 的查询参数与分页循环；内置臂 spawn 内置工具相同 argv 的 `rg`），输出重建树耗时、RSS 增量与两臂 p50/p95 的 JSON。路径全走参数，无硬编码。
- 结果固化为 [docs/performance.md](../../../../docs/performance.md)（口径、复现命令、实测表、解读、未覆盖项），并纳入 `doc-budgets.manifest.json` 预算。
- 对外声明按实测收敛：README 双语不再承诺"毫秒级"，改述为「省去每次 spawn」并以「14k 文件实测约 3×」背书。

## Alternatives considered

- **不本地测，沿用上游 fff 的数字**：上游口径的文件混合与本仓不同（实测 14k 文件索引增量 8MB vs 上游 26MB 口径），且撑不起本仓自己的对外声明——4k 文件、40 命中的实测已是两位数毫秒。
- **在真实 dsh 会话里测端到端**：最贴近用户体验，但受模型调度、工具调用顺序与子代理数量影响，慢且不可复现；机制级测量先给出可复现的下界与口径，端到端留待真机会话打点。
- **用真实大仓库（如 Chromium）而非合成树**：更真实，但要下载数十 GB、结果随仓库快照漂移，且 CI/本机都不可重复；合成树确定、生成命令随文档入仓。
- **只在 scratch 里跑、不入仓**：省一个文件，但基线不可复现，下次测量要重写脚本。

## Consequences

- 收益：对外毫秒声明有据并已收敛；基线一条 `gen` + 一条 `run` 即可复现；「索引更快」由数字支撑（重复检索 1.5–3.1×，索引构建一次性 60–110ms）。
- 代价：多一个入仓脚本（不进 npm 包，也不进 CI——生成 14k 树与 20 次测量不适合每次跑）；数字随机器、树形与命中数变化，文档只承诺口径与量级，不承诺固定值。
- 已知缺口：宿主 RSS（长会话/多子代理）与端到端工具延迟未测（需真实 harness 会话）；内置臂用的是系统 `rg` 而非 harness 打包二进制（本机 profile 未安装对应 platform 包）。
