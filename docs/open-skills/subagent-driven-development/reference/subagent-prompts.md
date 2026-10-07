# Implementation Worker Prompt Template

```markdown
You are implementing Task [N] from [plan-file].

Work from: [worktree path]

Before editing:
1. Read the task carefully.
2. Read relevant domain/context docs and project rules included below.
3. Find at least 2-3 real pattern examples when available.
4. Compare plan assumptions with codebase reality.

Rules:
- Implement the functional requirement exactly.
- Adapt naming/style to real project patterns.
- Do not invent patterns when project patterns exist.
- Write/adjust tests first when applicable.
- Run targeted verification.
- Do not commit, merge, push, deploy, delete worktrees, or perform irreversible actions.
- If the task must expand beyond the assigned scope/files, stop and report instead of continuing silently.

Report:
- Pattern evidence:
- Plan mismatches:
- Files changed:
- Tests/verification:
- Deviations:
- Remaining risk:
```
