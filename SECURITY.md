# Security

## Expression evaluation policy

Several `MapshaperOps` APIs accept JavaScript expression strings that
mapshaper executes inside its own runner:

- `applyExpression({ expression })`
- `filterFeatures({ expression })`
- `sortFeatures({ expression })`
- `splitLayer({ expression })`
- `joinTable({ where, calc })`
- `mosaicLayer({ calc })`
- ... and any other op that forwards `where=` / `calc=` to mapshaper.

These expressions execute with full access to the JavaScript runtime
(no sandbox). Treating an externally-supplied expression string as data
is a remote code execution vulnerability.

### Default: `'disabled'`

`Emap` defaults `expressionPolicy` to `'disabled'`. Calls that carry a
non-empty expression string return `false` and emit an `error` event
with the message `"<op>: expression evaluation is disabled"`.

### Opting in: `'trusted'`

Apps that load only their own data — and never accept layer config,
filter strings, or join expressions from end users or third-party
sources — can opt in:

```ts
const map = new Emap({ container: 'map', expressionPolicy: 'trusted' });

// or, to flip at runtime
map.setExpressionPolicy('trusted');
```

Set the policy back to `'disabled'` before processing any
externally-sourced strings.

### Breaking change

Prior to this release the default was `'trusted'`. Apps that broke
after upgrading should either:

1. Pass `expressionPolicy: 'trusted'` if all expression strings are
   first-party and audited, or
2. Stop forwarding user-supplied strings to expression-accepting APIs
   and keep the secure default.

## Reporting a vulnerability

Please report security issues via GitHub's "Report a vulnerability"
flow on this repository. Do not open public issues for unpatched
security bugs.
