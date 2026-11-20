# Architecture Language

## Module

Anything with an interface and an implementation: function, class, package, slice, service, component.

## Interface

Everything a caller must know to use the module: types, invariants, error modes, ordering, config, lifecycle. Not just the type signature.

## Implementation

The code inside the module.

## Depth

Leverage at the interface.

- Deep module: small/simple interface, substantial useful behavior behind it.
- Shallow module: interface is nearly as complex as implementation.

## Seam

A place behavior can vary without editing callers.

Use "seam", not vague "boundary".

## Adapter

A concrete implementation at a seam.

One adapter often means hypothetical seam. Two adapters often means real seam.

## Leverage

What callers get from the module: more useful behavior with less knowledge.

## Locality

What maintainers get: bugs, changes, and knowledge concentrated in one place.

## Deletion Test

Imagine deleting the module.

- If complexity vanishes, the module was probably pass-through.
- If complexity reappears across many callers, the module was earning its keep.

## Dependency Categories

Use these when deciding whether and how to deepen a module.

### In-process

Pure computation, in-memory state, no I/O. Usually deepenable by merging behavior behind one small interface and testing through it.

### Local-substitutable

I/O with local stand-ins, such as in-memory filesystem, local database, PGLite, fake clock, or test queue. Prefer tests with the local stand-in instead of exposing extra public seams.

### Remote but owned

Your own service across a network/process boundary. Define a port at the seam; production uses HTTP/gRPC/queue adapter, tests use in-memory adapter.

### True external

Third-party services you do not control. Inject the dependency and mock/stub only this boundary.

## Seam Discipline

- One adapter = hypothetical seam; two adapters = real seam.
- Internal seams can exist for implementation/testing, but should not leak into the module interface unless callers truly need them.
- The interface is the test surface.
- A seam that only passes data through without concentrating behavior is likely shallow.
