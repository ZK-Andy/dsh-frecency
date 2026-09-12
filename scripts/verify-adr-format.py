#!/usr/bin/env python3
"""Verify Agent Note (ADR) format: naming, header block, skeleton, status-directory consistency.

Checks, for every .md under the notes root (default: .agents/notes), excluding
archived/ and .zh.md files:
  1. The path is exactly <lifecycle>/<class>/<name>.md, with lifecycle in
     {proposed, implemented, rejected} and class in the closed set. Anything
     else — beyond the top-level README.md / AGENTS.md — is an error: silently
     skipping unrecognized paths would let stray notes escape every check.
  2. The name is yyyy-mm-dd-<kebab-slug>.md (lowercase, hyphen-separated words;
     no uppercase, underscore or other separators).
  3. The date is a real calendar date, not before 1970 and not after today + 1
     day (tolerance for authors whose local date is ahead of UTC).
  4. Line 1 is "# Agent Note: <title>"; the "Status: <status>" line follows the
     title, and a blank line between title and Status is allowed — this matches
     the real deepseek-harness note convention (fixed 2026-08-20)
  5. Status value matches the lifecycle folder (proposed/implemented/rejected)
  6. Required skeleton sections exist (## Problem, ## Alternatives considered,
     plus lifecycle-specific: ## Decision/## Consequences for implemented,
     ## Proposal for proposed)
  7. implemented notes must NOT contain spec-speak headings
     (## Proposal / ## Plan / ## Migration plan / ## Acceptance criteria)

Usage: python3 verify-adr-format.py [notes_root]
       python3 verify-adr-format.py --self-test   # offline fixture self-check
Exit code 0 = pass, 1 = violations found.
"""

import argparse
import datetime
import re
import sys
from pathlib import Path

HEADER_RE = re.compile(r"^# Agent Note: .+$")
STATUS_RE = re.compile(r"^Status: (proposed|implemented|rejected(?: — .+)?)$")
ISO_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
NAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$")
LIFECYCLE_SET = ("proposed", "implemented", "rejected")
CLASS_SET = ("feature", "bug-fix", "simplification", "architecture", "process", "testing")
# The top-level exemption is a closed set: the notes subtree's standing files
# (index + subtree rules). Everything else must be exactly three segments deep.
TOP_LEVEL_EXEMPT = ("README.md", "AGENTS.md")
BANNED_IN_IMPLEMENTED = ("## Proposal", "## Plan", "## Migration plan", "## Acceptance criteria")
REQUIRED_ALL = ("## Problem", "## Alternatives considered")
REQUIRED_IMPLEMENTED = ("## Decision", "## Consequences")
REQUIRED_PROPOSED = ("## Proposal",)


def parse_iso_date(text: str) -> datetime.date | None:
    """A real calendar date, or None (out-of-range month/day, non-leap 02-29)."""
    m = ISO_DATE_RE.match(text)
    if m is None:
        return None
    try:
        return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def validate_name(rel: Path) -> list[str]:
    """Check the ADR path and file-naming rules for one non-exempt note."""
    errors: list[str] = []
    parts = rel.parts
    if len(parts) != 3:
        errors.append(f"{rel}: path must be exactly <lifecycle>/<class>/<name>.md "
                      f"(3 segments; got {len(parts)})")
        return errors

    lifecycle, cls, name = parts
    if lifecycle not in LIFECYCLE_SET:
        errors.append(f"{rel}: lifecycle '{lifecycle}' not in {list(LIFECYCLE_SET)}")
    if cls not in CLASS_SET:
        errors.append(f"{rel}: class '{cls}' not in {list(CLASS_SET)}")

    m = NAME_RE.match(name)
    if m is None:
        errors.append(f"{rel}: filename must be 'yyyy-mm-dd-<kebab-slug>.md' "
                      f"(lowercase, hyphen-separated words; no uppercase/underscore/other)")
        return errors

    date_str = m.group(1)
    note_date = parse_iso_date(date_str)
    if note_date is None:
        errors.append(f"{rel}: '{date_str}' is not a real calendar date")
        return errors

    today = datetime.datetime.now(datetime.timezone.utc).date()
    if note_date > today + datetime.timedelta(days=1):
        errors.append(f"{rel}: date '{date_str}' is after today ({today.isoformat()})")
    if note_date.year < 1970:
        errors.append(f"{rel}: date '{date_str}' is before the epoch (1970)")
    return errors


