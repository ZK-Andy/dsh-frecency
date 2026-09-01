# dsh-frecency 技术设计文档

> 状态：设计（design）｜ 载体：本文件（知识层）｜ 关联：决策记录见 ADR
>
> 本文件回答"我们为什么做这个项目、改善了什么、怎么实现、选了哪些技术、权衡在哪"。属于设计级描述，代码细节留到实现阶段，由 `docs/` 其它文档与源码单一事实源承载。

## 1. 背景与动机

### 1.1 dsh 内置文件搜索的现状

DeepSeek Harness (dsh) 的 `grep` / `glob` 工具由 `@deepseek-ai/dsh-tool-fs-search` 提供，其实现是**每次工具调用 spawn 一个全新的 `@vscode/ripgrep` 进程**：

- 通过 `ctx.subprocess.spawn()` 启动 packaged 的 ripgrep 二进制，`await handle.done` 等它结束，再一次性收集 stdout（上限 `RAW_OUTPUT_MAX_BYTES = 20MB`）。
- 无进程内缓存 / 索引：每次调用都要重新读工作区、重读 `.gitignore`、重 stat 目录、重建状态。

这在"搜索一次就退出"的场景（终端里跑一次 `rg`）没问题；但在 AI agent 场景里，**问题在于重复搜索**：

- 一个会话里模型可能调用 grep/glob 数十次，每次都是全新 spawn、从零扫。
- 多个子代理（如三重审查里的 R1/R2/R3）并行时，各自动用 grep/glob，**每次检索的扫描成本 + 各把大块 stdout 堆进同一 Node 堆**，检索成本与上下文/内存随之累积。
- 这也呼应了本项目的起点：用户此前在别的工具上见过 grep 反复执行导致的内存问题，因而关心"dsh 上 grep 是否存在同样的性能与内存代价"。

### 1.2 fff 是什么

