# Agent Note: glob-serves-via-rg-parity

Status: implemented

> 放置路径：`.agents/notes/implemented/architecture/2026-09-02-glob-serves-via-rg-parity.md`
> 记录 glob 与内置工具的语义对齐决策（rg 平价模式 + 引擎降级）；装载形态见 `2026-09-02-mount-via-per-agent-registration`，rg 执行契约见 `docs/architecture.md` 与 cookbook。

## Problem

per-agent 遮蔽修通后的桌面复验暴露 glob 语义漂移：引擎 glob（`**/*.test.ts`）只返回 6 条，内置 glob 同 pattern 会返回上百条。根因是**候选集**不同——内置 glob 的契约是含 hidden 与 ignored 文件（仅排除 VCS 元数据目录），而 fff 常驻索引本身不收 gitignored 文件，引擎 `GlobOptions` 只有分页/线程参数、没有任何 ignore/hidden 开关。索引方案对 glob 的候选集缺口无解：模型依赖 glob 发现构建产物、依赖目录等被 gitignore 的文件，缺了就是行为回归。

## Decision

glob 工具执行改走 **rg 平价模式**：逐参数镜像内置 glob 的固定命令（`--no-config --files --glob=<pattern> --sort=modified --no-ignore --hidden` + VCS 六目录双排除 glob；`path` 参数选中的子树经 `-- <prefix>` 收窄遍历），二进制解析复用内置包的公开导出 `resolveRgPath()`（同一份 `@vscode/ripgrep` 打包二进制；PATH `rg` 兜底），流式读取、按抓取预算（2000 条）诚实截断。语义随之完全对齐：含 ignored/hidden、VCS 排除、修改时间排序（内置 `--sort=modified` 为旧→新）。工具描述与 `tool:glob` 系统提示词同步改为内置措辞（mtime 序、含 hidden/ignored）。rg 不可用或失败（spawn 错误、非 0/1 退出）时降级到常驻索引——保留旧语义可用性，不使调用失败。`scope.ts` 拆出纯路径判定的 `ScopeBase`，glob 的 rg 路径不创建引擎实例。

## Alternatives considered

- **引擎侧对齐（查 GlobOptions / InitOptions 放开 ignore）**：实测 `fff-api.d.ts` 全量 API，无任何 ignore/hidden 开关；watcher 文档同证（"Gitignored and other ignored files are never triggering watcher"）。落败——引擎方案对候选集缺口无解。
- **混合合并（引擎 frecency 序 + rg 补 ignored 文件）**：正确性可达，但每次 glob 仍要 spawn rg（引擎的 glob 提速收益归零，成本反叠加），且"frecency 序 + 尾部 mtime 补充"是内置没有的非标准排序、截断对账复杂。落败——复杂度买不到收益。
- **保持引擎 glob（只改文档声明差异）**：漂移是行为回归不是文档问题——gitignore 下的文件对模型不可发现。落败。

## Consequences

- 收益：glob 与内置逐参数同命令、同二进制，结果集可证一致（本仓 `**/*.test.ts`：引擎 6 vs rg 平价 196）；glob 不再依赖引擎可用性。
- 代价：glob 每次调用 spawn rg（与内置同成本，无回归也无收益——插件的提速价值集中在 grep 的常驻索引）；frecency 排序承诺从 glob 收窄到 grep（README/提示词已同步）。
- 取消/超时语义：glob 把 `exec.signal` 转发给 rg 进程（与内置 `runRipgrep` 同契约），调用者取消或工具超时时终止 rg 而非滞留孤儿进程；该场景不上抛降级、不做额外索引扫描。
- 无需处理：grep 无同类漂移——内置 grep 命令（`buildGrepCommand`）不带 `--no-ignore`/`--hidden`，默认尊重 gitignore，与引擎候选集一致。
- Deferred：引擎原生 glob 若将来提供 ignore 开关，可重评 rg 路线。

## Related

- ADR `mount-via-per-agent-registration`：Deferred 中的"glob ignored/hidden 语义对齐"由本决定收口。
