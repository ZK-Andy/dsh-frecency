# Agent Note: host-supplied-packages-via-engines

Status: implemented

> 放置路径：`.agents/notes/implemented/architecture/2026-09-22-host-supplied-packages-via-engines.md`
> 记录插件运行期宿主包的声明方式；装载形态见 `2026-09-02-mount-via-per-agent-registration`，清单与产物判据见 `docs/testing.md`（实现 `tests/manifest.test.ts`）。

## Problem

插件的运行期依赖分两类：自带实现依赖（`@ff-labs/fff-node`、`picomatch`，随包安装）与宿主供包（`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-tool-fs-search`、`@deepseek-ai/dsh-output-retention`、`@deepseek-ai/schemastery`，由运行中的 dsh 安装提供）。这四条包此前按 `peerDependencies` 声明，范围钉在构建基线 `^0.1.2-alpha.3`。

该形态与 dsh 0.1.6 起的 profile 模块解析（0.1.7 的 `RuntimeResolution` / `RuntimeInterception`）不兼容：宿主包由安装层 `~/.dsh/profiles/node_modules` 供给，profile 的 pnpm 图里没有它们。按真实 profile 布局实测（宿主包只存在于上一级共享层、`autoInstallPeers: false`、pnpm 11.25.0），`dsh plugin add` 必然报 `unmet peer dependencies`——把宿主包版本换成满足范围的旧版照样报，告警来自"不在 pnpm 图里"这个结构事实，与版本无关。

范围本身在任何严格 semver 消费者下也不成立：`semver.satisfies('0.1.7-alpha.1', '^0.1.2-alpha.3')` 默认选项为 false（预发布版本被 `[major,minor,patch]` 元组锁定）。上游桌面应用校验插件图时正是这么判的（`apps/desktop/src/profile-packages.ts` 对共享宿主包直接 `satisfies(host.version, range)`，不匹配即抛错拒绝插件）。于是四条声明既不产生有效版本约束，又持续制造安装告警，并可能在严格校验的宿主上变成硬失败。

## Decision

宿主供包不出现在 `package.json` 的 `peerDependencies`，也不用任何机器可读版本字段声明：它们是运行中 dsh 安装的供给品，而 dsh 只发预发布版本——任何简洁范围都被 `[major,minor,patch]` 元组锁定（`^0.1.2-alpha.3` 与 `>=0.1.2-alpha.3 <0.2.0` 都不覆盖 0.1.7-alpha.1），能表达"任意 0.1.x 预发布"的写法不存在。

- 兼容窗口以散文写进 README（契约家）：构建与实测覆盖 DSH `0.1.2-alpha.3` 至 `0.1.7-alpha.1`。
- 四个宿主包保留在 `devDependencies`（0.1.2-alpha.3）：本地 typecheck/build/test 的构建钉，不代表运行期版本。
- 宿主包必须留在打包产物之外：清单的任何依赖字段都不再列出它们，tsdown 的默认外部化集合（dependencies + peerDependencies）也就不含它们，因此 `tsdown.config.ts` 显式 `deps: { neverBundle: [/^@deepseek-ai\//] }`。
- `tests/manifest.test.ts` 守清单与产物不变式，逐条判据见 `docs/testing.md`。
- 机制写 `docs/architecture.md`，用户契约写 README。

`@deepseek-ai/dsh-tool-fs-search` 是装载必需的宿主包（`grep.ts`/`glob.ts`/`presentation.ts` 顶层静态 import），缺失即装载失败，不存在纯文本呈现退化路径。

## Alternatives considered

- **枚举可满足的预发布范围**（`0.1.2-alpha.3 || >=0.1.5-alpha.1 <=0.1.5-rc.2 || …`，同类插件的做法）：严格 semver 下确实覆盖当前线，但元组锁定意味着每出一条新线都要补一段；补漏窗口里严格校验的宿主直接拒绝插件。落败——把"宿主给什么就用什么"的事实改写成一张需要追赶的版本表。
- **用 `engines.dsh` 范围作为单一声明**：`engines` 是 DSH 清单的公开字段（`DshEnginesManifest.dsh`），但元组锁定问题原样存在——没有能覆盖已实测 0.1.7-alpha.1 的简洁范围，写 `^0.1.2-alpha.3` 与被否的 peer 范围同病；且该字段目前无读取方，等于把同一句不成立的声明换个位置。落败。
- **保留普通 peer，只改文档承认告警**：`dsh plugin add` 每次安装刷 `unmet peer dependencies`；上游桌面校验在 0.1.7-alpha.1 上抛 `requires … found …`。落败——噪声与硬失败叠加。
- **peer + `peerDependenciesMeta.optional`**：实测能消掉 pnpm 告警（optional 的缺失 peer 不报），但上游桌面校验对共享宿主包先做 `satisfies`、再轮到 optional 分支，严格 semver 下仍抛错；且把装载必需的包标成 optional 与事实相反。落败。
- **移入 `dependencies`**：会随包安装第二份宿主实例（cordis / schemastery 需单例互操作），上游校验也显式禁止共享宿主包出现在 dependencies。落败。

## Consequences

- 收益：`dsh plugin add` 不再刷 unmet peer；严格 semver 宿主校验面对的范围错误被消除；没有会过期的机器声明——宿主换线不需要本包先发版，README 的兼容窗口只在本包实测过新线后改写。
- 代价：失去逐包版本约束，运行期错配（宿主 API 不兼容）只在装载或调用时以 import/调用错误暴露，安装期不再有提示。devDependencies 仍以 0.1.2-alpha.3 构建，与运行线 0.1.7-alpha.1 存在漂移——已入 HANDOFF 待办，随下次动 `src` 收口。
- 连带约束：宿主包不在清单的任何依赖字段里，打包器不会再自动外部化它们。`tsdown.config.ts` 的 `deps.neverBundle` 与 `tests/manifest.test.ts` 的产物断言共同兜住"宿主包不进产物"，否则插件会内联第二份宿主实例。
- 取舍：`@ff-labs/fff-node` / `picomatch` 是自带依赖，保持 `dependencies`；宿主包与自带依赖在清单里从此泾渭分明。

## Related

- ADR `mount-via-per-agent-registration`：装载形态（per-agent 注册），与本决策正交。
- ADR `adopt-fff-node-frecency-engine`：自带依赖选型，其中 `peerDependencies` 为空是引擎包自身的事实。
