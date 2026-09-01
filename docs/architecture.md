# 架构

> 本文件承载实现层契约：模块划分、生命周期、与 DSH 宿主的集成点。设计动机与取舍见 `docs/design.md`，不复述。

## 模块划分

```
src/
├── index.ts          # 插件入口：name / inject / apply(ctx)
├── finder.ts         # 常驻 FileFinder 槽位（workspace 常驻 + ephemeral，串行化获取）
├── scope.ts          # 搜索作用域绑定（path 参数内/外判定、显示路径转换）
├── mapping.ts        # fff 结果 → 内置形状映射 + include/path 过滤
├── grep.ts           # grep 工具定义（分页取全，调 finder.grep()）
├── glob.ts           # glob 工具定义（分页取全，调 finder.glob()）
└── presentation.ts   # 呈现层：复用内置呈现构造器
```

## 与 DSH 宿主的集成点

- **双平面装载（per-agent 注册）**：npm bundle 形态经 `dsh plugin add` 进入 profile bundle 层栈（host 平面），但 host 平面的同名注册对会话不可达——内置 `grep`/`glob` 由 agent 预设挂载于 agent 平面（更近）。插件 `apply()` 监听 `agent/created`，经 `agent.ctx.inject(["tools", "systemPrompt"], ...)` 把工具注册进**每个 agent 自己的层**（own 层赢过一切继承层，任何预设下都成立），`agent/disposed` 时回收安装 fiber；注册期探测失败则不安装、显式 warn 回退内置。`agents` 注册表不进 `inject`——声明后 boot 会阻塞等待该服务，headless 组合不提供（实测）。
- **工具注册**：入口声明 `inject: ['tools', 'systemPrompt']`，`apply(ctx)` 中 `ctx.tools.register(defineTool(...))`（`@deepseek-ai/dsh-tools`）。注册表按层合并，**nearest scope 的同名条目遮蔽较远者**；保留名 `run_code` 不可注册，`grep`/`glob` 不受影响。
- **工具契约**：`defineTool` 必须声明 `output { schema, render, presentationMeta? }`——缺 `render` 注册即抛 `TypeError`；object 输出 schema 必须带 `additionalProperties: true`。

## 呈现复用

内置 `@deepseek-ai/dsh-tool-fs-search` 导出 `presentGrepCall` / `presentGrepResult` / `formatGrepMatches` 等呈现构造器（card `search` render intent + `presentationMeta` 管线）。本插件直接 import 复用，保证遮蔽后 UI 卡片与内置呈现一致；该包声明为可选 peerDependency，缺失时退化为模型侧纯文本 render。

## 生命周期

- `apply()` 时对当前 cwd 创建 `FileFinder`（注册期探测），后续检索复用 workspace 槽位。
- `path` 参数在 workspace 内：复用 workspace 槽位 + prefix 过滤；在 workspace 外：使用独立的 ephemeral 槽位（至多一份、替换式、结果转绝对路径），不驱逐 workspace 槽位。
- 槽位获取经 per-slot 串行化：并发调用共享在途创建，不产生泄漏实例或双重销毁。
- cwd 变化：销毁旧实例再重建，避免多份索引驻留。
- 插件卸载（`ctx.effect` disposer）时 `releaseFinders()`，释放 native 资源与文件 watcher。

## 引擎 API 事实（实测，实现以此为准）

- `FileFinder.create()` / `grep()` 等返回 `Result` 包装，取 `.value`；失败分支在包装上，不抛异常。
- 内容索引异步构建：grep 前须 `await finder.waitForIndexReady(timeout)`；文件扫描另有 `waitForScan`。
- grep 结果元素自带 `lineNumber` / `col` / `matchRanges` / `lineContent` / `gitStatus` / frecency 分数；grep 分页走 `nextCursor` / `cursor` 游标，glob 分页走 `pageIndex` + `totalMatched` 穷尽判定——工具层均取至穷尽（有界 4 页）。

## 降级路径

- **注册期**：`apply()` 先探测 `FileFinder.create()`（对 `process.cwd()`）；失败则不注册任何遮蔽工具，向日志输出一次显式 warn——内置 ripgrep 工具自然可见。失败不静默、不重试。
- **调用期**：引擎检索失败（`Result.ok === false`）以异常上抛，工具调用按 `isError` 呈现给模型；不注销已注册工具（瞬时错误与致命缺失区分对待）。
- **配置**：`enabled: false` 时同样不注册，行为等同未安装。
