import { existsSync, readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceDir = join(root, "src");
const bundlePath = join(root, "dist", "index.js");

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * Packages the running DSH installation resolves for the plugin through its
 * profile resolution layer. The plugin never installs them itself, so they
 * carry no npm version range: the host supplies the line it ships.
 */
const HOST_PACKAGES = [
  "@deepseek-ai/dsh-output-retention",
  "@deepseek-ai/dsh-tool-fs-search",
  "@deepseek-ai/dsh-tools",
  "@deepseek-ai/schemastery",
];

const BUILTINS = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/** Package name of a bare specifier, including its scope, without any subpath. */
function packageName(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0] ?? specifier;
}

/**
 * Bare packages the plugin loads at runtime. Type-only imports and re-exports
 * are erased by the build; dynamic `import()` and side-effect imports load
 * code and count.
 */
function runtimeSpecifiers(): string[] {
  const specifiers = new Set<string>();
  for (const file of sourceFiles(sourceDir)) {
    const source = readFileSync(file, "utf8")
      .replace(/(?:^|\n)\s*(?:import|export)\s+type\s[^;]*?from\s*"[^"]+";?/g, "");
    const collect = (match: RegExpMatchArray): void => {
      const specifier = match[1];
      if (specifier === undefined || specifier.startsWith(".") || BUILTINS.has(specifier)) return;
      specifiers.add(packageName(specifier));
    };
    for (const match of source.matchAll(/\bfrom\s*"([^"]+)"/g)) collect(match);
    for (const match of source.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)) collect(match);
    for (const match of source.matchAll(/(?:^|\n)\s*import\s+"([^"]+)";/g)) collect(match);
  }
  return [...specifiers].sort();
}

function owns(record: Record<string, string> | undefined, key: string): boolean {
  return record !== undefined && Object.prototype.hasOwnProperty.call(record, key);
}

/** Whether the bundle reaches a package by import instead of carrying its code. */
function importedByBundle(source: string, name: string): boolean {
  const quoted = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:from\\s*"${quoted}"|import\\(\\s*"${quoted}"\\s*\\)|import\\s*"${quoted}")`).test(source);
}

describe("published manifest contract", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Manifest;
  const imported = runtimeSpecifiers();
  const hostImports = imported.filter(specifier => specifier.startsWith("@deepseek-ai/"));

  it("declares no peerDependencies, because the host supplies these packages", () => {
    expect(manifest.peerDependencies).toBeUndefined();
  });

  it("keeps the host package list identical to what the sources import", () => {
    expect(new Set(hostImports)).toEqual(new Set(HOST_PACKAGES));
  });

  it("routes every runtime import to the host set or to a declared dependency", () => {
    for (const specifier of imported) {
      const isHost = HOST_PACKAGES.includes(specifier);
      if (isHost) {
        expect(owns(manifest.dependencies, specifier), `${specifier} must not be installed alongside the host copy`).toBe(false);
      } else {
        expect(owns(manifest.dependencies, specifier), `${specifier} needs a dependencies entry`).toBe(true);
      }
    }
  });

  it("pins every imported host package in devDependencies for the build and test run", () => {
    for (const specifier of hostImports) {
      expect(owns(manifest.devDependencies, specifier), `${specifier} needs a devDependency pin`).toBe(true);
    }
  });

  it.skipIf(!existsSync(bundlePath))("imports the host packages instead of bundling them", () => {
    const bundle = readFileSync(bundlePath, "utf8");
    for (const specifier of HOST_PACKAGES) {
      expect(importedByBundle(bundle, specifier), `${specifier} must stay external (tsdown deps.neverBundle)`).toBe(true);
    }
  });
});
