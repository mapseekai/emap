## ADDED Requirements

### Requirement: Emap.simplifyLayer
The system SHALL provide `Emap.simplifyLayer({ source, target?, percentage?, interval?, resolution?, method?, weighting?, planar?, keepShapes?, lockBox?, noRepair? }): Promise<boolean>` that runs mapshaper's `-simplify` against either the whole source dataset (default) or one named target layer.

#### Scenario: Percentage threshold
- **WHEN** `simplifyLayer({ source: 's', percentage: 10 })` resolves with `true`
- **THEN** the constructed mapshaper command is `-simplify 10%`

#### Scenario: Percentage threshold (decimal)
- **WHEN** `percentage: 12.5` is supplied
- **THEN** the command embeds `12.5%`

#### Scenario: Interval threshold
- **WHEN** `interval: 250` is supplied
- **THEN** the command appends `interval=250` after `-simplify`

#### Scenario: Resolution threshold
- **WHEN** `resolution: '1000x500'` is supplied
- **THEN** the command appends `resolution=1000x500` after `-simplify`

#### Scenario: Method = dp
- **WHEN** `method: 'dp'` is supplied
- **THEN** the command appends `dp`

#### Scenario: Method = visvalingam
- **WHEN** `method: 'visvalingam'` is supplied
- **THEN** the command appends `visvalingam`

#### Scenario: Method = weighted
- **WHEN** `method: 'weighted'` is supplied
- **THEN** the command appends `weighted`

#### Scenario: weighting coefficient
- **WHEN** `weighting: 0.5` is supplied
- **THEN** the command appends `weighting=0.5`

#### Scenario: planar flag
- **WHEN** `planar: true`
- **THEN** the command appends `planar`

#### Scenario: keep-shapes flag
- **WHEN** `keepShapes: true`
- **THEN** the command appends `keep-shapes`

#### Scenario: lock-box flag
- **WHEN** `lockBox: true`
- **THEN** the command appends `lock-box`

#### Scenario: no-repair flag
- **WHEN** `noRepair: true`
- **THEN** the command appends `no-repair`

#### Scenario: target scoped command
- **WHEN** `target: 'roads'` is supplied alongside `percentage: 10`
- **THEN** the command begins with `-target "roads" -simplify 10%`

#### Scenario: dataset-wide command (no target)
- **WHEN** `target` is omitted
- **THEN** the command begins with `-simplify ...` (no `-target` prefix)

#### Scenario: Missing source returns false
- **WHEN** `source` does not resolve
- **THEN** the promise resolves with `false`
- **AND** no command runs

#### Scenario: Unresolved target returns false
- **WHEN** `target` is supplied and does not resolve to a layer in the source
- **THEN** the promise resolves with `false`

#### Scenario: No threshold returns false
- **WHEN** none of percentage / interval / resolution is supplied
- **THEN** the promise resolves with `false`

#### Scenario: Multiple thresholds return false
- **WHEN** more than one of percentage / interval / resolution is supplied
- **THEN** the promise resolves with `false`

#### Scenario: Out-of-range percentage returns false
- **WHEN** `percentage` is `< 0` or `> 100`
- **THEN** the promise resolves with `false`

#### Scenario: Non-positive interval returns false
- **WHEN** `interval` is `<= 0`
- **THEN** the promise resolves with `false`

#### Scenario: Malformed resolution returns false
- **WHEN** `resolution` does not match `^\d+x\d+$`
- **THEN** the promise resolves with `false`

#### Scenario: Successful simplify is reversible by one undo
- **WHEN** `simplifyLayer(opts)` resolves with `true`
- **THEN** exactly one entry is added to the undo history with label `Simplify <target | source>`
- **AND** `Emap.undo()` once restores the original dataset reference
