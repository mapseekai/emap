# Security

emap provides explicit expression policies, validated operation inputs, upload budgets,
and source-version checks. Applications configure these controls for the data and
users they serve.

## Expression evaluation policy

Mapshaper-backed operations support JavaScript expression strings for reviewed,
application-controlled workflows:

- `applyExpression({ expression })`
- `filterFeatures({ expression })`
- `sortFeatures({ expression })`
- `splitLayer({ expression })`
- `joinTable({ where, calc })`
- `mosaicLayer({ calc })`
- Other operations forwarding `where=` or `calc=` to mapshaper.

These expressions execute with the JavaScript runtime's full privileges. Supply
first-party, reviewed expressions and keep externally supplied text in data fields.
An expression supplied by an attacker can execute code with those same privileges.

### Default policy: `'disabled'`

`Emap` starts with `expressionPolicy: 'disabled'`. This policy validates
expression-bearing operations before execution. An operation containing a non-empty
JavaScript expression returns an `OpResult` with `ok: false` and
`error.kind: 'expression-disabled'`, and emits an `error` event containing
`"<op>: expression evaluation is disabled"`. Handle the result to explain the
required configuration to the caller.

### Reviewed application expressions: `'trusted'`

Use `'trusted'` when the application owns and reviews every expression, including
layer configuration, filters, and join calculations:

```ts
const map = await Emap.create({ container: 'map', expressionPolicy: 'trusted' });

// Applications can update the policy at runtime.
map.setExpressionPolicy('trusted');
```

Select `'disabled'` before processing externally supplied expression strings.
For attribute-based styles, use the validated style expression operators described
in the [styling guide](packages/docs/docs/guides/styling.md).

### Upgrade configuration

Earlier releases defaulted to `'trusted'`. When upgrading, choose a policy
explicitly for each workflow:

1. Application-owned, reviewed expressions: set `expressionPolicy: 'trusted'`.
2. Externally supplied configuration: keep `'disabled'` and pass user input through
   the documented data and typed parameter interfaces.

## Upload and asynchronous work

Configure source-size and ZIP expansion budgets for public uploads; the
[file upload guide](packages/docs/docs/recipes/file-upload.md) documents those
parameters. Prepare archives with unique entry basenames. Worker results commit
against the current source identity and geometry/attribute versions, preserving
the active editing state when asynchronous jobs finish.

## Reporting a vulnerability

Send security reports through this repository's GitHub **Report a vulnerability**
flow. Keep details private while maintainers investigate and prepare a fix;
coordinate disclosure after remediation.
