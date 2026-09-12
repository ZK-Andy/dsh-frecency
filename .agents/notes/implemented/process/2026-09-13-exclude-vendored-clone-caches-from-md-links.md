# Agent Note: exclude-vendored-clone-caches-from-md-links

Status: implemented

> 放置路径：`.agents/notes/implemented/process/2026-09-13-exclude-vendored-clone-caches-from-md-links.md`
> 本笔记记录 md-links 门禁的扫描范围口径，以及工具缓存性质的嵌套克隆仓在其中的位置。

## Problem

`scripts/verify-md-links.py` 用 `Path.rglob("*.md")` 遍历工作树，只按路径片段排除 `node_modules`、`.pnpm` 与 `skills`。工作区根下的 `.noogenesis/genes-cache/` 是 Noogenesis 心源仓的嵌套克隆（自带 `.git`），其内部 Markdown 的链接指向该仓自己的未跟踪草稿——例如 `.agents/notes/archived/process/2026-09-11-absorption-stage.md` 引用的同目录笔记在本仓不存在——于是门禁报出 4 条与本仓内容无关的 FAIL，把基线染红。该目录既未跟踪也不在 `.gitignore`，`git add .` 会把它整体提交进本仓。

## Decision

工具缓存性质的嵌套克隆仓既不在本仓内容面，也不进本仓门禁：

- `.gitignore` 的「工具缓存」段加入 `/.noogenesis/`，与 `/.cache/`、`/.codegraph/`、`.zcode/` 同段并列。
- `verify-md-links.py` 的排除表加入 `.noogenesis`，与 `node_modules`、`.pnpm` 同一判据（按路径片段匹配）；扫描范围仍是「工作树内全部 Markdown 减去排除项」。
- 两处排除项在脚本文档头写明，使排除集合与 `.gitignore` 的工具缓存段可互相印证。

## Alternatives considered

- **门禁改扫 `git ls-files`，只查已跟踪文件**：判据上更贴近「本仓内容才算数」，且自动免疫一切未跟踪目录。落败原因：根 `HANDOFF.md`、`HANDOFF-todos.md` 与 `.plan/` 按设计未跟踪，却正是本仓治理文档；改判据后这些文件的相对链接与锚点不再受检——用一处漏检换一处误报，不划算。链接是否有效与该文件的 git 跟踪状态无关。
- **按「祖先目录含 `.git`」通用识别嵌套克隆**：能一并覆盖未来其它 vendored clone，且不写死目录名。落败原因：需为每个候选路径向上探测 `.git`，判据比一行路径片段匹配复杂，而当前实际只有一个此类目录；待第二个嵌套克隆出现再升级。
- **引入 `.md-links-ignore` 之类的配置文件**：可扩展性最好，新增目录无需改脚本。落败原因：为一个目录引入新配置格式与加载逻辑，与门禁脚本现有的内联排除表不成比例。

## Consequences

- 收益：门禁结论恒等于本仓内容面；`.noogenesis/` 不会被误提交；本机与 CI 跑同一脚本得到同一口径。
- 代价：`scripts/verify-md-links.py` 与 devops-template 源本产生一次漂移（多一个排除项），同步模板时需保留该行。
- 已知缺口：`.noogenesis/` 内的 Markdown 从此不在本仓任何门禁视野内，其有效性由 Noogenesis 仓自己的门禁负责。
