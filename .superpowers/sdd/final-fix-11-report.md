# Final fix 11 report

## Change

- Captured transform-request ownership at invocation time and records asynchronous transformed URLs only on the same request objects while they remain current.
- Added `@2x.json` retina sprite matching.
- Distinguished a settled, committed style-overlay update failure from an in-flight update: restored the prior overlay definition, prepared style, and state; emitted one fatal owner error; and scheduled the prior composite recovery.

## Validation

- `bunx vitest run --silent='passed-only' src/map/maplibre-service-manager.test.ts` — 169 passing.
- `pnpm run typecheck` — passed.
