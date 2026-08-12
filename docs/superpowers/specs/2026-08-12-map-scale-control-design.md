# Map scale control design

## Goal

Add a QGIS/ArcGIS-style scale control to Emap. It must show a readable distance
bar and a nominal `1:N` scale for every Earth-based CRS that Emap can resolve
and transform. Geographic CRSs, including EPSG:4326, must display metres rather
than degrees.

The control also exposes the existing Web Mercator zoom level when that value
has an unambiguous meaning. It must not invent a zoom level for arbitrary map
projections.

## Scope and limits

This feature supports the CRS subset that Emap's CRS resolver and `mproj`
runtime can parse and transform. That covers the normal EPSG and custom Proj.4
definitions already supported by Emap. It is deliberately not a claim of full
QGIS/PROJ coverage: `mproj` has no grid-shift datum transformations and lacks
some projections.

For an unknown CRS, a non-Earth CRS, an unsupported projection, or a failed
coordinate transformation, no metric scale or nominal scale is shown. The
control hides its unavailable values rather than presenting plausible but false
numbers.

This change does not add a project-wide unit or ellipsoid settings panel,
multiple visual scale-bar styles, printed-layout support, or a generic zoom
level for non-Web-Mercator projections.

## Public API

`Emap` gains an asynchronous, read-only scale query:

```ts
type ScaleCalculationMethod =
  | 'top'
  | 'center'
  | 'bottom'
  | 'average'
  | 'equator';

interface ScaleMetrics {
  /** Ground distance represented by one CSS pixel at the selected position. */
  metersPerPixel: number;
  /** Exact nominal denominator at the requested CSS DPI. */
  scaleDenominator: number;
  /** Only present when the map CRS is Web Mercator. */
  zoom?: number;
  calculationMethod: ScaleCalculationMethod;
}

interface GetScaleMetricsOptions {
  calculationMethod?: ScaleCalculationMethod; // default: 'center'
  dpi?: number; // default: 96
}

map.getScaleMetrics(options?): Promise<ScaleMetrics | null>;
```

`null` has one precise meaning: Emap cannot calculate a truthful Earth-distance
scale for the current view. It is not an error condition for callers.

`ScaleControl` is exported from the package root and implements the existing
`Control` lifecycle. Its initial options are intentionally small:

```ts
interface ScaleControlOptions {
  units?: 'metric' | 'imperial' | 'dual'; // default: 'metric'
  calculationMethod?: ScaleCalculationMethod; // default: 'center'
  maxWidth?: number; // CSS pixels, default: 140
  dpi?: number; // CSS pixels per inch, default: 96
  showScale?: boolean; // default: true
  showZoom?: boolean; // default: true, Web Mercator only
}
```

It is used like other controls:

```ts
map.addControl(new ScaleControl(), 'bottom-left');
```

The scale denominator is based on CSS pixels. Device pixel ratio is not folded
into the calculation, so a Retina screen does not silently double the reported
scale. Applications needing a calibrated physical scale may explicitly pass
their measured `dpi` value.

## Calculation model

The calculation follows the QGIS idea that local projection scale varies with
position. It is therefore based on the current view, not on a fixed global
metres-per-unit constant.

1. Obtain two horizontally adjacent map coordinates from the viewport at the
   requested screen row. The pair is centered horizontally and separated by one
   CSS pixel.
2. Resolve the active map CRS and transform both coordinates to the matching
   geographic form of that CRS.
3. Measure the two geographic positions with an inverse ellipsoidal geodesic.
   The CRS ellipsoid is used when available; WGS 84 is the documented fallback
   only when the resolved definition supplies no usable ellipsoid parameters.
4. The resulting metre distance is `metersPerPixel`.
5. Calculate the nominal scale denominator as
   `metersPerPixel × dpi / 0.0254`.

The short sample avoids long-line distortion in highly distorted projections.
Coordinates that are not finite, cannot be inverted, or cannot be measured
return no sample.

Calculation positions have these exact meanings:

| Method | Samples |
| --- | --- |
| `top` | one horizontal sample at the top view edge |
| `center` | one horizontal sample at the vertical centre; the default |
| `bottom` | one horizontal sample at the bottom view edge |
| `average` | arithmetic mean of valid top, centre, and bottom samples |
| `equator` | for geographic CRSs only, use the current longitude-per-pixel at latitude 0° |

`equator` follows QGIS's degree-based interpretation. When selected for a
non-geographic CRS, it falls back to `center`; the returned method identifies
the method actually used. If no valid sample remains, the result is `null`.

