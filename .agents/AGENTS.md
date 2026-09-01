# AGENTS.md — .agents/（AI 协作层）

本子树的专属规则：**AI 协作机制本身**（技能、ADR、模板）。不重复根文件内容。

## 技能

- `.agents/skills/` 由 DSH 自动发现（skill 工具按需加载），无需注册。
- 本项目技能为**上游 deepseek-harness 原版**（MIT），放置即被 DSH 在 rank 200 拾取。技能格式由 `scripts/verify-skill-format.py`（如引入）强制。
- 用不上的技能不写（避免预铺空目录、避免上游断链踩坑）。

## ADR（Agent Notes）

- 路径：`.agents/notes/<lifecycle>/<class>/yyyy-mm-dd-<topic>.md`。
- class 封闭集合：`feature` / `bug-fix` / `simplification` / `architecture` / `process` / `testing`。
- 状态即目录：`proposed` → `implemented`（改 Status + 移目录）→ `archived`（冻结，只插 `Archived:` 行）；另有 `rejected`。
- 文件名 = `yyyy-mm-dd-<kebab-slug>.md`，命名格式由 `scripts/verify-adr-format.py` 机器强制（违约即 FAIL）。
- implemented 笔记用现在时，**禁止** `## Proposal`/`## Plan`/`## Acceptance criteria`；强制 `## Alternatives considered`。
- 正文中文单语（双语镜像暂不启用，README/docs 层如启用再配对）。

## Cookbook（踩坑记录）

- 实现阶段踩坑与调试判别经验的单一事实源在 `docs/cookbook.md`（第二步建）：每条带阶段标签（`[脚本]/[打包]/[调试]/[环境]/[上游]/[产品]` 封闭集），格式由 `scripts/verify-cookbook.py`（如引入）强制，新增条目必须带标签与日期。

## 出处声明（MIT）

- 本 `.agents/skills/` 11 技能：© deepseek-ai，MIT License，来自 `deepseek-ai/deepseek-harness`（https://github.com/deepseek-ai/deepseek-harness）。经 `/mnt/work/devops-template`（MIT）搬运，**原样逐字节一致**，未被修改。
- `.agents/notes` 骨架、`templates/`：来自 devops-template / deepseek-harness，MIT。搬运保留出处。
