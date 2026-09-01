# dsh-frecency

English | [中文](./README.zh.md)

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-frecency"><img src="https://img.shields.io/npm/v/dsh-frecency?style=flat&label=npm&color=4D6BFE" alt="npm"></a>
  <a href="https://www.npmjs.com/package/dsh-frecency"><img src="https://img.shields.io/npm/dt/dsh-frecency?style=flat&label=downloads&color=4D6BFE" alt="downloads"></a>
  <a href="https://github.com/ZK-Andy/dsh-frecency/stargazers"><img src="https://img.shields.io/github/stars/ZK-Andy/dsh-frecency?style=flat&label=stars&color=4D6BFE" alt="stars"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://github.com/ZK-Andy/dsh-frecency/actions/workflows/ci.yml"><img src="https://github.com/ZK-Andy/dsh-frecency/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="./docs/testing.md"><img src="https://img.shields.io/badge/tests-67%2F67-brightgreen" alt="tests"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D22-339933" alt="node >= 22"></a>
</p>

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that takes over the built-in `grep` / `glob` file-search tools: `grep` runs on a **resident index with frecency ranking**, `glob` mirrors the built-in discovery semantics exactly when ripgrep is available (and degrades to the resident index otherwise).

The built-in tools spawn a fresh ripgrep process on every call and scan from scratch. In long sessions with many parallel subagents, the same searches run dozens of times. dsh-frecency keeps one resident index per working directory (the Rust [fff](https://github.com/dmtrKovalenko/fff) engine via `@ff-labs/fff-node`), so repeated searches hit hot memory in milliseconds, ranked by access/modification frecency.

## Install

```sh
dsh plugin --profile <profile> add dsh-frecency
```

Restart dsh and start a session — `grep` / `glob` keep their names and schemas; `grep` hits the resident index and `glob` serves the same results as the built-in tool, whatever agent preset you use. The built-in search tools are mounted per-session on the agent plane, which beats any host-plane registration, so the plugin registers into **each agent's own layer** at agent creation (first-party precedent: `dsh-tool-subagent`). Config `enabled: false` or removing the plugin falls back to the built-in ripgrep tools.

## What you get

- **Same tool names** — `grep` / `glob` keep their names and schemas; the model switches with zero prompt changes.
- **Resident index (grep)** — repeated content searches reuse one in-memory index; single-digit milliseconds per call.
- **Frecency ranking (grep)** — frequently opened / recently modified files surface first.
- **Built-in-parity glob** — glob runs the same fixed `rg --files` invocation as the built-in tool: hidden and ignored files included, VCS metadata excluded, modification-time order. If ripgrep is unavailable, it degrades to the resident index.
- **Annotated grep output** — engine-classified `isDefinition` and per-file `gitStatus` ride along in grep results, so the model can spot definition lines and modified files without re-reading.
- **Git-aware index** — the engine tracks working-tree state per file and surfaces it as `gitStatus` in results.
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