`fff`（[dmtrKovalenko/fff](https://github.com/dmtrKovalenko/fff)，Rust）是一个**文件搜索 SDK**，而不是一次性的 CLI。它的核心思想是把"扫描 + 索引"做成**一个长驻进程**：

- `FileFinder.create()` 一次，之后每次 `grep()` / `fileSearch()` 命中**热内存**（常驻索引），单次 sub-10ms。
- 被 opencode、nushell 等用作文件搜索库。

关键点：**fff 的提速来源是"用常驻内存换掉反复 spawn 的扫描成本"**。README 明确："fff fundamentally requires more memory than calling a single child process. That is the primary source of the speedup." 并在重复搜索工作负载下，总体内存反而**低于**反复 spawn ripgrep。

## 2. 目标与改善

### 2.1 目标

让 dsh 的 `grep` / `glob` 从"每次从零扫"变成"命中常驻索引"，并在结果上叠加 frecency 排序与语义标注。具体：

1. **常驻索引**：同一 cwd 下多次检索复用同一份索引，避免每次重新扫描。
2. **frecency 排序**：按访问/修改频率给结果排序——用户打开过的文件排在前面，而非每次冷扫描。
3. **定义优先提示**：`isDefinition` 标记，让模型优先看到定义行（如 `fn`/`struct`/`class`/`def` 开头）。
4. **git 状态感知**：结果带 modified / untracked / staged 标注，让模型优先触达正在改动的文件。
5. **覆盖内置 grep/glob**：让模型用**同一个工具名** `grep` / `glob` 就拿到常驻索引的提速，而不是另加一套新名字。

### 2.2 改善了什么

| 维度 | 内置行为 | dsh-frecency |
|---|---|---|
| 重复检索 | 每次 spawn 新进程、从零扫 | 命中常驻索引，热内存 |
| 单次延迟 | sub-ms 到数秒（取决于仓库大小 / spawn 开销） | 常驻后 sub-10ms |
| 结果排序 | ripgrep 按路径/修改顺序 | frecency（访问+修改频率）排序 |
| 定义识别 | 无 | 定义行优先标注 |
| git 状态 | 无内建标注 | modified/untracked/staged 标注 |
| 多子代理 | 各自从零扫 | 共享同一份常驻索引 |

### 2.3 不做什么（边界）

- **不替代 ripgrep 的"终端一次性搜索"**：单次 grep 且立刻退出，`rg` 仍是正确工具；dsh-frecency 的价值在**长会话内重复检索**。
- **不改变 dsh 的其它搜索/读取工具**：`read`/`write`/`edit` 保持内置；只增强 `grep`/`glob`。
- **不是全文搜索引擎**：与 Tantivy 等不同，fff 只针对单仓库、优化 sub-10ms，不落反向索引到磁盘。

## 3. 技术选择

### 3.1 引擎：`@ff-labs/fff-node`（Rust，原生绑定）

- **API**：`FileFinder.create({ basePath, frecencyDbPath?, enableContentIndexing? })` 创建常驻索引实例；`fileSearch()` / `glob()` / `grep()` / `directorySearch()` / `mixedSearch()` 检索；`destroy()` / `isDestroyed` / `waitForScan()` 管理生命周期。
- **frecency**：`frecencyDbPath`（SQLite frecency 库），结果带 frecency 打分（access/modification 两维）。
- **依赖**：`ffi-rs`（Node FFI）+ 各平台 `@ff-labs/fff-bin-*` 预编译二进制（darwin/linux/win32/android × x64/arm64，gnu/musl）。
- **零 pi 依赖**：`@ff-labs/fff-node` 的 `peerDependencies` 为空、`dependencies` 仅 `ffi-rs`，完全独立于 pi 的 ABI——因此可作为纯库被 dsh 插件直接调用。

### 3.2 为什么不选已有 `dsh-fff`（纯 JS）

已有 [sleepinginsummer/dsh-fff](https://www.npmjs.com/package/dsh-fff) 是 pi-fff 的 DSH 移植，但它：

- 用**纯 JS 子序列打分**（`fuzzyScore`），刻意不用 Rust native（"dynamic DSH plugins cannot require npm packages"——这是它选择的单文件自包含分发形态的取舍，非 DSH 硬限制）。
- **明确不做** `read`/`grep` 工具覆盖（"read/grep 工具覆盖不做"，承认内置工具行为不同，改用 `fff_grep` 等新名字）。

dsh-frecency 的差异化：**用 Rust 原生引擎 + 覆盖内置 grep/glob**。这不是对 `dsh-fff` 的否定，而是不同路线（它走零依赖纯 JS，我们走原生性能 + 覆盖内置）。

### 3.3 为什么不选 fff MCP server

fff 也提供 MCP server（`fff-mcp`），但那是**进程外**、经 MCP 协议往返。dsh-frecency 选择 **进程内 `ctx.tools.register()` 遮蔽**：更轻、无协议开销、检索直接命中本地索引；且能真正覆盖内置 `grep`/`glob` 工具名。

### 3.4 为什么不选其它全文索引引擎（Tantivy 等）

面向单仓库、sub-10ms、不落盘反向索引——fff 的定位匹配此场景；Tantivy 适合文档级检索打分（如数千文档），与本场景不同类。

## 4. 实现思路

### 4.1 插件形态

dsh 插件（`dsh.bundle` manifest + `cordis.patch.yml` 挂进 profile 层），走 `dsh plugin add`（npm bundle 形态）：

```
dsh-frecency/
├── package.json          # deps: @ff-labs/fff-node; dsh.bundle manifest
├── cordis.patch.yml      # 挂进 profile 层
└── src/
    ├── index.ts          # apply(): 建单例 FileFinder + register 遮蔽工具
    ├── finder.ts         # 常驻索引单例（同 cwd 复用，cwd 变化 destroy 重建）
    ├── grep.ts           # grep 工具实现（调 finder.grep()）
    ├── glob.ts           # glob 工具实现（调 finder.glob()/fileSearch()）
    └── presentation.ts   # SearchResultView 呈现（对齐内置 grep 卡片）
```

### 4.2 覆盖内置 grep/glob 的机制

DSH 工具注册表 `@deepseek-ai/dsh-tools` 是**分层作用域**：`register()` 的 JSDoc 明确"**Scoped tools shadow globals**"，且可见性合并是"**nearest scope 的同名条目遮蔽较远的**，global 层最远"（`inherited.set(name, definition)` 逐层覆盖，最后 scope 自己的 `visible.set()` 兜底）。

因此：**同名 `grep`/`glob` 在更近 scope 注册，会遮蔽（替换）内置的实现**。这正是"一切都插件"的体现——不需要专门的 provider seam，工具注册表本身就是可替换点（web 搜索用 `ctx.web.registerSearchProvider`，文件搜索走 `ctx.tools.register` 遮蔽，两条路都是 DSH 既有机制）。

### 4.3 生命周期

- **单例 + cwd 关联**：`apply()` 时对当前 cwd 创建 `FileFinder`（`FileFinder.create()` 拿 native DB 锁，"runs at most once per cwd"）；同 cwd 的后续检索直接复用。
- **cwd 变化**：`destroy()` 旧实例，重建新 cwd 的索引——避免多份索引同时驻留。
- **presentation**：自带 `SearchResultView`，对齐内置 grep 的卡片呈现（`presentGrepCall` / `presentResult`），避免遮蔽后显示成通用卡片。
- **降级**：`FileFinder.create()` 失败（如 native 二进制缺失/装不上）时，**回退到内置 ripgrep**，不静默失败。

### 4.4 原生依赖安装

`@ff-labs/fff-node` 依赖 `ffi-rs` + `@ff-labs/fff-bin-*`（native 构建）。dsh 插件的 npm bundle 形态支持原生依赖（dshmarket 已有 `allowBuilds` 先例）。实测 `ffi-rs` / `fff-bin-*` 均为纯预编译包、无 install 脚本，`allowBuilds` 实际非必需（判定程序见 `docs/cookbook.md`）。

## 5. 内存权衡

fff 常驻索引用内存换性能——要明确这个 trade-off 并在设计上可控：

- 14k 文件仓库约 26MB resident；100k 文件（如 Chromium）约几百 MB。
- 内容索引约 360 bytes/文件（100k repo 约 36MB），且二进制/超大文件/不可 grep 的会被跳过；可改用 memory-map 文件而非匿名 RAM。
- **关键**：在多子代理 / 长会话"大量重复搜索"下，**一份共享常驻索引的内存 < 反复 spawn + 各自攒 stdout 到 Node 堆**——这正是该项目要改善的累积问题。

设计上预留**可控性**（可配置开关/上限）：大仓库、低复用率场景可禁用（回退内置 ripgrep），避免为"搜索一两次"付出索引内存。

## 6. 风险与开放问题

1. **presentation 一致性**：遮蔽 grep 后要自带 `SearchResultView` 才与内置长得一样；否则显示成通用卡片（可解决，非阻断）。
2. **是否真降低多子代理内存**：索引分摊了"重复扫描"，但**不消除**子代理各自上下文/工具结果在 Node 堆的累积。设计文档不承诺消除该部分，只承诺降低重复检索成本。
3. **frecency 边界**：frecency 排序对"用户常打开的文件"最有效；冷文件/首次搜索的提升有限。

## 7. 验证计划

- **功能**：装载插件后，`grep` / `glob` 走 fff 索引；同 cwd 多次检索命中同索引；cwd 变化重建。
- **性能**：大仓库重复检索延迟对比（内置 spawn vs 常驻索引）。
- **内存**：长会话/多子代理场景下宿主 RSS 对比；单份索引内存实测。
- **降级**：native 二进制缺失时回退内置 ripgrep，行为不变。
- **门禁**：`verify-adr-format` / `verify-md-links` / `verify-doc-budgets` 全绿；行为级变更配回归/快照。

---
*载入文档后，实现阶段按此推进；设计决策的"为什么"在对应 ADR 中记录，本文件不复述。*
