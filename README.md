# dsh-frecency

English | [中文](./README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that replaces the built-in `grep` / `glob` file-search tools with a **resident index + frecency ranking**.

The built-in tools spawn a fresh ripgrep process on every call and scan from scratch. In long sessions with many parallel subagents, the same searches run dozens of times. dsh-frecency keeps one resident index per working directory (the Rust [fff](https://github.com/dmtrKovalenko/fff) engine via `@ff-labs/fff-node`), so repeated searches hit hot memory in milliseconds, ranked by access/modification frecency, tagged with git status.

## Install

```sh
dsh plugin --profile web add dsh-frecency
```

## What you get

- **Same tool names** — `grep` / `glob` keep their names and schemas; the model switches with zero prompt changes.
- **Resident index** — repeated searches reuse one in-memory index; single-digit milliseconds per call.
- **Frecency ranking** — frequently opened / recently modified files surface first.
- **Git-aware index** — the engine tracks working-tree state per file; explicit annotations in tool output land in a follow-up release.
- **Graceful fallback** — if the native engine can't load, the plugin steps aside and the built-in ripgrep tools keep working.

See [docs/design.md](./docs/design.md) for the full design rationale.

## Development

```sh
pnpm install
pnpm check      # typecheck + build + test
scripts/setup-hooks.sh   # point git hooks at .githooks/ (pre-commit / pre-push)
```

Local e2e against a real harness: build, then boot the default headless profile with a `--patch` overlay pointing at `./dist/index.js`.

Quality gates: `python3 scripts/verify-adr-format.py && python3 scripts/verify-doc-budgets.py --manifest scripts/doc-budgets.manifest.json && python3 scripts/verify-md-links.py`.

## License

[MIT](./LICENSE)