The CRS resolver and the geographic transformer are cached by CRS signature.
This keeps viewport updates cheap after the first calculation while preserving
the current resolver's handling of EPSG, WKT, PROJJSON, and custom Proj.4 input.

## Scale bar and formatting

The default visual is a compact alternating black-and-white segmented bar:

```text
1:25,000 · Zoom 14
0       100       200 m
|██████|░░░░░░|██████|
```

The bar is normally in the lower-left control position but uses Emap's existing
control placement API, so any corner is supported.

For a target width no larger than `maxWidth`, the control selects the largest
distance that fits from the familiar `1 / 2 / 5 × 10^n` sequence. It shows a
start, midpoint, and end label. The denominator is formatted independently from
the bar distance with grouping (for example, `1:25,000`) and is not snapped to
the bar's nice distance.

`metric` labels use mm, m, or km as appropriate. `imperial` labels use ft or
mi. `dual` keeps one shared bar and appends the equivalent secondary label,
instead of rendering two bars. The first release uses this one standard visual
style; visual-style variants can be added later without changing the metrics
API.

When `showScale` is false, the nominal `1:N` label is omitted. When `showZoom`
is false it is omitted; it is also omitted automatically unless the active CRS
is Web Mercator. The bar remains available whenever metres-per-pixel can be
calculated.

## Control lifecycle and updates

`ScaleControl` owns presentation only. It asks `map.getScaleMetrics()` for the
calculation, so a future status bar or external application can reuse exactly
the same result without reaching into `Viewport`.

On `onAdd`, the control subscribes to `move`, `resize`, and `crschange`. These
events schedule a single refresh with `requestAnimationFrame`; rapid pointer,
pan, or wheel events do not schedule duplicate updates in the same frame. On
`onRemove`, all listeners and a pending animation frame are cancelled.

Scale resolution can be asynchronous when a CRS has not yet been resolved. A
monotonically increasing request revision prevents an old response from
overwriting a newer view. During ordinary movement the previous valid reading
remains visible until the replacement is ready. On `crschange`, the old reading
is cleared first because it belongs to a different coordinate system.

Expected failures are represented by `null` and do not produce repeated console
messages. The element is hidden when neither a scale bar nor an enabled numeric
value can be truthfully rendered. Its accessible label is refreshed with the
visible distance and nominal scale.

## Implementation boundaries

- Add a small geo-level scale calculator responsible for sampling, resolving,
  transforming, and ellipsoidal distance measurement. It must be independent of
  DOM and control classes.
- Add the Emap public query as a thin delegation to that calculator.
- Add `ScaleControl` beside existing controls and reuse the current control
  lifecycle and map event dispatcher.
- Extend the mapshaper adapter only with the focused CRS-to-geographic
  transformation capability needed by the calculator; do not import mapshaper
  outside the adapter boundary.
- Export the control and public types from the package entry point, document it,
  and add it to an existing suitable interactive example.

## Verification

Unit tests cover:

1. EPSG:4326 reports different metres-per-pixel at low and high latitudes for
   the same angular pixel span.
2. EPSG:3857 and a representative UTM CRS agree with independently calculated
   local geodesic distances.
3. A supported custom Proj.4 CRS works, while an unknown CRS, non-Earth CRS,
   invalid transformation, and non-finite coordinates produce `null`.
4. All calculation-position modes, including the non-geographic `equator`
   fallback, have deterministic expected values.
5. Nice-distance selection, metric/imperial/dual formatting, and the 96-DPI
   denominator calculation have focused pure-function tests.
6. The control subscribes and unsubscribes correctly, coalesces refreshes,
   discards stale asynchronous results, and only displays zoom for Web
   Mercator.

Manual verification uses the relevant example to pan, zoom, resize, and change
CRS. The bar must stay readable and update continuously; the displayed metres
must remain plausible in geographic, Web Mercator, and projected datasets.

## Acceptance criteria

- Adding `new ScaleControl()` renders a correctly sized, friendly distance bar
  for EPSG:4326, EPSG:3857, and supported projected CRSs.
- The control's nominal scale derives from local ground distance at 96 CSS DPI,
  with an explicit DPI override.
- Values update correctly across interactions and CRS changes without stale
  coordinates or console noise.
- Unsupported or unknown coordinate systems never show fabricated metric scale,
  scale denominator, or zoom values.
- The public metrics API, control, types, tests, package export, and user
  documentation are present and consistent.
