# 功能开发流程（feature-flow）

> 非平凡功能/变更的主链路；琐碎修改走简化路径。

1. **定案**：方案讨论收敛 → 写 ADR；Alternatives 强制。同会话内即落地的，proposed→implemented 可折叠——直接以 implemented 格式落档（格式由 `scripts/verify-adr-format.py` 把关）。
2. **实现**：按 ADR 范围动代码；越界想法记 TODO 不顺手做。
3. **测试**：行为级变更必须配套回归/快照；`scripts/**` 变更跑其自带自测。
4. **门禁**：`scripts/verify-adr-format.py` + `verify-md-links.py` + build 全绿。
5. **评审（三重审核执行契约）**：**触发**——触碰行为契约面（src/tests 之外的契约口径：README/docs/manifest/CI/hooks）/ 涉及 async·生命周期·事件序·取消·异常·并发 / 改跨包契约（peerDependencies、工具 schema、输出形状）/ 改发版链路 / 用户指定批量事后审核，才重三审。**纯结构重构（零行为变更：无新副作用、无签名/语义变化，测试+门禁绿可证）走轻审——R2 代码面单路即可，R1/R3 免**；判据模棱两可宁可重三审。契约：
   - **三角色**：R1（[dsh-find-simplifications](../skills/dsh-find-simplifications/SKILL.md)，简化/语义面）、R2（[dsh-code-review](../skills/dsh-code-review/SKILL.md)，代码正确性/异常边界/编排序）、R3（[dsh-archive-agent-notes](../skills/dsh-archive-agent-notes/SKILL.md)，ADR 状态/口径/README 漂移面）。
   - **范围 = 单元 diff + 面收窄**：一次只审一个逻辑单元，评审代理拿精确 `git diff <base>..<head>`（`scripts/change-scope.sh` 界定）；只读 diff 触及的文件 + 一层以内的直接依赖/被依赖件，不开局读全仓。
   - **父级预消化简报**：每代理一份紧凑清单（改动面、模式、风险点、3–5 条定向检查项 + 指定文件/行），**给材料与检查项，不给结论倾向**；审核代理独立判读，精读额度用完即停，未闭环点以「需父代理定向核」交回，不伪造行号证据。
   - **有界并行（上限两路）**：三路最多两路并发，组合不固定（主会话按工作量定）；**禁止三路同时并行**——R3 的 ADR 面结论可能因 R1/R2 代码面修复而失效，R3 后置等 R1/R2 收口（R3 的独立面可先行）。每代理默认上限：工具调用 ≤12、单次 diff 视野 ≤200 行、轮次 ≤2，到限未收口即中断，返回已有部分结论。
   - **确定性报告契约**：每代理返回 `Blocker[]`/`Suggestion[]`，每条 `文件:行 + 一句证据`；空即「无发现」。主会话逐条采纳/拒绝（附证据），跨路冲突由主会话合并，修复一次性收口为单个 `refactor(review)` 提交。
   - **行为保持的第一证据 = 测试 + 门禁已兜底行为**，评审只补测试/门禁盖不住的语义/文档面。
   - **本项目规则显式补审**：技能为通用清单，不含本仓规则——评审代理按根 `AGENTS.md` + 本文件 + `docs/`（architecture/testing 口径）核对；不得引用本仓不存在的上游文档路径。
6. **提交**：逻辑单元分粒度提交，conventional commits 格式。
7. **收尾**：按 [session-close](session-close.md) 检查单过一遍本批次相关项。**done = 通过全部验证**：ADR（需要时）→ 门禁 → 测试 → 评审（需要时）→ CI 全绿。
