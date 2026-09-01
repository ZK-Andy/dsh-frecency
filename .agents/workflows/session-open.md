# 会话开场检查单（session-open）

> 每次会话恢复/开始时顺序执行；全部完成后向用户复述关键状态并等待命令。

1. **读 HANDOFF 家庭**——读 `HANDOFF.md`「**状态区**」（背景/位置/当前状态/待办/开始步骤）+「**交接更新记录**」摘要滚动窗；**待办明细读 `HANDOFF-todos.md`**；如需近期过程细节，读 `.plan/journal/2026-09-session-journal.md`。
2. **git 对账**：`git log --oneline -8 && git status`——HEAD 若比 HANDOFF 最新记录**多出提交**：逐条查明内容再继续。
3. **门禁基线**：verify-adr-format / verify-handoff-structure / verify-doc-budgets / verify-md-links 全绿。
4. **测试基线**：`pnpm check`（typecheck + build + test）全绿。
5. **声明会话模式**：按 [session-modes.md](session-modes.md) 与用户确认本轮类型与边界。
6. 向用户复述：关键状态、当前待办、相关踩坑判别；然后等待命令。
