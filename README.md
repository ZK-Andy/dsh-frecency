# dsh-frecency

English | [中文](./README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that replaces the built-in `grep` / `glob` file-search tools with a **resident index + frecency ranking**.

The built-in tools spawn a fresh ripgrep process on every call and scan from scratch. In long sessions with many parallel subagents, the same searches run dozens of times. dsh-frecency keeps one resident index per working directory (the Rust [fff](https://github.com/dmtrKovalenko/fff) engine via `@ff-labs/fff-node`), so repeated searches hit hot memory in milliseconds, ranked by access/modification frecency.

## Install

```sh
dsh plugin --profile <profile> add dsh-frecency
cp -rL ~/.dsh/profiles/<profile>/node_modules/dsh-frecency/preset ~/.dsh/.agent-presets/dsh-frecency
```

Then append to `~/.dsh/profiles/<profile>/cordis.patch.yml` (keeps the host-plane mount inert — see why below):

```yaml
- id: dsh-frecency
  config:
    enabled: false
```

Finally select the **dsh-frecency** agent preset when starting a session. DSH resolves tools on two planes: the built-in `grep` / `glob` are mounted per-session by the agent preset (agent plane), which is nearer to the session than any profile bundle (host plane) — so same-name shadowing must happen inside a preset composition. The shipped preset is a copy of the `standard` composition with the `tool-fs-search` row **replaced** by dsh-frecency (all rows of one preset share a single scope, so both rows cannot coexist); the plugin reuses fs-search's presentation builders, so nothing else is lost. Re-derive the preset when you upgrade dsh; restoring the `tool-fs-search` row (and removing ours) falls back to the built-in tools.

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
