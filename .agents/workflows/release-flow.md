# 发版流程（release-flow）

> tag 触发的全链路。dsh-frecency 为 npm 插件，发版走 npm publish + dshmarket 收录；踩坑沉淀于此。

1. **版本基线**：`package.json` version 单一来源 bump + `chore(release)` 提交。
2. **打 tag**：annotated `vX.Y.Z` 推送 origin。
3. **发版**：`npm publish`（带 `dsh.bundle` manifest），确认 dist-tag 正确（alpha/latest 语义与本插件定位一致）。
4. **dshmarket 收录**：确认 awesome-dsh-plugin 收录规则（插件须 `dsh plugin add` 可装、描述属实、分类正确），必要时提交 PR 进 curated list。
5. **收尾**：README 核对同步；HANDOFF 记录版本号、发布号；遗留项进待办。

## 已知坑位速查

- pnpm `minimumReleaseAge` 会把过新版本从 `@latest` 解析排除——重试或钉版本。
- `dsh.bundle` 声明 + `cordis.patch.yml` 必须随包发布，否则 `dsh plugin add` 装不进 bundle 层。
- 原生依赖（如 `ffi-rs`）需 `allowBuilds` 放行，否则装不成功——发版前验证。
