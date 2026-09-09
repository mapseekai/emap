# Final filter error event fix

## Status
Implemented the boolean-contract error payload: filter evaluation failures now include the render `layerId`, original `filterExpression`, and actual `valueType`.

## Commit
`feat: carry layerId, expression and valueType in filter error events`

## Verification
- RED: `npx vitest run src/map/map.test.ts -t "layer display filter"` failed because the error payload contained only `error`.
- GREEN: `npx vitest run src/map/map.test.ts -t "layer display filter"` — 8 passed.
- `npm run typecheck` — passed.
