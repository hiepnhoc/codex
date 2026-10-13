#!/usr/bin/env python3

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path


PACK_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = PACK_ROOT / "manifest.json"
ALLOWED_FRONTMATTER_KEYS = {
    "allowed-tools",
    "description",
    "license",
    "metadata",
    "name",
}
TOP_LEVEL_DOCS = [
    "AGENTS.md",
    "AGENTS-snippet.md",
    "README.md",
    "ROUTING.md",
    "OPTIMIZATION.md",
    "CHANGELOG.md",
    "VERSION",
]


def parse_frontmatter(path: Path) -> tuple[dict[str, str], list[str]]:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"\A---\n(.*?)\n---(?:\n|\Z)", text, re.DOTALL)
    if not match:
        return {}, ["missing or malformed YAML frontmatter"]

    values: dict[str, str] = {}
    errors: list[str] = []
    for line in match.group(1).splitlines():
        if not line or line[0].isspace() or line.lstrip().startswith("#"):
            continue
        key_match = re.match(r"([A-Za-z0-9_-]+):(?:\s*(.*))?\Z", line)
        if not key_match:
            errors.append(f"unsupported top-level frontmatter line: {line!r}")
            continue
        key, value = key_match.groups()
        if key in values:
            errors.append(f"duplicate frontmatter key: {key}")
        values[key] = (value or "").strip().strip("'\"")

    unexpected = sorted(set(values) - ALLOWED_FRONTMATTER_KEYS)
    if unexpected:
        errors.append(f"unsupported frontmatter keys: {', '.join(unexpected)}")
    for required in ("name", "description"):
        if not values.get(required):
            errors.append(f"missing frontmatter value: {required}")
    return values, errors


def markdown_link_errors(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"(?ms)^(```|~~~).*?^\1[ \t]*$", "", text)
    errors: list[str] = []
    for target in re.findall(r"(?<!!)\[[^\]]*\]\(([^)]+)\)", text):
        target = target.split(maxsplit=1)[0].strip("<>")
        if not target or target.startswith(("#", "http://", "https://", "mailto:")):
            continue
        relative = target.split("#", 1)[0]
        if relative and not (path.parent / relative).exists():
            errors.append(f"broken relative link {target!r}")
    return errors


def skill_records() -> tuple[list[dict[str, object]], list[str]]:
    records: list[dict[str, object]] = []
    errors: list[str] = []
    names: set[str] = set()
    skill_files = sorted(PACK_ROOT.glob("*/SKILL.md"))

    for skill_file in skill_files:
        folder = skill_file.parent.name
        metadata, metadata_errors = parse_frontmatter(skill_file)
        errors.extend(f"{skill_file.relative_to(PACK_ROOT)}: {error}" for error in metadata_errors)
        name = metadata.get("name", "")
        if name and not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
            errors.append(f"{skill_file.relative_to(PACK_ROOT)}: invalid skill name {name!r}")
        if name and name != folder:
            errors.append(
                f"{skill_file.relative_to(PACK_ROOT)}: name {name!r} does not match folder {folder!r}"
            )
        if name in names:
            errors.append(f"duplicate skill name: {name}")
        names.add(name)
        errors.extend(
            f"{skill_file.relative_to(PACK_ROOT)}: {error}"
            for error in markdown_link_errors(skill_file)
        )

        content = skill_file.read_bytes()
        records.append(
            {
                "name": name,
                "folder": folder,
                "description": metadata.get("description", ""),
                "path": str(skill_file.relative_to(PACK_ROOT)),
                "sha256": hashlib.sha256(content).hexdigest(),
                "lines": len(content.splitlines()),
            }
        )

    for manual_skill in ("setup-matt-pocock-skills", "zoom-out"):
        policy = PACK_ROOT / manual_skill / "agents" / "openai.yaml"
        if not policy.exists():
            errors.append(f"{manual_skill}: missing agents/openai.yaml invocation policy")
            continue
        policy_text = policy.read_text(encoding="utf-8")
        if "allow_implicit_invocation: false" not in policy_text:
            errors.append(f"{manual_skill}: expected allow_implicit_invocation: false")
        if f"${manual_skill}" not in policy_text:
            errors.append(f"{manual_skill}: default_prompt must mention ${manual_skill}")

    return records, errors


def build_manifest(records: list[dict[str, object]]) -> dict[str, object]:
    return {
        "name": "higa-codex-dev-skills",
        "version": (PACK_ROOT / "VERSION").read_text(encoding="utf-8").strip(),
        "created_for": "HiGa",
        "purpose": "Versioned Codex developer skill pack with rollback-safe installation.",
        "skill_count": len(records),
        "skills": records,
        "top_level_docs": TOP_LEVEL_DOCS,
        "install_target_default": "${CODEX_HOME:-~/.codex}/skills",
        "repository_target_default": ".agents/skills",
        "backup_policy": "scripts/install.sh backs up managed target skills before replacement.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate the Codex skill pack")
    parser.add_argument("--write-manifest", action="store_true")
    args = parser.parse_args()

    records, errors = skill_records()
    expected_manifest = build_manifest(records)

    if args.write_manifest:
        MANIFEST_PATH.write_text(
            json.dumps(expected_manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    elif not MANIFEST_PATH.exists():
        errors.append("manifest.json is missing; run with --write-manifest")
    else:
        try:
            actual_manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            errors.append(f"manifest.json is invalid JSON: {error}")
        else:
            if actual_manifest != expected_manifest:
                errors.append("manifest.json is stale; run with --write-manifest")

    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        print(f"Validation failed with {len(errors)} error(s).", file=sys.stderr)
        return 1

    action = "wrote and validated" if args.write_manifest else "validated"
    print(f"{action} {len(records)} Codex skills")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
