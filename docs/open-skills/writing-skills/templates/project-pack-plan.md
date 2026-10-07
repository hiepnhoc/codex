# Project Skill Pack Plan: {project}

## Project Summary

- Project path:
- Runtime/language/framework:
- Main package manager/task runner:
- Primary test commands:
- Domain docs/context files:
- Existing agent instructions:

## Source Audit

| Source | Relevant rules/facts | Skill impact |
| --- | --- | --- |
| `README.md` |  |  |
| `AGENTS.md` / equivalent |  |  |
| `CONTEXT.md` / ADRs |  |  |
| package/build files |  |  |
| CI config |  |  |
| existing skills |  |  |

## Base Pack Decision

### Install unchanged

- 

### Update/adapt

| Skill | Required change | Why |
| --- | --- | --- |
|  |  |  |

### Do not install / drop

| Skill | Reason |
| --- | --- |
|  |  |

## Project Overlay Skills to Create

| Skill | Type | Trigger | Evidence needed | Verification |
| --- | --- | --- | --- | --- |
| `{project}-testing` | procedure/reference |  |  |  |
| `{project}-architecture` | guidance/reference |  |  |  |
| `{project}-api` | reference/procedure |  |  |  |

## RED/GREEN Plan

- RED attempts needed:
- GREEN tasks:
- Isolated workspace/worktree policy:
- Artifact path:

## Risks and Boundaries

- No secrets/private data to include:
- External/irreversible actions requiring approval:
- Known unverified assumptions:

## Final Handoff Checklist

- [ ] All chosen skills exist under `.agents/skills/` or the requested path.
- [ ] `SKILL.md` files have valid frontmatter and high-signal triggers.
- [ ] References/templates/scripts linked from `SKILL.md` exist.
- [ ] Project commands were verified or marked unverified.
- [ ] RED/GREEN or review evidence is recorded.
- [ ] Dropped/merged skills are documented.
