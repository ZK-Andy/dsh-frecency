# 测试

> 本文件承载测试策略与执行方式。验证目标（测什么、为什么）见 `docs/design.md` §7，不复述。

## 层级

1. **单元（vitest）**：纯函数——fff 结果到工具输出的映射、参数 schema 映射、降级判定、Result 解包。native 引擎不进单元测试，一律 mock。
2. **集成（真实引擎）**：对本仓库工作区实测 `FileFinder` 往返（create → waitForScan/waitForIndexReady → grep/glob → destroy），断言命中与字段完整性；skip 条件：`@ff-labs/fff-bin-*` 平台包缺失。
3. **e2e（真实 harness）**：默认 headless profile + `--patch` 覆盖层指向 `./dist/index.js` 跑真实任务，验证同名 `grep`/`glob` 走常驻索引、遮蔽生效、降级路径行为。注意：`--patch` 绝对路径插件的裸导入需要本地 `node_modules` 软链；正式 `dsh plugin add` 不受影响。

## 性能与内存基线

大仓库重复检索延迟（内置 spawn vs 常驻索引）、长会话/多子代理宿主 RSS、单份索引常驻内存——按 `docs/design.md` §7 的对比口径执行，结果记入当次会话 journal，达标后固化为本目录下的基线文档。

## 命令

```sh
pnpm check        # typecheck + build + test（本地与 CI 同口径）
```

## 门禁

```sh
python3 scripts/verify-adr-format.py
python3 scripts/verify-doc-budgets.py --manifest scripts/doc-budgets.manifest.json
python3 scripts/verify-md-links.py
```

行为级变更必须配套回归/快照（feature-flow 步骤 3）；git hooks（`scripts/setup-hooks.sh`）在 pre-commit/pre-push 做增量快检，CI 拥有穷尽矩阵。
