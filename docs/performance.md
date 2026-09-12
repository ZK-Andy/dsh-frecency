# 性能与内存基线

> 本文件是 `docs/design.md` §7「性能/内存」验证项的实测基线。测量工具 = `scripts/bench-resident-index.mjs`；口径见下，未覆盖项单列。

## 口径

两臂同树、同 pattern，各预热一次页缓存后测 20 次，取 p50（下表为 3 轮的极值区间）：

- **常驻索引臂**：插件实际调用的引擎 API——`FileFinder.create({basePath})` → `waitForScan` → `waitForIndexReady`，随后按 `src/grep.ts` 的 `GrepOptions`（`mode:regex`、`pageSize:500`、`cursor` 分页、`classifyDefinitions:true`）查询，进程常驻。
- **内置机制臂**：每次调用 spawn 一个 `rg`，argv 与内置工具 `buildGrepCommand` 相同（`--no-config --json --regexp=<pattern> -- <tree>`）。

两臂都是**机制级**：不含插件的 mapping、prefix/include 过滤与卡片呈现，也不含 harness 的结果 schema 校验与渲染。端到端工具延迟必然高于下表。

## 复现

```sh
node scripts/bench-resident-index.mjs gen .plan/bench/tree --files 14000
node scripts/bench-resident-index.mjs run .plan/bench/tree --iterations 20
```

合成树：每目录 100 个文件、每文件约 4KB、每 100 个文件 1 个含标记词 `benchmarkmarker`（14k 文件 = 55MB / 140 命中）。

## 实测

2026-09-13，node v26.8.1，系统 ripgrep 15.2.0，3 轮 × 20 次：

| 树规模 | 索引就绪 | 索引 RSS Δ | 索引查询 p50 | `rg` spawn p50 | 倍数 |
|---|---|---|---|---|---|
| 1,000 文件 / 10 命中 | 59–75 ms | 5 MB | 3.89–4.40 ms | 11.14–11.93 ms | 2.6–3.1× |
| 4,000 文件 / 40 命中 | 61–66 ms | 6 MB | 13.42–14.09 ms | 19.91–25.01 ms | 1.5–1.8× |
| 14,000 文件 / 140 命中 | 111–112 ms | 8 MB | 17.69–18.77 ms | 45.87–48.71 ms | 2.4–2.8× |

## 解读

- **重复检索**：常驻索引稳定快于每次 spawn（1.5–3.1×），索引构建是一次性成本（千文件约 60ms，14k 约 110ms）。
- **查询成本随命中数增长**：10 → 40 → 140 命中对应 p50 约 4 → 14 → 18 ms；主要成本是逐条回传与 `classifyDefinitions`，不只是树规模。因此「毫秒级」只在千文件量级成立，对外声明按此收敛（见 README 双语）。
- **内存**：索引增量 5–8 MB（1k → 14k 文件），低于上游 fff 口径的「14k ≈ 26MB」；后者应是更大的文件混合，本仓未复核。

## 未覆盖

- **宿主 RSS（长会话/多子代理）与端到端工具延迟**：需真实 dsh 会话（多子代理）打点，本机无法模拟。
- **harness 打包的 ripgrep**：本机 profile 未安装 `@vscode/ripgrep-<platform>`，内置臂用的是系统 `rg`；真实大仓库的文件尺寸与目录深度分布也与合成树不同。
