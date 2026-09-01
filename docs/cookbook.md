# Cookbook（踩坑与操作手册）

> 本文件承载踩坑（gotcha）与操作程序（procedure）：跨会话需要复现的取证点、判据与步骤。决策"为什么"见 Agent Notes（ADR），实现契约见 `docs/architecture.md`，测试策略见 `docs/testing.md`，本文件不复述。

## 依赖与环境

- **native 依赖是否需要 `allowBuilds` 的判定程序**：查包内 `package.json` 的 `scripts` 字段有无 install 脚本。实测 `ffi-rs`（1.3.7）与 `@ff-labs/fff-bin-*` 均为纯预编译包、零 scripts——`allowBuilds` 非必需。将来换/升 native 依赖时按此判定，不凭包名推测。
- **本机 dsh 环境取证点**：dsh 为全局 npm 包（`~/.local/lib/node_modules/@deepseek-ai/dsh`）；profile 的 pnpm-workspace（`~/.dsh/profiles/<p>/pnpm-workspace.yaml`）已有 `allowBuilds` 先例（koffi/node-pty/@google/genai）；内置工具的源码契约可直接读本地 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tools/lib/index.js`。

## 构建链

- **tsdown 产物名**：默认输出 `.mjs`，与 `package.json` `main` 指向的 `dist/index.js` 不符——经 `outExtensions` 对齐。调整构建配置时先核对产物名与入口一致。

## 测试

- **mock 时序坑**：测试假实例在工具 execute 时才创建，测试须用模块级 defaults 动态读取，不能在 import 时捕获；`beforeEach` 清 finder 实例池时必须同时 `releaseFinders()`，否则用例间串味。

## 本地开发与 e2e

- 内置 glob 的执行契约（`@deepseek-ai/dsh-tool-fs-search/lib/index.js` 的 `buildGlobCommand` + spawn seam）：`rg --no-config --files --glob=<pattern> --sort=modified --no-ignore --hidden` + 6 个 VCS 目录（.git/.svn/.hg/.bzr/.jj/.sl）各两条排除 glob，`-- <path>` 指根；二进制 = `@vscode/ripgrep` 打包二进制（非 PATH）；exit 1 = 零结果（非失败）；`--no-config` 防宿主 `RIPGREP_CONFIG_PATH` 预处理器注入。`--sort=modified` 为旧→新升序。
- 本地开发用 `--patch` 绝对路径覆盖层 + 本地 `node_modules` 软链（裸导入解析）；正式 `dsh plugin add` 不受影响。
- e2e 一律用默认 headless profile，勿新造 profile——`dsh-code-runtime-worker` 不在 npm，新 profile 拉不到依赖。

## 验证与取证

- **遮蔽是否生效的判别**：会话内 grep 一个已知词，比对该词的 rg 计数（尊重 gitignore）与引擎返回项数——两者语义不同（rg 按行、引擎按匹配出现），计数一致即内置在服务；另外 `grep fff /proc/<pid>/maps` 会撞地址 hex 伪匹配（如 `[vsyscall]`），须按路径字段 awk 过滤，`libfff_c.so` 仅在 `FileFinder.create()` 时映射、import 不映射，可据此判定 apply 是否执行。
- **真宿主**：`node dsh --profile <p>` 进程才是 harness（`~/.dsh/logs/run-marker.json` 的 pid 是桌面壳）；落盘日志 `~/.dsh/logs/host.log`。插件级 logger.info 不进 host.log（级别门控 + 该文件只承载桌面壳通道）——本插件的装载/检索证据写 `~/.dsh/logs/dsh-frecency.log`。
- **预设组合的作用域事实**：同一 `agent.cordis.yml` 的所有行共享一个 scope，同名工具两行并存即 `tool "grep" is already registered in this scope`——跨行遮蔽不存在，同名替换必须整行进行；跨平面遮蔽由 agent own 层实现（per-agent 注册，见 ADR `mount-via-per-agent-registration`）。
- **per-agent 注册的程序与坑**：配方 = `ctx.on("agent/created")` + `agent.ctx.inject(["tools","systemPrompt"], register)` + `agent/disposed` dispose fiber（第一方先例 `dsh-tool-subagent`）；`agents` 服务**不可**声明进 `inject`——boot 会阻塞等待该服务，headless 组合不提供，Entry 永挂。headless 单任务模式做验证载体需模型环境变量（如 `COMMANDCODE_API_KEY_*`），缺失时 boot 后静默挂起。

## 流程先例（dotnet 项目）

> 指向 `/mnt/work/dotnet-deepseek-harness-desktop/`（本仓 AI 协作骨架与 HANDOFF 治理的参照源）。

- **三重审核角色原始定义**在其 ADR `.agents/notes/implemented/process/2026-08-31-review-scope-narrowing.md`。上游 devops-template 无 `workflows/` 目录——适配浓缩走样时回查上游原文。
- **流程缺口固化先例**：dotnet 项目无机械钩子，解法 = 强制规则内联 AGENTS.md + 发现缺口即固化；本仓的会话开场钩子与三审缺口固化均循此先例。
