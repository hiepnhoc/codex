# Skill Design Rules

## Purpose

Use this when writing `SKILL.md`, frontmatter, references, templates, and scripts.

## Metadata

The description is the trigger. It is often all the agent sees before deciding whether to load the skill.

Format:

```yaml
---
name: kebab-case-name
description: Use when [concrete trigger/symptom] - [behavior or capability]
---
```

Rules:

- lowercase kebab-case name
- start description with `Use when`
- include user words, file types, commands, symptoms, or agent rationalizations
- avoid first person
- keep descriptions specific; target 100-250 characters when possible
- include platform/runtime only when relevant

Bad:

```yaml
description: Helps with code.
```

Good:

```yaml
description: Use when tests are flaky, hanging, or timing-dependent - replaces sleeps with condition-based polling and deterministic assertions.
```

## Progressive Disclosure

`SKILL.md` is the entry point, not the encyclopedia.

Put in `SKILL.md`:

- when to use
- core principle
- workflow or decision points
- non-negotiable rules
- links to references/templates/scripts
- verification/handoff checklist

Move out of `SKILL.md`:

- long examples
- detailed prompts
- command catalogs
- schema/API references
- troubleshooting tables
- large checklists
- scripts and generated artifacts

Use one-level links only:

```text
SKILL.md → reference/testing.md
SKILL.md → templates/report.md
```

Avoid nested chains:

```text
SKILL.md → reference/advanced.md → reference/deeper.md
```

## Type Structures

### Reference Skill

Use for exact facts, APIs, schemas, commands.

```markdown
# Skill Name

## Quick Navigation
## Quick Start
## Critical Rules
## Common Tasks
## Gotchas
## Reference Files
## Verification
```

### Procedure Skill

Use when order matters.

```markdown
# Skill Name

## When to Use
## Required Inputs
## Workflow
### 1. Inspect
### 2. Plan
### 3. Validate
### 4. Execute
### 5. Verify
## Stop Conditions
## Handoff
```

### Discipline Skill

Use when preventing shortcuts.

```markdown
# Skill Name

## Iron Law
## When to Use
## Correct Loop
## Forbidden Shortcuts
## Rationalizations
## Red Flags
## Recovery
## Completion Checklist
```

### Guidance Skill

Use for judgment and tradeoffs.

```markdown
# Skill Name

## Purpose
## When to Use
## Core Thinking
## Decision Points
## Heuristics
## Common Pitfalls
## Output
## Review Checklist
```

### Router Skill

Use for choosing workflows.

```markdown
# Skill Name

## Purpose
## Classification Table
## Mandatory Rules
## Workflow Recipes
## Escalation / Stop Conditions
## Output Format
```

## Four-Layer Defense

For discipline failures, address the same loophole four ways:

| Layer | Include |
| --- | --- |
| Explicit negation | `Do not skip the failing test because the change seems small.` |
| Rationalization defense | `"This is obvious" usually means no feedback loop exists.` |
| Red flag | `If you are about to edit production code before a repro, stop.` |
| Trigger update | Add the symptom to frontmatter description. |

Only defend against real observed shortcuts or project-known incidents. Do not bloat the skill with hypothetical fear.

## Engineering Patterns Worth Encoding

Borrow these patterns when they match the project skill:

- **Domain language:** prefer `CONTEXT.md` terms over ad-hoc names.
- **Grilling:** ask one decision at a time; answer code-searchable questions by reading code.
- **Feedback loops:** debugging starts by reproducing the bug with a fast signal.
- **Behavior tests:** test public interfaces and user-visible behavior, not private implementation details.
- **Vertical slices:** one narrow end-to-end tracer bullet beats horizontal layer tasks.
- **Deep modules:** look for small interfaces hiding useful behavior; avoid pass-through modules.
- **Prototypes:** throwaway code answers one question and is deleted or absorbed.
- **Worktrees:** non-trivial writes happen away from the main workspace.
- **Verification:** completion requires project-native checks or an explicit limitation.

## Scripts and Templates

Add scripts when the operation is deterministic or fragile:

- validation
- formatting
- report generation
- command orchestration
- reproducible repro loops

Rules:

- keep scripts inside the skill directory under `scripts/`
- keep RED/GREEN reports, review artifacts, and empirical test evidence under `tests/`
- document how to run the script and expected success/failure output
- do not put project secrets or private data into scripts
- do not leave helpers or reports in `/tmp`, `~`, or unrelated repo folders
- prefer templates for human-readable artifacts and prompts

## Style

- Use active voice.
- Use direct commands.
- One sentence, one idea.
- State each rule once in the strongest section.
- Prefer one concrete example over many generic examples.
- Explain why only when it changes behavior.
- Avoid all-caps except true stop conditions.
- Remove filler: basically, simply, really, very, in order to.

## Size Targets

| Skill usage | Target |
| --- | --- |
| Frequently loaded router/core skill | 100-250 lines |
| Normal skill | under 500 lines |
| Long reference file | add a contents section |
| Huge source docs | link or summarize, do not paste wholesale |

A short skill with the right trigger and verification beats a giant skill agents stop reading.