def _scan(root: Path) -> tuple[int, list[str]]:
    """Return (checked notes, errors) for the ADR tree under root."""
    errors: list[str] = []
    checked = 0
    for note in sorted(root.rglob("*.md")):
        rel = note.relative_to(root)
        parts = rel.parts
        if "archived" in parts or note.name.endswith(".zh.md"):
            continue
        # Exemption is one level deep only: a same-named file deeper in the tree
        # is not a subtree fixture and must pass the checks like any other note.
        if len(parts) == 1 and note.name in TOP_LEVEL_EXEMPT:
            continue
        checked += 1
        errors.extend(validate_name(rel))

        lines = note.read_text(encoding="utf-8").splitlines()

        if not lines or not HEADER_RE.match(lines[0]):
            errors.append(f"{rel}: line 1 must be '# Agent Note: <title>'")
        # 真实约定（deepseek 仓库实际笔记）：标题后可空一行，再跟 Status 行。
        status_line = next((l for l in lines[1:] if l.strip()), "")
        status_m = STATUS_RE.match(status_line)
        if status_m is None:
            errors.append(f"{rel}: must contain 'Status: <proposed|implemented|rejected>' after the title")
        elif status_m.group(1) != parts[0]:
            errors.append(f"{rel}: Status '{status_m.group(1)}' "
                          f"mismatches folder '{parts[0]}'")

        for sec in REQUIRED_ALL:
            if not any(l.strip() == sec for l in lines):
                errors.append(f"{rel}: missing required section '{sec}'")

        if parts[0] == "implemented":
            for sec in REQUIRED_IMPLEMENTED:
                if not any(l.strip() == sec for l in lines):
                    errors.append(f"{rel}: missing required section '{sec}'")
            for banned in BANNED_IN_IMPLEMENTED:
                if any(l.strip() == banned for l in lines):
                    errors.append(f"{rel}: implemented note must not contain '{banned}'")
        elif parts[0] == "proposed":
            for sec in REQUIRED_PROPOSED:
                if not any(l.strip() == sec for l in lines):
                    errors.append(f"{rel}: missing required section '{sec}'")
    return checked, errors


