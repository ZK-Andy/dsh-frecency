# 会话开场检查单（session-open）

> 每次会话恢复/开始时顺序执行；全部完成后向用户复述关键状态并等待命令。

1. **git 对账**：`git log --oneline -8 && git status`——HEAD 相对上次会话有无新提交，逐条查明。
2. **门禁基线**：`verify-adr-format` / `verify-md-links` 全绿（有 HANDOFF 时补 `verify-handoff-structure`）。
3. **测试基线**：`npm test` / 等价门禁全绿。
4. **声明会话模式**：按 [session-modes.md](session-modes.md) 与用户确认本轮类型与边界。
5. 向用户复述：关键状态、当前待办；随后等待命令。
