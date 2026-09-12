#!/usr/bin/env node
/**
 * Baseline harness behind the performance and memory numbers in
 * docs/performance.md.
 *
 *   node scripts/bench-resident-index.mjs gen <dir> [--files 14000] [--marker-every 100]
 *   node scripts/bench-resident-index.mjs run <dir> [--iterations 20]
 *        [--pattern benchmarkmarker] [--rg /path/to/rg]
 *
 * `run` measures the two mechanisms named in docs/design.md §7 on one tree and
 * one pattern, warm page cache on both arms:
 *
 *   - resident index: the engine API the plugin calls, kept in one process
 *     across iterations — `FileFinder.create` + `waitForScan` +
 *     `waitForIndexReady`, then the grep options and paging loop copied from
 *     src/grep.ts;
 *   - built-in mechanism: one `rg --json` spawn per iteration, with the argv
 *     the built-in tool builds (`buildGrepCommand` in dsh-tool-fs-search) plus
 *     the `--no-config` prefix the tool prepends.
 *
 * Both arms are mechanism-level: plugin mapping/filters/presentation and the
 * harness render path sit outside them, so these numbers are lower bounds for
 * end-to-end tool latency. Output is one JSON object (build time, RSS delta,
 * p50/p95 per arm).
 */

import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { FileFinder } from "@ff-labs/fff-node";

const execFileP = promisify(execFile);

// Mirrors src/grep.ts so the index arm queries exactly like the shipped tool.
const PAGE_SIZE = 500;
const MAX_PAGES = 4;
const SCAN_TIMEOUT_MS = 30_000;

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error(readFileSync(new URL(import.meta.url)).toString().split("*/")[0].replace(/^\/\*\*?/, "").trim());
  process.exit(2);
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) usage(`unexpected argument '${arg}'`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) usage(`flag '${arg}' needs a value`);
    flags[arg.slice(2)] = value;
    i += 1;
  }
  return flags;
}

function generate(dir, files, markerEvery) {
  const perDir = 100;
  const body = "export function handler(input: string) {\n  return input.trim().toLowerCase();\n}\n".repeat(20);
  for (let d = 0; d < Math.ceil(files / perDir); d += 1) {
    const dirPath = join(dir, `pkg${String(d).padStart(3, "0")}`, "src");
    mkdirSync(dirPath, { recursive: true });
    for (let f = 0; f < perDir; f += 1) {
      const idx = d * perDir + f;
      if (idx >= files) break;
      let text = body;
      if (idx % markerEvery === 0) text += "\nbenchmarkmarker appears in this file\n";
      writeFileSync(join(dirPath, `file${String(idx).padStart(5, "0")}.ts`), text);
    }
  }
}

function vmRssMB() {
  const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"));
  return m === null ? null : Math.round(Number(m[1]) / 1024);
}

const percentile = (xs, p) =>
  xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

const summarize = (xs) => ({
  iterations: xs.length,
  p50ms: Number(percentile(xs, 0.5).toFixed(2)),
  p95ms: Number(percentile(xs, 0.95).toFixed(2)),
  minMs: Number(Math.min(...xs).toFixed(2)),
  maxMs: Number(Math.max(...xs).toFixed(2)),
});

async function run(tree, iterations, pattern, rgPath) {
  const rssBefore = vmRssMB();
  const start = performance.now();
  const created = FileFinder.create({ basePath: tree });
  if (!created.ok) throw new Error(created.error);
  const finder = created.value;
  const scan = await finder.waitForScan(SCAN_TIMEOUT_MS);
  if (!scan.ok) throw new Error(scan.error);
  const scanMs = performance.now() - start;
  const ready = await finder.waitForIndexReady(SCAN_TIMEOUT_MS);
  if (!ready.ok) throw new Error(ready.error);
  const readyMs = performance.now() - start;
  const rssAfterIndex = vmRssMB();

  const indexGrep = () => {
    const items = [];
    let cursor = null;
    let exhausted = false;
    for (let page = 0; page < MAX_PAGES && !exhausted; page += 1) {
      const result = finder.grep(pattern, {
        mode: "regex",
        smartCase: false,
        pageSize: PAGE_SIZE,
        cursor,
        classifyDefinitions: true,
      });
      if (!result.ok) throw new Error(result.error);
      items.push(...result.value.items);
      cursor = result.value.nextCursor;
      exhausted = cursor === null;
    }
    return items.length;
  };

  const rgGrep = async () => {
    const { stdout } = await execFileP(
      rgPath,
      ["--no-config", "--json", `--regexp=${pattern}`, "--", tree],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    let matches = 0;
    for (const line of stdout.split("\n")) if (line.startsWith('{"type":"match"')) matches += 1;
    return matches;
  };

  const indexItems = indexGrep();
  const rgMatches = await rgGrep(); // warm the page cache for both arms

  const indexMs = [];
  for (let i = 0; i < iterations; i += 1) {
    const t = performance.now();
    indexGrep();
    indexMs.push(performance.now() - t);
  }
  const rgMs = [];
  for (let i = 0; i < iterations; i += 1) {
    const t = performance.now();
    await rgGrep();
    rgMs.push(performance.now() - t);
  }

  finder.destroy();
  const rgVersion = (await execFileP(rgPath, ["--version"])).stdout.split("\n")[0];
  return {
    tree,
    host: { node: process.version, rg: rgPath, rgVersion },
    index: {
      scanMs: Number(scanMs.toFixed(1)),
      readyMs: Number(readyMs.toFixed(1)),
      rssBeforeMB: rssBefore,
      rssAfterIndexMB: rssAfterIndex,
      rssDeltaMB: rssBefore === null ? null : rssAfterIndex - rssBefore,
    },
    engineGrep: { ...summarize(indexMs), items: indexItems },
    rgSpawnGrep: { ...summarize(rgMs), matches: rgMatches },
    speedupP50: Number((percentile(rgMs, 0.5) / percentile(indexMs, 0.5)).toFixed(1)),
  };
}

const [mode, target, ...rest] = process.argv.slice(2);
if (target === undefined) usage("expected a mode (gen|run) and a tree directory");
const flags = parseFlags(rest);

if (mode === "gen") {
  const files = Number(flags.files ?? 14000);
  const markerEvery = Number(flags["marker-every"] ?? 100);
  generate(target, files, markerEvery);
  console.log(JSON.stringify({ generated: { dir: target, files, markerEvery } }));
} else if (mode === "run") {
  const iterations = Number(flags.iterations ?? 20);
  const pattern = flags.pattern ?? "benchmarkmarker";
  const rgPath = flags.rg ?? "rg";
  console.log(JSON.stringify(await run(target, iterations, pattern, rgPath), null, 2));
} else {
  usage(`unknown mode '${mode}'`);
}
