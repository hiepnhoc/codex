---
name: yolo
description: Use when the user wants autonomous no-stop delivery - performs intake, asks one high-quality confirmation if needed, requires worktree isolation, then loops research/design/plan/execute/evaluate up to 3 times.
---

# YOLO

## Meaning

YOLO means autonomous delivery after understanding, not reckless execution.

The agent must understand intent, check project reality, isolate edits, then continue until done or genuinely blocked.

## When to Use

Use when user asks for:

- autonomous implementation
- "do it end to end"
- broad feature delivery
- continue until done
- research/design/plan/execute loop

Do not use when:

- request is a small informational question
- user wants manual checkpoints between phases
- task involves production/destructive/external irreversible actions without approval

## Non-Negotiables

1. Intake before execution.
2. Lightweight code/docs check before asking user.
3. Ask one near-complete confirmation only if needed.
4. Worktree before any repository write.
5. Continue autonomously after intake passes.
6. Route to the correct workflow; autonomous does not always mean feature workflow.
7. Max 3 improvement loops.
8. Never merge/push/deploy/delete production data/create external tickets without explicit approval.

## Intake Gate

Extract:

- goal
- keywords/entities/files
- likely affected areas
- likely product/technical direction
- unknowns
- success criteria
- protected decisions: security, money, credentials, privacy, deployment, destructive data, external accounts

Proceed without asking only if:

- goal is testable
- scope boundaries are clear
- success criteria are inferable
- no protected decision is required

If asking, use proposed answers:

```text
Mình hiểu yêu cầu là: [goal].
Mình thấy trong codebase: [evidence].
Hướng đề xuất: [specific MVP].
Nếu đúng, mình sẽ tạo worktree và verify bằng [checks].
Chọn:
1. Làm theo hướng đề xuất
2. Sửa scope: [alternative]
3. Chỉ research/plan trước
```

## Route Inside YOLO

After intake, classify the autonomous request:

| Request type | YOLO route |
|---|---|
| Bug/failing test/regression/flaky/performance issue | `diagnose` → worktree before persistent test/fix → fix/execute → verify original loop |
| Feature/product change | domain-context → research if needed → brainstorming → writing-plans → execute |
| Refactor/architecture | improve-codebase-architecture → choose candidate if needed → brainstorming → writing-plans → execute |
| Throwaway exploration | prototype in isolated workspace |
| Large distributable plan | writing-plans → to-issues or subagent-driven-development |

YOLO means autonomous continuation after the right route is chosen, not always the feature workflow.

## Workflow

```text
intake
→ using-git-worktrees before repository writes
→ selected route
→ executing-plans/subagent-driven-development when implementation plan exists
→ simplify when behavior works
→ evaluate
→ iterate if gaps remain, max 3 loops
```

## Stop Conditions

Stop and ask only when:

- product/scope decision is ambiguous
- protected action is required
- plan/codebase conflict changes behavior/API/migration/scope
- verification repeatedly fails after focused attempts
- dependency/credential/service access blocks progress

Do not stop for ceremonial approval between normal phases.

## Evaluation Gate

Before reporting success:

- verify saved artifact paths actually exist
- confirm all repository writes happened in the isolated workspace/worktree
- compare result against explicit and inferred success criteria
- run the strongest project-native checks available, or state why they could not run
- ensure no parallel task edited overlapping files without review
- list any remaining gaps instead of calling partial work complete

## Handoff

```markdown
YOLO result:
- Worktree:
- Branch:
- Goal:
- Route:
- What changed:
- Verification:
- Iterations:
- Risks/limitations:
- Needs approval for:
```
