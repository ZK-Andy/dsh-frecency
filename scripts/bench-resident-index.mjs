#!/usr/bin/env node
/**
 * Baseline harness behind the performance and memory numbers in
 * docs/performance.md.
 *
 *   node scripts/bench-resident-index.mjs gen <dir> [--files 14000]
 *   node scripts/bench-resident-index.mjs run <dir> [--iterations 20] [--rg /path/to/rg]
 *
 * gen writes a deterministic tree: 100 files per pkgnnn/src directory, each
 * about 4KB, every 100th file carrying the marker word `benchmarkmarker`.
 *
 * run measures, on that tree and with that pattern, the two mechanisms named
 * in docs/design.md §7:
 *
 *   - resident index: the engine API the plugin calls — `FileFinder.create` +
 *     `waitForScan` + `waitForIndexReady`, then the grep options and paging
 *     loop copied from src/grep.ts — kept in one process across iterations;
 *   - built-in mechanism: one `rg --json` spawn per iteration, with the argv
 *     the built-in tool builds (dsh-tool-fs-search `buildGrepCommand`) plus
 *     the `--no-config` prefix that tool prepends.
 *
 * Both arms are mechanism-level: plugin mapping/filters/presentation and the
 * harness render path sit outside them, so these numbers are lower bounds for
 * end-to-end tool latency. Flags accept both `--flag value` and `--flag=value`.
 * run prints one JSON object; repeat the command to observe run-to-run
 * variance. RSS comes from /proc/self/status, so it is Linux-only and null
 * elsewhere.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { FileFinder } from "@ff-labs/fff-node";

const execFileP = promisify(execFile);

const USAGE = `usage:
  node scripts/bench-resident-index.mjs gen <dir> [--files 14000]
  node scripts/bench-resident-index.mjs run <dir> [--iterations 20] [--rg /path/to/rg]

gen writes a deterministic tree (100 files per pkgnn/src, ~4KB each, every
100th file carrying 'benchmarkmarker'). run compares the resident engine the
plugin calls against one 'rg --json' spawn per call with the built-in argv.
Flags also accept --flag=value; run prints one JSON object.`;

// Mirrors src/grep.ts so the index arm queries exactly like the shipped tool.
const PAGE_SIZE = 500;
const MAX_PAGES = 4;
const SCAN_TIMEOUT_MS = 30_000;
const PATTERN = "benchmarkmarker";
const FILES_PER_DIR = 100;
const MARKER_EVERY = 100;

function fail(message) {
  console.error(`error: ${message}`);
  console.error(USAGE);
  process.exit(2);
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) fail(`unexpected argument '${arg}'`);
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) fail(`flag '${arg}' needs a value`);
    flags[arg.slice(2)] = value;
    i += 1;
  }
  return flags;
}

function positiveInt(flags, name, fallback) {
  const raw = flags[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) fail(`--${name} must be a positive integer (got '${raw}')`);
  return value;
}

function rejectUnknown(flags, allowed) {
  for (const name of Object.keys(flags)) {
    if (!allowed.includes(name)) fail(`unknown flag '--${name}'`);
  }
}

function generate(dir, files) {
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    fail(`refusing to write into non-empty '${dir}' — choose a fresh directory`);
  }
  const body = "export function handler(input: string) {\n  return input.trim().toLowerCase();\n}\n".repeat(20);
  for (let d = 0; d < Math.ceil(files / FILES_PER_DIR); d += 1) {
    const dirPath = join(dir, `pkg${String(d).padStart(3, "0")}`, "src");
    mkdirSync(dirPath, { recursive: true });
    for (let f = 0; f < FILES_PER_DIR; f += 1) {
      const idx = d * FILES_PER_DIR + f;
      if (idx >= files) break;
      let text = body;
      if (idx % MARKER_EVERY === 0) text += "\nbenchmarkmarker appears in this file\n";
      writeFileSync(join(dirPath, `file${String(idx).padStart(5, "0")}.ts`), text);
    }
  }
}

function vmRssMB() {
  try {
    const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"));
    return m === null ? null : Math.round(Number(m[1]) / 1024);
  } catch {
    return null; // non-Linux hosts: report null rather than crash the run
  }
}

const percentile = (xs, p) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

const summarize = (xs) => ({
  iterations: xs.length,
  p50ms: Number(percentile(xs, 0.5).toFixed(2)),
  p95ms: Number(percentile(xs, 0.95).toFixed(2)),
  minMs: Number(Math.min(...xs).toFixed(2)),
  maxMs: Number(Math.max(...xs).toFixed(2)),
});

async function run(tree, iterations, rgPath) {
  if (!existsSync(tree)) fail(`tree '${tree}' does not exist`);
  const rssBefore = vmRssMB();
  const start = performance.now();
  const created = FileFinder.create({ basePath: tree });
  if (!created.ok) throw new Error(created.error);
  const finder = created.value;
  try {
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
        const result = finder.grep(PATTERN, {
          mode: "regex",
          smartCase: false,
          pageSize: PAGE_SIZE,
          cursor,
          classifyDefinitions: true,
        });
        if (!result.ok) throw new Error(result.error);
        // src/grep.ts surfaces the engine's literal fallback as an error; the
        // measurement must not silently switch pattern semantics either.
        if (result.value.regexFallbackError !== undefined) {
          throw new Error(`pattern is not a valid regular expression: ${result.value.regexFallbackError}`);
        }
        items.push(...result.value.items);
        cursor = result.value.nextCursor;
        exhausted = cursor === null;
      }
      return items.length;
    };

    const rgGrep = async () => {
      const { stdout } = await execFileP(
        rgPath,
        ["--no-config", "--json", `--regexp=${PATTERN}`, "--", tree],
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

    const rgVersion = (await execFileP(rgPath, ["--version"])).stdout.split("\n")[0];
    return {
      tree,
      pattern: PATTERN,
      pageCap: MAX_PAGES * PAGE_SIZE,
      host: { node: process.version, rg: rgPath, rgVersion },
      index: {
        scanMs: Number(scanMs.toFixed(1)),
        readyMs: Number(readyMs.toFixed(1)),
        rssBeforeMB: rssBefore,
        rssAfterIndexMB: rssAfterIndex,
        rssDeltaMB: rssBefore === null || rssAfterIndex === null ? null : rssAfterIndex - rssBefore,
      },
      engineGrep: { ...summarize(indexMs), items: indexItems },
      rgSpawnGrep: { ...summarize(rgMs), matches: rgMatches },
      speedupP50: Number((percentile(rgMs, 0.5) / percentile(indexMs, 0.5)).toFixed(1)),
    };
  } finally {
    if (!finder.isDestroyed) finder.destroy();
  }
}

const [mode, target, ...rest] = process.argv.slice(2);
if (target === undefined) fail("expected a mode (gen|run) and a tree directory");
const flags = parseFlags(rest);

try {
  if (mode === "gen") {
    rejectUnknown(flags, ["files"]);
    const files = positiveInt(flags, "files", 14000);
    generate(target, files);
    console.log(JSON.stringify({ generated: { dir: target, files, markerEvery: MARKER_EVERY } }));
  } else if (mode === "run") {
    rejectUnknown(flags, ["iterations", "rg"]);
    const iterations = positiveInt(flags, "iterations", 20);
    console.log(JSON.stringify(await run(target, iterations, flags.rg ?? "rg"), null, 2));
  } else {
    fail(`unknown mode '${mode}'`);
  }
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
}
