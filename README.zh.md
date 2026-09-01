# dsh-frecency

[English](./README.md) | 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：用**常驻索引 + frecency 排序**的文件搜索替换内置 `grep` / `glob` 工具。

内置工具每次调用都 spawn 一个全新的 ripgrep 进程、从零扫描；长会话与多子代理场景下同样的搜索会重复执行数十次。dsh-frecency 为每个工作目录保留一份常驻索引（Rust [fff](https://github.com/dmtrKovalenko/fff) 引擎，经 `@ff-labs/fff-node`），重复检索毫秒级命中热内存，结果按访问/修改 frecency 排序。

## 安装

```sh
dsh plugin --profile <profile> add dsh-frecency
cp -rL ~/.dsh/profiles/<profile>/node_modules/dsh-frecency/preset ~/.dsh/.agent-presets/dsh-frecency
```

然后向 `~/.dsh/profiles/<profile>/cordis.patch.yml` 追加（让 host 平面挂载保持惰性——原因见下）：

```yaml
- id: dsh-frecency
  config:
    enabled: false
```

最后在会话启动时选择 **dsh-frecency** 这个 agent 预设。DSH 在两个平面解析工具：内置 `grep` / `glob` 由 agent 预设在会话创建时挂载（agent 平面），比任何 profile bundle（host 平面）都更近会话——同名遮蔽必须发生在预设组合内。附带的预设是 `standard` 组合的副本、在 `tool-fs-search` 之后插入了 dsh-frecency；升级 dsh 后需重新派生。摘除预设行即回退内置工具。

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
