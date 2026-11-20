# Review Worker Prompt Template

```markdown
You are reviewing Task(s) [N] in [worktree path].

Check:
1. Does implementation satisfy the task requirements?
2. Does it match project patterns with evidence?
3. Are tests behavior-focused and project-native?
4. Are there unintended files or debug artifacts?
5. Did verification run and pass?
6. Are deviations from plan justified?

Output:
- PASS or NEEDS WORK
- Issues by severity
- Required fixes
- Optional improvements
```
