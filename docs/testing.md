# 测试

> 本文件承载测试策略与执行方式。验证目标（测什么、为什么）见 `docs/design.md` §7，不复述。

## 层级

1. **单元（vitest）**：纯函数——fff 结果到工具输出的映射、参数 schema 映射、降级判定、Result 解包；含 grep 输出 `isDefinition`/`gitStatus` 透传与 `classifyDefinitions` 开关断言。native 引擎不进单元测试，一律 mock。
2. **集成（真实引擎 / 真实 rg）**：对本仓库工作区实测 `FileFinder` 往返（create → waitForScan/waitForIndexReady → grep/glob → destroy），断言命中与字段完整性；skip 条件：`@ff-labs/fff-bin-*` 平台包缺失。rg 平价同层：对临时目录实测 `runRgFiles`（ignored/hidden 收录、VCS 排除、mtime 序、预算截断），断言与内置 glob 语义一致；skip 条件：rg 二进制不可用（`resolveRgPath` 回落 PATH `rg` 仍不可执行时）。
3. **e2e（真实 harness）**：默认 headless profile + `--patch` 覆盖层指向 `./dist/index.js` 跑真实任务，验证同名 `grep`/`glob` 走常驻索引、遮蔽生效、降级路径行为。本地 `--patch` 开发的操作细节（软链、profile 选择）见 `docs/cookbook.md`。
4. **清单不变式（vitest）**：`tests/manifest.test.ts` 断言发布契约——无 `peerDependencies`、`engines.dsh` 在场、源码运行期 `@deepseek-ai/*` 导入集与宿主包清单一致、宿主包不进 `dependencies`、每个宿主包都有 devDependency 构建钉。判据来源见 ADR `host-supplied-packages-via-engines`。

## 性能与内存基线

复现命令与实测见 [performance.md](performance.md)，工具 = `scripts/bench-resident-index.mjs`（`gen` 合成树 + `run` 两臂对比）。宿主 RSS（长会话/多子代理）与端到端工具延迟需真实 harness 会话，尚未测；新测量结果记入当次会话 journal 并同步该基线文档。

## 命令

```sh
pnpm check        # typecheck + build + test（本地与 CI 同口径）
```

## 门禁

```sh
python3 scripts/verify-adr-format.py
python3 scripts/verify-handoff-structure.py
python3 scripts/verify-doc-budgets.py --manifest scripts/doc-budgets.manifest.json
python3 scripts/verify-md-links.py
```

行为级变更必须配套回归/快照（feature-flow 步骤 3）；git hooks（`scripts/setup-hooks.sh`）在 pre-commit/pre-push 做增量快检，CI 拥有穷尽矩阵。`verify-handoff-structure.py` 守的是本机 HANDOFF 家庭（该家庭不入提交）：CI 检出里没有这些文件、脚本空过，故 CI 的 Doc gates 步骤只跑其余三道。门禁脚本自身判据的回归由 `--self-test` 夹具承担（`verify-adr-format.py` / `verify-handoff-structure.py` / `verify-md-links.py`）。
