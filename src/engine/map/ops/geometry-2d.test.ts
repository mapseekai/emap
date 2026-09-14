import { describe, expect, it } from 'vitest';
import { SegmentConflictIndex, shoelaceArea, type SegmentPair } from './geometry-2d';

describe('shoelaceArea', () => {
  it('returns signed area for open and closed rings', () => {
    expect(
      shoelaceArea([
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ]),
    ).toBe(12);
    expect(
      shoelaceArea([
        [0, 0],
        [0, 3],
        [4, 3],
        [4, 0],
        [0, 0],
      ]),
    ).toBe(-12);
  });
});

describe('SegmentConflictIndex', () => {
  const square: SegmentPair[] = [
    [
      [0, 0],
      [4, 0],
    ],
    [
      [4, 0],
      [4, 4],
    ],
    [
      [4, 4],
      [0, 4],
    ],
    [
      [0, 4],
      [0, 0],
    ],
  ];

  it('accepts a clean closed ring (adjacent and wrap pairs exempt)', () => {
    expect(new SegmentConflictIndex([square]).hasConflict()).toBe(false);
  });

  it('detects a self-crossing closed ring', () => {
    const bowtie: SegmentPair[] = [
      [
        [0, 0],
        [4, 4],
      ],
      [
        [4, 4],
        [4, 0],
      ],
      [
        [4, 0],
        [0, 4],
      ],
      [
        [0, 4],
        [0, 0],
      ],
    ];
    expect(new SegmentConflictIndex([bowtie]).hasConflict()).toBe(true);
  });

  it('detects conflicts across rings but not between a contained hole', () => {
    const hole: SegmentPair[] = [
      [
        [1, 1],
        [2, 1],
      ],
      [
        [2, 1],
        [2, 2],
      ],
      [
        [2, 2],
        [1, 2],
      ],
      [
        [1, 2],
        [1, 1],
      ],
    ];
    expect(new SegmentConflictIndex([square, hole]).hasConflict()).toBe(false);
    const crossingHole: SegmentPair[] = [
      [
        [1, 1],
        [5, 1],
      ],
      [
        [5, 1],
        [5, 2],
      ],
      [
        [5, 2],
        [1, 2],
      ],
      [
        [1, 2],
        [1, 1],
      ],
    ];
    expect(new SegmentConflictIndex([square, crossingHole]).hasConflict()).toBe(true);
  });

  it('detects collinear overlap between non-adjacent segments', () => {
    const overlap: SegmentPair[] = [
      [
        [0, 0],
        [4, 0],
      ],
      [
        [4, 0],
        [4, 2],
      ],
      [
        [4, 2],
        [0, 2],
      ],
      [
        [0, 2],
        [0, 0],
      ],
      [
        [2, 0],
        [6, 0],
      ],
    ];
    expect(new SegmentConflictIndex([overlap], false).hasConflict()).toBe(true);
  });

  it('does not exempt the first/last pair for open polylines', () => {
    const spike: SegmentPair[] = [
      [
        [0, 0],
        [2, 0],
      ],
      [
        [2, 0],
        [2, 2],
      ],
      [
        [2, 2],
        [0.5, 0],
      ],
    ];
    expect(new SegmentConflictIndex([spike], false).hasConflict()).toBe(true);
    expect(new SegmentConflictIndex([spike], true).hasConflict()).toBe(false);
  });

  it('conflictsWithAny applies no exemptions and filters bbox near-misses', () => {
    const index = new SegmentConflictIndex([square]);
    expect(
      index.conflictsWithAny([
        [
          [1, -1],
          [1, 1],
        ],
      ]),
    ).toBe(true);
    expect(
      index.conflictsWithAny([
        [
          [0.5, -1],
          [3.5, -1],
        ],
      ]),
    ).toBe(false);
    expect(
      index.conflictsWithAny([
        [
          [4, 0],
          [4, 4],
        ],
      ]),
    ).toBe(true);
  });

  it('handles empty and degenerate inputs', () => {
    expect(new SegmentConflictIndex([]).hasConflict()).toBe(false);
    expect(
      new SegmentConflictIndex([
        [
          [
            [0, 0],
            [1, 1],
          ],
        ],
      ]).hasConflict(),
    ).toBe(false);
    expect(new SegmentConflictIndex([square]).conflictsWithAny([])).toBe(false);
  });

  describe('allowRingTouching', () => {
    const relaxed = (rings: SegmentPair[][]) =>
      new SegmentConflictIndex(rings, true, { allowRingTouching: true }).hasConflict();

    it('exempts a hole vertex touching the shell edge interior', () => {
      // GEOS-valid tangent contact: hole vertex (4,1) lies on shell edge (4,0)-(4,4)
      const hole: SegmentPair[] = [
        [
          [4, 1],
          [3, 1],
        ],
        [
          [3, 1],
          [3, 2],
        ],
        [
          [3, 2],
          [4, 1],
        ],
      ];
      expect(new SegmentConflictIndex([square, hole]).hasConflict()).toBe(true);
      expect(relaxed([square, hole])).toBe(false);
    });

    it('exempts a hole touching the shell at a single shared vertex', () => {
      // Hole meets the shell corner (4,4); both hole rays stay inside the
      // shell's interior sector → tangent, not a crossing.
      const hole: SegmentPair[] = [
        [
          [4, 4],
          [3, 3],
        ],
        [
          [3, 3],
          [3.5, 3.8],
        ],
        [
          [3.5, 3.8],
          [4, 4],
        ],
      ];
      expect(new SegmentConflictIndex([square, hole]).hasConflict()).toBe(true);
      expect(relaxed([square, hole])).toBe(false);
    });

    it('still flags proper crossings between rings', () => {
      const crossingHole: SegmentPair[] = [
        [
          [1, 1],
          [5, 1],
        ],
        [
          [5, 1],
          [5, 2],
        ],
        [
          [5, 2],
          [1, 2],
        ],
        [
          [1, 2],
          [1, 1],
        ],
      ];
      expect(relaxed([square, crossingHole])).toBe(true);
    });

    it('still flags a collinear edge shared by two rings', () => {
      // Hole shares the sub-segment x∈[1,3] of the shell's bottom edge.
      const hole: SegmentPair[] = [
        [
          [1, 0],
          [3, 0],
        ],
        [
          [3, 0],
          [3, 1],
        ],
        [
          [3, 1],
          [1, 1],
        ],
        [
          [1, 1],
          [1, 0],
        ],
      ];
      expect(relaxed([square, hole])).toBe(true);
    });

    it('still flags vertex contacts where the rings interleave', () => {
      // ring1 rays at (4,4): 0° and 90°; ring2 rays: 45° (inside) and
      // ~219° (outside) → the rings cross at the shared vertex. ring2's
      // vertex (5,5) also touches ring1's hypotenuse — a benign tangent.
      const ring1: SegmentPair[] = [
        [
          [4, 4],
          [6, 4],
        ],
        [
          [6, 4],
          [4, 6],
        ],
        [
          [4, 6],
          [4, 4],
        ],
      ];
      const ring2: SegmentPair[] = [
        [
          [4, 4],
          [5, 5],
        ],
        [
          [5, 5],
          [2.9, 3.1],
        ],
        [
          [2.9, 3.1],
          [4, 4],
        ],
      ];
      expect(relaxed([ring1, ring2])).toBe(true);
    });

    it('keeps same-ring self-touching strict', () => {
      // Figure-8 shell: segments 0 and 2 share the vertex (2,2) without being adjacent.
      const pinched: SegmentPair[] = [
        [
          [0, 0],
          [4, 0],
        ],
        [
          [4, 0],
          [2, 2],
        ],
        [
          [2, 2],
          [4, 4],
        ],
        [
          [4, 4],
          [0, 4],
        ],
        [
          [0, 4],
          [2, 2],
        ],
        [
          [2, 2],
          [0, 0],
        ],
      ];
      expect(relaxed([pinched])).toBe(true);
    });
  });
});
