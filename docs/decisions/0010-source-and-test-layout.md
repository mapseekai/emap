# ADR 0010 — Organize source by responsibility and tests by scope

Status: accepted on `refactor/cordis-native`.

## Context

After the native Cordis migration, `src/` still exposed more than twenty first-level directories (`map`, `core`, `services`, `providers`, `plugins`, `source`, `renderer`, `duckdb`, and others). The architecture was logically layered but the filesystem did not communicate those layers, so ownership and dependency direction were difficult to infer.

The test tree had the same problem. Unit tests were mostly colocated, but cross-module regression, build, browser, type-contract, and integration suites were also stored under `src/`. At least 29 `src/**/*.test.ts` files had no same-name implementation file, making the unit/integration boundary implicit.

## Decision

Use exactly six first-level source responsibility zones:

```text
src/
├── domain/
├── engine/
├── runtime/
├── integrations/
├── ui/
├── shared/
└── index.ts
```

`domain` owns GIS data/model rules, `engine` owns the hot execution/rendering path, `runtime` owns Cordis composition, `integrations` owns third-party boundaries, `ui` owns browser controls/presentation, and `shared` owns cross-layer declarations only.
The conceptual plugin roles remain Kernel/Service/Provider/Feature/Capability, but those roles no longer determine first-level folders. Cordis is the kernel; service contracts and composition live under `runtime`, built-in workspace providers under `engine/providers`, and optional/provider-specific bridges under `integrations`.

Unit tests follow one mechanical rule:

```text
path/to/foo.ts
path/to/foo.test.ts
```

A production implementation may have zero or one colocated unit test, never multiple differently named unit-test files. A `src/**/*.test.ts` file must have the exact implementation sibling. Type-level contracts are not unit tests and live in `test/types/`.

All multi-module tests live outside `src` under the root `test/` tree. `test/integration/` owns integration/regression scenarios; `test/browser/`, `test/build/`, `test/docs/`, `test/examples/`, and `test/security/` retain their specialized scopes.

## Enforcement

`pnpm run test-layout:check` checks colocated naming, duplicate test ownership, and rejects integration/audit/type-contract naming under `src`. `pnpm run typecheck:contracts` compiles `test/types/` separately. Both are mandatory parts of `docs:verify` and `release:verify`.

`architecture:check` uses the six-zone source tree when building the import graph. Public package subpaths stay unchanged (`/context`, `/services`, `/providers`, `/plugins`, `/presets`, `/ai`, `/maplibre`, `/arrow`, `/duckdb`), so filesystem organization does not become public import syntax.

## Consequences

- Contributors can identify ownership from the first two path segments.
- Cordis/runtime concerns are visually separated from engine hot paths and GIS domain objects.
- Third-party dependencies have explicit integration boundaries.
- Unit tests are locally discoverable and have one owner; broad regressions no longer masquerade as unit tests.
- Internal source paths changed extensively. These are not supported public imports; documented package subpaths remain the compatibility boundary.
- Historical ADRs and migration records may mention old paths as historical facts, but current guidance must point to this ADR and the architecture guide.
