# Agent Note: perf-memory-baseline

Status: implemented

> 放置路径：`.agents/notes/implemented/testing/2026-09-13-perf-memory-baseline.md`
> 本笔记记录性能/内存基线的测量口径、工具入仓与对外声明收敛。

## Problem

`docs/design.md` §7 与 `docs/testing.md` 的「性能与内存基线」都要求测「大仓库重复检索延迟（内置 spawn vs 常驻索引）、宿主 RSS、单份索引常驻内存」，但三项从未固化为 durable 记录：`docs/` 无基线文档。同时 README 双语已对外发布量化声明（"single-digit milliseconds per call" / 「单次调用毫秒级」），没有本地证据支撑。遮蔽（同名覆盖内置工具）也让人以为内置臂不可测——实际上内置 grep/glob 没有索引、每次 spawn 一个 ripgrep，两个机制都能脱离 harness 直接调用。

## Decision

以**机制级两臂**测量作为设计文档 §7 的性能/内存口径，工具与结果同时入仓：

- 索引臂 = 插件实际调用的引擎 API（查询参数与分页循环对齐 `src/grep.ts`），内置臂 = 每次 spawn 内置工具相同 argv 的 `rg`；两臂都不含插件呈现与 harness 渲染，数字因此是端到端下界。
- 测量工具入仓 `scripts/bench-resident-index.mjs`；结果单家于 [docs/performance.md](../../../../docs/performance.md)（口径、复现、实测表、解读、未覆盖项），并纳入 `doc-budgets.manifest.json` 预算。
- 对外声明以实测为准：README 双语改述为「复用常驻索引、省去每次 spawn」，未再带未经取证的毫秒级承诺（数值与口径单家于 [performance.md](../../../../docs/performance.md)）。

## Alternatives considered

- **不本地测，沿用上游 fff 的数字**：上游口径的文件混合与本仓合成树不同、不可直接比较，也撑不起本仓自己的对外声明；本机实测见 [performance.md](../../../../docs/performance.md)。
- **在真实 dsh 会话里测端到端**：最贴近用户体验，但受模型调度、工具调用顺序与子代理数量影响，慢且不可复现；机制级测量先给出可复现的下界与口径，端到端留待真机会话打点。
- **用真实大仓库（如 Chromium）而非合成树**：更真实，但要下载数十 GB、结果随仓库快照漂移，且 CI/本机都不可重复；合成树确定、生成命令随文档入仓。
- **只在 scratch 里跑、不入仓**：省一个文件，但基线不可复现，下次测量要重写脚本。

## Consequences

- 收益：对外倍数声明有据；基线按 [performance.md](../../../../docs/performance.md) 的复现路径即可重跑；「索引重复检索更快」由实测支撑。
- 代价：多一个入仓脚本（不进 npm 包，也不进 CI——生成 14k 树与 20 次测量不适合每次跑）；数字随机器、树形与命中数变化，文档只承诺口径与量级，不承诺固定值。
- 已知缺口：宿主 RSS（长会话/多子代理）与端到端工具延迟未测（需真实 harness 会话）；内置臂用的是系统 `rg` 而非 harness 打包二进制（本机 profile 未安装对应 platform 包）。
