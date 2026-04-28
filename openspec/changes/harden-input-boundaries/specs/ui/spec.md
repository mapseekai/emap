## ADDED Requirements

### Requirement: Control icon assignment is safe by default
UI controls that accept a caller-supplied icon or label option (`DrawFeatureControl.icon`, `NavigationControl` zoom-in / zoom-out / reset labels, `HistoryControl` undo / redo labels) SHALL accept `string | Node`. String values SHALL be assigned via `textContent` (or equivalent text-only DOM API). Node values SHALL be appended via `appendChild` / `replaceChildren`. The controls SHALL NOT pass caller-supplied strings through `innerHTML`.

#### Scenario: String icon renders as text, not HTML
- **WHEN** `new DrawFeatureControl({ type: 'polygon', icon: '<img src=x onerror=alert(1)>' })` is added to a map
- **THEN** the button shows the literal characters `<img src=x onerror=alert(1)>`
- **AND** no `<img>` element exists in the DOM
- **AND** no script executes

#### Scenario: Node icon is appended as DOM
- **WHEN** the caller constructs an `<svg>` element via `document.createElementNS` (or trusted parser) and passes it as `icon`
- **THEN** the SVG element is the icon span's child
- **AND** the caller's pre-built node is responsible for its own escaping

#### Scenario: Default icons remain unicode glyphs
- **WHEN** no `icon` option is supplied
- **THEN** the control falls back to its built-in unicode glyph (e.g. `'✏'`)
- **AND** the rendering pipeline is the same string→textContent path
