#!/usr/bin/env python3
"""Verify relative Markdown links: file targets exist and #fragment anchors resolve.

Checks, for every .md file under the given root (default: current directory):
  - `](relative/path.md)`  -> target file must exist
  - `](relative/path.md#slug)` -> target exists AND slug must match a heading
    slug (GitHub-style: lowercase, spaces->hyphens, strip punctuation) or an
    explicit <a id="slug"> anchor in that file
  - `](https://…)` / `](mailto:…)` / `](<…>)` -> skipped (external), as is any
    target containing `://`
  - targets starting with `/` resolve against the scan root, other targets
    against the linking file's directory
  - only `](…)` link targets are validated; filenames mentioned in prose are not

Vendored and generated trees never enter the scan: `node_modules/`, `.pnpm/`,
and the `.noogenesis/` gene-bank cache (a nested clone of the Noogenesis
repository, ignored in .gitignore). Exclusion matches a path segment at any
depth, and — unlike `skills/` — it has no opt-in flag, since the cache holds
foreign content whose links this repository does not own. `skills/`
directories are excluded because vendored skill sources keep their upstream
path references, which only resolve after path mapping; pass --include-skills
to check them anyway.

Usage: python3 verify-md-links.py [root_dir] [--include-skills]
       python3 verify-md-links.py --self-test   # offline fixture self-check
Exit code 0 = pass, 1 = violations.
"""

import argparse
import re
import sys
from pathlib import Path

LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
ANCHOR_RE = re.compile(r'<a\s+id="([^"]+)"')
EXCLUDED_PARTS = frozenset({"node_modules", ".pnpm", ".noogenesis"})


def slugify(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[^\w\u4e00-\u9fff \-]", "", text)
    text = re.sub(r"\s+", "-", text)
    return text


def heading_slugs(path: Path) -> set[str]:
    slugs: set[str] = set()
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return slugs
    for line in lines:
        m = HEADING_RE.match(line)
        if m:
            slugs.add(slugify(m.group(2)))
        m = ANCHOR_RE.search(line)
        if m:
            slugs.add(m.group(1))
    return slugs


def _scan(root: Path, include_skills: bool) -> tuple[int, list[tuple[str, str]]]:
    """Return (checked targets, [(markdown path, message)]) under root."""
    errors: list[tuple[str, str]] = []
    checked = 0
    for md in sorted(root.rglob("*.md")):
        parts = md.relative_to(root).parts
        if not include_skills and "skills" in parts:
            continue
        if EXCLUDED_PARTS.intersection(parts):
            continue
        text = md.read_text(encoding="utf-8")
        for target in LINK_RE.findall(text):
            target = target.strip()
            if target.startswith(("http://", "https://", "mailto:", "#", "<")):
                continue
            if "://" in target:
                continue
            if target.startswith("/"):  # repo-root absolute: resolve against root
                resolved = (root / target.lstrip("/")).resolve()
            else:
                resolved = (md.parent / target.split("#")[0]).resolve()
            if not resolved.is_file():
                errors.append((str(md), f"missing target '{target}'"))
                continue
            checked += 1
            if "#" in target:
                frag = target.split("#", 1)[1]
                if frag and frag not in heading_slugs(resolved):
                    errors.append((str(md), f"dead anchor '#{frag}' in '{target}'"))
    return checked, errors


def _self_test() -> int:
    """Offline fixture self-check over synthetic Markdown trees."""
    import tempfile

    # (files, include_skills, expected messages, expected checked count, desc)
    cases = [
        ({"docs/a.md": "[t](b.md)\n", "docs/b.md": "# B\n"}, False, [], 1,
         "resolving relative link -> pass"),
        ({"docs/a.md": "[t](missing.md)\n"}, False,
         ["missing target 'missing.md'"], 0, "missing target -> fail"),
        ({"docs/a.md": "[t](b.md#nope)\n", "docs/b.md": "# B\n"}, False,
         ["dead anchor '#nope' in 'b.md#nope'"], 1, "dead anchor -> fail"),
        ({"docs/a.md": "[t](b.md#b)\n", "docs/b.md": "# B\n"}, False, [], 1,
         "heading slug anchor -> pass"),
        ({"docs/a.md": "[t](b.md#pinned)\n", "docs/b.md": '<a id="pinned"></a>\n'},
         False, [], 1, "explicit <a id> anchor -> pass"),
        ({"docs/a.md": "[t](b.md#)\n", "docs/b.md": "# B\n"}, False, [], 1,
         "empty fragment -> pass"),
        ({"docs/a.md": "[e](https://x.test/a)\n[m](mailto:a@b.test)\n"
                       "[g](<other.md>)\n[s](ftp://h/x.md)\n"}, False, [], 0,
         "external, mailto, angle-bracket and :// targets skipped -> pass"),
        ({"docs/a.md": "see missing.md for details\n"}, False, [], 0,
         "filename in prose is not a link target -> pass"),
        ({"sub/a.md": "[r](/docs/gone.md)\n"}, False,
         ["missing target '/docs/gone.md'"], 0,
         "root-anchored target missing -> fail"),
        ({"sub/a.md": "[r](/docs/b.md)\n", "docs/b.md": "# B\n"}, False, [], 1,
         "root-anchored target resolving -> pass"),
        ({"skills/x.md": "[t](missing.md)\n"}, False, [], 0,
         "skills/ excluded by default -> pass"),
        ({"skills/x.md": "[t](missing.md)\n"}, True,
         ["missing target 'missing.md'"], 0,
         "--include-skills checks skills/ -> fail"),
        ({"node_modules/x.md": "[t](missing.md)\n",
          ".pnpm/y.md": "[t](missing.md)\n",
          ".noogenesis/genes-cache/z.md": "[t](missing.md)\n"}, False, [], 0,
         "excluded parts at any depth -> pass"),
        ({"docs/a.md": "[t](gone.md)\n",
          ".noogenesis/genes-cache/z.md": "[t](draft.md)\n"}, False,
         ["missing target 'gone.md'"], 0,
         "excluded dangling link stays silent while a repo-owned link fails"),
    ]

    failed = 0
    with tempfile.TemporaryDirectory() as td:
        for i, (files, include_skills, expected, expected_checked, desc) in enumerate(cases):
            tree = Path(td) / f"tree-{i}"
            for rel, text in files.items():
                p = tree / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(text, encoding="utf-8")
            checked, errors = _scan(tree, include_skills)
            actual = [msg for _, msg in errors]
            if actual != expected or checked != expected_checked:
                print(f"  ✗ {desc}: expected errors={expected} checked={expected_checked}, "
                      f"got errors={actual} checked={checked}")
                failed = 1
            else:
                print(f"  ok: {desc}")
    if failed == 0:
        print("== verify-md-links self-test passed ==")
    else:
        print("== verify-md-links self-test failed ==", file=sys.stderr)
    return failed


def main() -> int:
    if sys.argv[1:] == ["--self-test"]:
        return _self_test()

    ap = argparse.ArgumentParser()
    ap.add_argument("root", nargs="?", default=".")
    ap.add_argument("--include-skills", action="store_true",
                    help="also check skills/ (vendored sources, upstream refs)")
    args = ap.parse_args()
    checked, errors = _scan(Path(args.root), args.include_skills)

    print(f"Checked {checked} link targets")
    if errors:
        for md, msg in errors:
            print(f"FAIL: {md}: {msg}")
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())