import { describe, expect, it } from 'vitest';
import { inferEffect } from './_runner';

describe('inferEffect (PR-10)', () => {
  it.each([
    // shape-count: feature added / removed / reordered
    ['-target X -clip source=Y', 'shape-count'],
    ['-target X -erase source=Y', 'shape-count'],
    ['-target X -dissolve foo', 'shape-count'],
    ['-target X -explode', 'shape-count'],
    ['-target X -filter "this.pop > 100"', 'shape-count'],
    ['-target X -drop', 'shape-count'],
    ['-target X -buffer 5', 'shape-count'],
    ['-target X -mosaic', 'shape-count'],
    ['-target X,Y -union', 'shape-count'],

    // topology-only: arc storage rebuilt, feature ids stable
    ['-target X -clean', 'topology-only'],
    ['-target X -snap', 'topology-only'],
    ['-target X -simplify 10%', 'topology-only'],

    // attribute-only: only data table changes
    ['-target X -each "this.x = 1"', 'attribute-only'],
    ['-target X -join data.csv keys=k,s', 'attribute-only'],
    ['-target X -rename-fields A=B', 'attribute-only'],
    ['-target X -filter-fields a,b', 'attribute-only'],
    ['-target X -sort foo', 'attribute-only'],

    // crs-only: coords reprojected
    ['-target X -proj EPSG:3857', 'crs-only'],
    ['-target X -project EPSG:3857', 'crs-only'],

    // strongest-effect rule: shape-count wins over the rest
    ['-target X -each "this.x = 1" -dissolve foo', 'shape-count'],
    ['-target X -sort foo -clean', 'topology-only'],

    // unknown command falls through to `unknown` (clear selection)
    ['-target X -wat', 'unknown'],
    ['-target X -fancy-new-op foo', 'unknown'],

    // empty / target-only ⇒ unknown (the runner won't invoke this with no
    // action anyway, but exercise the path)
    ['', 'unknown'],
    ['-target X', 'unknown'],
  ])('infers effect for %p as %p', (cmd, expected) => {
    expect(inferEffect(cmd)).toBe(expected);
  });
});
