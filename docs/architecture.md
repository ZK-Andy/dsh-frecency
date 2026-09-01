# 架构

> 本文件承载实现层契约：模块划分、生命周期、与 DSH 宿主的集成点。设计动机与取舍见 `docs/design.md`，不复述。

## 模块划分

```
src/
├── index.ts          # 插件入口：name / inject / apply(ctx)
├── finder.ts         # 常驻 FileFinder 单例（同 cwd 复用，cwd 变化销毁重建）
├── grep.ts           # grep 工具定义（调 finder.grep()）
├── glob.ts           # glob 工具定义（调 finder.glob()）
└── presentation.ts   # 呈现层：复用内置呈现构造器
```

## 与 DSH 宿主的集成点

- **插件装载**：npm bundle 形态。`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，其 `insert` 行把插件挂进 profile 层栈；安装命令 `dsh plugin --profile <p> add dsh-frecency`（pnpm 转发到 profile 目录）。
- **工具注册**：入口声明 `inject: ['tools']`，`apply(ctx)` 中 `ctx.tools.register(defineTool(...))`（`@deepseek-ai/dsh-tools`）。注册表按层合并，**scoped 同名注册遮蔽 global 内置工具**（源码事实：`dsh-tools/lib/index.js` "Scoped registrations shadow globals"）；保留名 `run_code` 不可注册，`grep`/`glob` 不受影响。
- **工具契约**：`defineTool` 必须声明 `output { schema, render, presentationMeta? }`——缺 `render` 注册即抛 `TypeError`；object 输出 schema 必须带 `additionalProperties: true`。

## 呈现复用

内置 `@deepseek-ai/dsh-tool-fs-search` 导出 `presentGrepCall` / `presentGrepResult` / `formatGrepMatches` 等呈现构造器（card `search` render intent + `presentationMeta` 管线）。本插件直接 import 复用，保证遮蔽后 UI 卡片与内置呈现一致；该包声明为可选 peerDependency，缺失时退化为模型侧纯文本 render。

## 生命周期

- `apply()` 时对当前 cwd 创建 `FileFinder`（`FileFinder.create()` 拿 native 锁，同 cwd 至多一份）；后续检索复用。
- cwd 变化：销毁旧实例再重建，避免多份索引驻留。
- 插件卸载（disposer）时 `destroy()`，释放 native 资源与文件 watcher。

## 引擎 API 事实（实测，实现以此为准）

- `FileFinder.create()` / `grep()` 等返回 `Result` 包装，取 `.value`；失败分支在包装上，不抛异常。
- 内容索引异步构建：grep 前须 `await finder.waitForIndexReady(timeout)`；文件扫描另有 `waitForScan`。
- grep 结果元素自带 `lineNumber` / `col` / `matchRanges` / `lineContent` / `gitStatus` / frecency 分数；分页走 `nextCursor` / `cursor`。

## 降级路径

- **注册期**：`apply()` 先探测 `FileFinder.create()`（对 `process.cwd()`）；失败则不注册任何遮蔽工具，向日志输出一次显式 warn——内置 ripgrep 工具自然可见。失败不静默、不重试。
- **调用期**：引擎检索失败（`Result.ok === false`）以异常上抛，工具调用按 `isError` 呈现给模型；不注销已注册工具（瞬时错误与致命缺失区分对待）。
- **配置**：`enabled: false` 时同样不注册，行为等同未安装。
