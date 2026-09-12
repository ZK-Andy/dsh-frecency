# Agent Note: release-notes-ref-source

Status: implemented

> 放置路径：`.agents/notes/implemented/process/2026-09-13-release-notes-ref-source.md`
> 本笔记记录 Release 正文的发布 ref 取自何处，以及同一提交挂多个 tag 时的取舍。

## Problem

`scripts/release-notes.sh` 的标题与 Changelog 链接都取 `$TO_REF`，而 `.github/workflows/release.yml` 调用时不传 ref，脚本落到默认的 `HEAD`：两个已发布页面（v0.1.1 / v0.1.2）因此以「Release HEAD」开头，Changelog 链接写成 `compare/…...HEAD`，指向一个随仓库前进而漂移的范围。修这个缺陷时又暴露第二个决定：同一提交挂多个 tag 时，`git describe --tags --exact-match` 只按提交找 tag 并任取其一（实测同提交补挂 `v0.3.0` 后，以 `v0.1.2` 为发布 tag 的正文标题变成 `v0.3.0`），而 workflow 递进来的 `$GITHUB_REF_NAME` 才是权威输入。

## Decision

标题与 Changelog 链接共用**同一个发布 ref**，取值顺序：

1. ref 本身就是 tag 名（`git show-ref --verify refs/tags/<ref>` 命中）→ 直接采用该名；CI 与显式调用走这条，多 tag 也不会被改写。
2. 否则（`HEAD`、sha、分支等非 tag ref）→ 回落 `git describe --tags --exact-match <ref>`。
3. describe 也不命中 → 用 ref 文本。

workflow 以 `bash scripts/release-notes.sh "" "$GITHUB_REF_NAME"` 调用（空串占位让 from_ref 自动推导出前一个 tag）。两个已发布页面按同一脚本重新生成并回填；核验 = 对每个 tag 重放 `bash scripts/release-notes.sh "" <tag>` 并与 `gh release view <tag> --json body --jq .body` 比对（差异允许 GitHub API 追加的尾部空行）。

## Alternatives considered

- **维持现状（只取 ref、不解析）**：改动最小，但页面继续以 HEAD 命名与链接，且每发一版都会重现——缺陷在发布动作里，不只是某次脚本调用。
- **只信 workflow 递进来的 `$GITHUB_REF_NAME`，删掉本地回落**：CI 面干净，但脚本文档化的 `[from_ref] [to_ref]` 用法与 `HEAD~10 HEAD` 这类本地范围调用会失去标题能力。
- **无条件用 `describe --exact-match` 的结果**：对 HEAD 类 ref 友好，但同提交多 tag 时会覆盖权威发布 tag（首个实现即如此，返修实证）；标题、链接与真正发布的 tag 三者不一致，比「标题是 HEAD」更难发现。
- **删掉正文 H1，只留 GitHub Release 标题**：可连带删掉整段解析逻辑；但该脚本输出同时是可重定向的笔记文件（`release-notes.sh > notes.md`），H1 是它作为文件的标题，删掉会让文件失去自述性。

## Consequences

- 收益：Release 页面以发布 tag 自述（标题与链接同源），链接指向不再漂移的 compare 范围；多 tag 场景下标题不会被 `describe` 的任取覆盖。
- 代价：判定依赖 git，**不在离线 `--self-test` 覆盖面内**（自测只覆盖 `type_bucket` / `render_bucket`），核验靠上面的重放命令；脚本因而比纯文本变换多一层 git 依赖。
- 已知缺口：`$TO_REF` 为空串时语义仍是「落 HEAD」（`${2:-HEAD}`），空串占位只用于顶出第二个位置参数；若要支持「显式指定发布 ref 且自动推导范围」，需补 `--to <ref>` 之类的显式接口。
