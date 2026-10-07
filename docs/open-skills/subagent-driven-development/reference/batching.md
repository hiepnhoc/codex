# Batching Policy

Parallelize only when all are true:

- tasks are independent
- tasks are adjacent or naturally grouped
- tasks touch separate files or safe non-overlapping areas
- requirements are clear
- each worker can verify locally
- merge conflicts are unlikely
- batch size is at most 3 workers/tasks

Do not batch:

- migrations
- public API changes
- security/permission changes
- shared core abstractions
- tasks with dependency order
- tasks after the previous batch had unresolved review failures

Review batched tasks as a group after all complete.
