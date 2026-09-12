# 性能与内存基线

> 本文件是 `docs/design.md` §7「性能/内存」验证项的实测基线，也是「索引比每次 spawn 快多少」与「索引占多少内存」两个数字的唯一家。工具 = `scripts/bench-resident-index.mjs`。

## 口径

两臂同树、同 pattern，各预热一次页缓存后测 20 次；下表是 3 轮（每轮 20 次）的极值区间：

- **常驻索引臂**：插件实际调用的引擎 API——`FileFinder.create({basePath})` → `waitForScan` → `waitForIndexReady`，随后按 `src/grep.ts` 的 `GrepOptions`（`mode:regex`、`smartCase:false`、`pageSize:500`、`cursor` 分页、`classifyDefinitions:true`）查询，进程常驻。
- **内置机制臂**：每次调用 spawn 一个 `rg`，argv 与内置工具 `buildGrepCommand` 相同（`--no-config --json --regexp=<pattern> -- <tree>`）。

两臂都是**机制级**：不含插件的 mapping、prefix/include 过滤与卡片呈现，也不含 harness 的结果 schema 校验与渲染。端到端工具延迟必然高于下表。

## 复现

```sh
node scripts/bench-resident-index.mjs gen .plan/bench/tree --files 14000
for i in 1 2 3; do node scripts/bench-resident-index.mjs run .plan/bench/tree --iterations 20; done
```

合成树：每目录 100 个文件、每文件约 4KB、每 100 个文件 1 个含标记词 `benchmarkmarker`（14k 文件 = 55MB / 140 命中）。`run` 的索引臂沿用 `src/grep.ts` 的分页上限（4 页 × 500 = 2000 命中）；命中更多的 pattern 会让两臂不再可比，默认 pattern 只有 140 命中。

## 实测

宿主：Intel i7-3630QM（8 核）/ 7.8GB RAM / Linux，node v26.8.1，系统 ripgrep 15.2.0（`run --rg` 可换二进制）；测量日期 2026-09-13。

| 树规模 | 索引就绪 | 索引 RSS Δ | 索引查询 p50 | `rg` spawn p50 | 倍数 |
|---|---|---|---|---|---|
| 1,000 文件 / 10 命中 | 60.7–61.2 ms | 5 MB | 3.27–3.96 ms | 11.17–12.02 ms | 3.0–3.4× |
| 4,000 文件 / 40 命中 | 59.9–110.5 ms | 6 MB | 11.04–11.16 ms | 17.70–18.17 ms | 1.6× |
| 14,000 文件 / 140 命中 | 110.6–616 ms | 8 MB | 16.75–18.53 ms | 43.20–46.02 ms | 2.5–2.7× |

## 解读

- **重复检索**：常驻索引每轮都快于每次 spawn（1.6–3.4×；14k 文件为 2.5–2.7×），索引构建是一次性成本（千文件约 60ms，14k 约 110ms，偶发到数百毫秒）。
- **查询成本随命中数增长**：10 → 40 → 140 命中对应 p50 约 3.3 → 11.1 → 17.0 ms；主要成本是逐条回传与 `classifyDefinitions`，不只是树规模。因此「毫秒级」只在千文件量级成立，"single-digit ms" 不适用于 4k 文件以上。
- **内存**：索引增量 5–8 MB（1k → 14k 文件）。上游 fff 口径的「14k ≈ 26MB」与本机合成树口径不同（文件混合更大），不可直接比较，本仓未复核其来源。

## 未覆盖

- **宿主 RSS（长会话/多子代理）与端到端工具延迟**：需真实 dsh 会话（多子代理）打点，本机无法模拟；本文件的数字因此是端到端延迟的下界。
- **harness 打包的 ripgrep**：本机 profile 未安装 `@vscode/ripgrep-<platform>`，实测走系统 `rg`；真实大仓库的文件尺寸与目录深度分布也与合成树不同。
- **RSS 平台前提**：`run` 从 `/proc/self/status` 取 RSS，非 Linux 平台该项为 `null`。
