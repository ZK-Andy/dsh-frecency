# dsh-frecency

[English](./README.md) | 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：用**常驻索引 + frecency 排序**的文件搜索替换内置 `grep` / `glob` 工具。

内置工具每次调用都 spawn 一个全新的 ripgrep 进程、从零扫描；长会话与多子代理场景下同样的搜索会重复执行数十次。dsh-frecency 为每个工作目录保留一份常驻索引（Rust [fff](https://github.com/dmtrKovalenko/fff) 引擎，经 `@ff-labs/fff-node`），重复检索毫秒级命中热内存，结果按访问/修改 frecency 排序。

## 安装

```sh
dsh plugin --profile <profile> add dsh-frecency
```

重启 dsh 并开一个会话即可——`grep` / `glob` 工具名与参数不变，但已切到常驻索引，且**无论你用哪个 agent 预设都生效**。内置搜索工具由 agent 预设挂载在会话近端（agent 平面），host 平面注册赢不了它，所以插件在**每个 agent 创建时把工具注册进 agent 自己的层**（第一方先例：`dsh-tool-subagent`）。配置 `enabled: false` 或卸载插件即回退内置 ripgrep 工具。

## 你得到什么

- **同名工具**——`grep` / `glob` 工具名与参数不变，模型零提示词改动即切换。
- **常驻索引**——重复检索复用同一份内存索引，单次调用毫秒级。
- **frecency 排序**——常打开、最近改的文件优先呈现。
- **git 感知索引**——引擎按文件跟踪工作区状态；结果中的显式标注将在后续版本提供。
- **优雅降级**——native 引擎加载失败时插件自动让位，内置 ripgrep 工具照常工作。

设计动机与取舍详见 [docs/design.md](./docs/design.md)。

## 开发

```sh
pnpm install
pnpm check      # typecheck + build + test
scripts/setup-hooks.sh   # git hooks 指向 .githooks/（pre-commit / pre-push）
```

真实 harness 的本地 e2e：构建后用默认 headless profile 加 `--patch` 覆盖层（指向 `./dist/index.js`）启动。

质量门禁：`python3 scripts/verify-adr-format.py && python3 scripts/verify-doc-budgets.py --manifest scripts/doc-budgets.manifest.json && python3 scripts/verify-md-links.py`。

## 许可

[MIT](./LICENSE)
