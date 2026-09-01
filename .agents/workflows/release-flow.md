# 发版流程（release-flow）

> tag 触发的全链路。dsh-frecency 为 npm 插件，发版走 npm publish + dshmarket 收录；踩坑沉淀于此。

1. **版本基线**：`package.json` version 单一来源 bump + `chore(release)` 提交。
2. **打 tag**：annotated `vX.Y.Z` 推送 origin。
3. **发版**：`npm publish`（带 `dsh.bundle` manifest），确认 dist-tag 正确（alpha/latest 语义与本插件定位一致）。凭据走全局 `~/.npmrc`（npm 账号 `openorbit`；本仓 `.gitignore` 已含 `.npmrc`，项目级凭据文件不入公开仓库）。
4. **dshmarket 收录**：确认 awesome-dsh-plugin 收录规则（插件须 `dsh plugin add` 可装、描述属实、分类正确），必要时提交 PR 进 curated list。
5. **收尾**：README 核对同步；HANDOFF 记录版本号、发布号；遗留项进待办。

## 已知坑位速查

- `minimumReleaseAge` 供应链策略核验**整份** profile 锁文件：其中任何一个发布未满约 24 小时的包都会让 `dsh plugin add`/`remove` 整体失败（dsh-market 上游 issue #39）。解法 = 市场强制更新同款参数，`dsh plugin add` 透传给 pnpm：`dsh plugin --profile <p> add --config.minimumReleaseAge=0 <pkg>`；或把过新版本写进 profile `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`（该文件已有先例条目）。
- `dsh.bundle` 声明 + `cordis.patch.yml` 必须随包发布，否则 `dsh plugin add` 装不进 bundle 层。
- 原生依赖发版前按 [cookbook](../../docs/cookbook.md) 的 `allowBuilds` 判定程序核实（`ffi-rs`/`fff-bin-*` 实测纯预编译，非必需）。
