## HiGa Codex Dev Workflow

Use the engineering skills installed in Codex's global skill root or this
repository's `.agents/skills/` directory.

1. Before coding, choose the narrowest applicable skill route.
2. Default to `daily-dev`; use `diagnose` first for unknown failures.
3. For interactive non-trivial features, establish an approved design with
   `brainstorming` before implementation unless the user explicitly requests an
   autonomous `yolo` flow.
4. Use `writing-plans` for non-trivial sequencing and `executing-plans` for
   implementation.
5. Add API, UI, security, performance, observability, CI, browser, or source
   overlays only when their triggers are present.
6. Require concrete tests, builds, type checks, runtime checks, or equivalent
   evidence before claiming completion.
7. Never expose secrets or perform deployment, publication, destructive work,
   external ticket mutation, or code egress without explicit approval.
8. Keep project-specific facts in repo-local `.agents/skills/` or project docs.

Core principle: plan is input, codebase evidence decides, domain language
matters, and completion requires real verification.
