# Examples catalog redesign

## Status

Approved by the user on 2026-08-10. This design replaces the examples catalog
presentation only. It does not redesign individual example pages.

## Goal

Turn the current 54-card flat grid into a compact technical catalog that helps
people locate an example either by category or by searching its metadata, while
following `/Users/zwishing/code/mapseek-ui/DESIGN.md`.

Success means that the catalog:

- exposes all example categories and their counts without requiring a long scan;
- filters examples by title, description, id, tags, and API identifiers;
- preserves every existing direct example route and locale switch;
- remains usable with a keyboard and at desktop, tablet, and mobile widths;
- does not alter the layout or styles of individual example pages.

## Information architecture

The page is a technical catalog rather than a marketing landing page.

1. A compact 56px utility header contains the Emap mark, `Emap / Examples`,
   the total example count, and the locale control.
2. A short title band contains the eyebrow, localized title and introduction,
   plus the catalog search field.
3. The desktop content area uses a two-column shell:
   - a sticky category rail with an `All` item and localized category labels;
   - a main results area grouped by category.
4. Each category group has a heading, a result count, and a compact card grid.
5. Search results keep the category grouping so users retain context.

The category rail is the complete-browsing path. Search is the direct-lookup
path. Selecting `All` shows every group; selecting a category shows only that
group. Entering a query filters within the selected category.

## Search behavior

Search is client-side and case-insensitive. Leading and trailing whitespace is
ignored. A query matches localized title and description plus the stable id,
tags, and API identifiers from `ExampleDefinition`.

The results summary reports the number of visible examples. A clear action is
shown whenever a query is active. If nothing matches, the results area presents
a concise empty state and a clear-search action. Search does not modify the URL
or introduce persisted state in this version.

Changing locale re-renders the catalog in the existing way while preserving the
selected category and query. Search is applied against the newly selected
locale's title and description plus the locale-independent metadata.

## Example cards

Cards are square, bordered technical surfaces. The category is communicated by
the group heading and is not repeated on every card.

Each card contains:

- the localized example title;
- a concise localized description;
- up to two API identifiers when present, with a compact overflow count;
- a directional arrow that reinforces navigation.

The complete card is a direct link to the existing example route. Hover and
keyboard focus use the primary green for border/focus emphasis and a subtle
primary surface tint. There is no repeated filled `Open example` button, no
shadow, and no rounded container.

## Visual system

The catalog follows the Mapseek UI standard:

- Geist Mono Variable with the documented monospace fallbacks;
- neutral OKLCH page and card surfaces;
- primary green only for action, focus, selection, and active filtering;
- zero-radius panels, cards, inputs, and buttons;
- 1px borders, no decorative shadows, gradients, glass, or blur;
- 4px spacing rhythm and the 24/28/32/36/40px control-height scale;
- compact type hierarchy with a 32px maximum page heading on desktop.

The shell may grow to a 1440px maximum width so the catalog makes useful use of
large displays. Density comes from structure and alignment, not smaller than
readable text.

## Responsive behavior

- At 1024px and wider, show the sticky category rail and a three-column card
  grid when space permits.
- From 640px through 1023px, replace the rail with a compact category select and
  use a two-column card grid.
- Below 640px, stack the title and controls, use one card column, and retain a
  minimum 40px target for primary interactive controls.

No viewport should require horizontal scrolling. The search field, locale
control, category control, and complete card links must remain keyboard
reachable with visible focus indicators.

## Implementation boundaries

Expected implementation files:

- `packages/examples/src/catalog.ts` for catalog structure, filtering, locale
  preservation, and card content;
- `packages/examples/src/styles.css` for catalog-scoped styling only;
- `test/docs/example-catalog.test.ts` for the catalog interaction contract.

Existing shared styles for `.example-page`, individual example HTML files,
example routes, engine code, and documentation output are out of scope. New CSS
must remain under catalog-specific selectors so individual examples are not
visually affected.

## Accessibility and states

- Search has a persistent localized label or accessible name.
- Category selection uses native button/select semantics with `aria-current` or
  equivalent selected-state communication.
- The results summary is exposed as a polite live region.
- Focus order follows the visual order: header controls, search, category
  navigation, then visible cards.
- Empty results are expressed with text and structure, never color alone.
- Card links retain descriptive accessible names in both locales.

## Verification

Automated verification covers:

- default Chinese render and English locale switching;
- category counts and category filtering;
- search across localized text, id, tags, and API identifiers;
- combined category and search filtering;
- clear-search and empty-result behavior;
- preservation of every direct example href.

Run the focused catalog tests, the examples build, and TypeScript checks defined
by the repository development guide. Then inspect the live catalog in the
browser at desktop, intermediate, and mobile widths, including hover, keyboard
focus, locale switching, category filtering, search, and empty states.