def _self_test() -> int:
    """Offline fixture self-check over synthetic ADR trees."""
    import tempfile

    def note_body(status: str, decision: str = "Decision") -> str:
        return ("# Agent Note: sample\n\n"
                f"Status: {status}\n\n"
                "## Problem\n\nbackground\n\n"
                f"## {decision}\n\ndecision\n\n"
                "## Alternatives considered\n\n- x\n\n"
                "## Consequences\n\nconsequences\n\n")

    today = datetime.datetime.now(datetime.timezone.utc).date()
    future = (today + datetime.timedelta(days=2)).isoformat()

    # (files, expected checked count, expected error fragments in order, desc)
    cases = [
        ({"implemented/feature/2026-08-27-naming-ok.md": note_body("implemented")},
         1, [], "conforming implemented note -> pass"),
        ({"proposed/feature/2026-08-27-proposal-ok.md": note_body("proposed", "Proposal")},
         1, [], "conforming proposed note -> pass"),
        ({"implemented/refactor/2026-08-27-naming-ok.md": note_body("implemented")},
         1, ["class 'refactor' not in"], "invalid class 'refactor' -> fail"),
        ({"implemented/feature/2026-08-27-Naming-Ok.md": note_body("implemented")},
         1, ["filename must be"], "uppercase in filename -> fail"),
        ({"implemented/feature/2026-08-27_bad-name.md": note_body("implemented")},
         1, ["filename must be"], "underscore in filename -> fail"),
        ({f"implemented/feature/{future}-naming-ok.md": note_body("implemented")},
         1, ["is after today"], "date after today -> fail"),
        ({"implemented/feature/2026-02-31-naming-ok.md": note_body("implemented")},
         1, ["is not a real calendar date"], "invalid calendar date -> fail"),
        ({"implemented/2026-08-27-naming-ok.md": note_body("implemented")},
         1, ["3 segments; got 2"], "path not 3 segments -> fail"),
        ({"drafts-scratch.md": "# Agent Note: scratch\n\nStatus: implemented\n"},
         1, ["3 segments; got 1", "mismatches folder 'drafts-scratch.md'",
             "missing required section '## Problem'",
             "missing required section '## Alternatives considered'"],
         "stray note outside lifecycle tree -> fail"),
        ({"implemented/feature/README.md": "# Agent Note: stray\n\nStatus: implemented\n"},
         1, ["filename must be", "missing required section '## Problem'",
             "missing required section '## Alternatives considered'",
             "missing required section '## Decision'",
             "missing required section '## Consequences'"],
         "exempt name below top level -> fail"),
        ({"implemented/feature/2026-08-27-naming-ok.md": note_body("proposed")},
         1, ["mismatches folder 'implemented'"], "status-folder mismatch -> fail"),
        ({"implemented/feature/2026-08-27-naming-ok.md":
          "# Agent Note: sample\n\nStatus: implemented\n\n## Problem\n\np\n\n"
          "## Decision\n\nd\n\n## Consequences\n\nc\n"},
         1, ["missing required section '## Alternatives considered'"],
         "missing mandatory section -> fail"),
        ({"implemented/feature/2026-08-27-naming-ok.md":
          note_body("implemented").replace("## Decision", "## Plan")},
         1, ["missing required section '## Decision'",
             "implemented note must not contain '## Plan'"],
         "spec heading in implemented -> fail"),
        ({"archived/feature/anything goes.md": "garbage\n"}, 0, [],
         "archived tree skipped -> pass"),
        ({"README.md": "index\n"}, 0, [], "top-level README exempt -> pass"),
    ]

    failed = 0
    with tempfile.TemporaryDirectory() as td:
        for i, (files, expected_checked, expected, desc) in enumerate(cases):
            tree = Path(td) / f"tree-{i}"
            for rel, text in files.items():
                p = tree / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(text, encoding="utf-8")
            checked, errors = _scan(tree)
            ok = (checked == expected_checked and len(errors) == len(expected)
                  and all(frag in err for frag, err in zip(expected, errors)))
            if ok:
                print(f"  ok: {desc}")
            else:
                print(f"  ✗ {desc}: expected checked={expected_checked} "
                      f"errors={expected}, got checked={checked} errors={errors}")
                failed = 1
    if failed == 0:
        print("== verify-adr-format self-test passed ==")
    else:
        print("== verify-adr-format self-test failed ==", file=sys.stderr)
    return failed


def main() -> int:
    ap = argparse.ArgumentParser(description="Verify Agent Note (ADR) format")
    ap.add_argument("root", nargs="?", default=".agents/notes")
    ap.add_argument("--self-test", action="store_true",
                    help="run the offline fixture self-check instead")
    args = ap.parse_args()
    if args.self_test:
        return _self_test()

    root = Path(args.root)
    if not root.is_dir():
        print(f"SKIP: {root} does not exist (no Agent Notes tree)")
        return 0

    checked, errors = _scan(root)
    print(f"Checked {checked} Agent Notes")
    if errors:
        for e in errors:
            print(f"FAIL: {e}")
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
