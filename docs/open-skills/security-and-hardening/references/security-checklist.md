# Security Verification Checklist

Apply only the sections relevant to the changed trust boundaries. Security-sensitive product decisions still require explicit approval.

- [ ] Identify assets, actors, trust boundaries, entry points, and abuse cases.
- [ ] Validate and normalize untrusted input at the boundary.
- [ ] Use parameterized data access and safe subprocess/path handling.
- [ ] Authenticate identity and authorize every protected action/object separately.
- [ ] Fail closed; avoid privilege escalation, insecure defaults, and information leaks.
- [ ] Protect secrets in approved stores; never log or commit credentials/tokens.
- [ ] Review session, cookie, CSRF, CORS, upload, redirect, and rate-limit behavior when applicable.
- [ ] Encrypt sensitive data in transit and at rest according to project policy.
- [ ] Add negative/abuse tests at the highest stable seam.
- [ ] Verify security headers and production configuration where relevant.
- [ ] Record residual risk, rollout/rollback implications, and decisions needing human approval.

## Dependency and Supply-Chain Gate

- [ ] Locate the installation boundary that owns the dependency graph and authoritative lockfile.
- [ ] Confirm package-manager metadata, lockfile, and CI commands agree; stop on competing lockfiles at one boundary.
- [ ] Use the pinned manager's frozen/immutable install command.
- [ ] For unfamiliar packages, disable lifecycle/install scripts before first execution.
- [ ] Inspect exact package/version scripts and approve only the minimum required exceptions through the manager's native policy.
- [ ] Never run forced audit remediation automatically; review the proposed dependency/lockfile diff and changelogs.
- [ ] Triage known advisories by reachability across runtime, build, test, and deployment paths.
- [ ] Review ownership, maintenance, release age, provenance/signatures when available, transitive graph, and typosquatting.
- [ ] Re-run a clean immutable install and project-native tests/build after dependency changes.
- [ ] Document deferred findings with evidence, owner, mitigation, and review date.

Package-manager defaults change. Consult the pinned version's official documentation before relying on install-script or approval behavior.

OWASP categories are a prompt, not proof. Verification must match the actual system and threat model.
