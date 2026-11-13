import { describe, expect, it } from 'vitest';
import { shiftToClear } from '../src/modules/intervention-map/lib/clear-view';

// A map 800 by 600, with the legend in its bottom left corner, as on a computer.
const SIZE = { x: 800, y: 600 };
const LEGEND = { left: 12, top: 250, right: 280, bottom: 576 };
const MARGIN = 24;

describe('shiftToClear', () => {
  it('leaves a point that is clear of the legend', () => {
    expect(shiftToClear({ x: 400, y: 300 }, [LEGEND], SIZE, MARGIN)).toBeNull();
    // Just outside the margin counts as clear.
    expect(shiftToClear({ x: LEGEND.right + MARGIN, y: 400 }, [LEGEND], SIZE, MARGIN)).toBeNull();
  });

  it('moves a point under the legend the shortest way out, with the margin to spare', () => {
    // Near the legend's right edge, so right is shortest.
    expect(shiftToClear({ x: 260, y: 450 }, [LEGEND], SIZE, MARGIN)).toEqual({ x: LEGEND.right + MARGIN - 260, y: 0 });
    // Near its top, so up is shortest.
    expect(shiftToClear({ x: 100, y: 270 }, [LEGEND], SIZE, MARGIN)).toEqual({ x: 0, y: LEGEND.top - MARGIN - 270 });
  });

  it('counts a point within the margin of the legend as under it', () => {
    expect(shiftToClear({ x: LEGEND.right + 10, y: 400 }, [LEGEND], SIZE, MARGIN)).toEqual({ x: MARGIN - 10, y: 0 });
  });

  it("never moves a point out of view, but takes the next shortest way", () => {
    // Down and left would leave the map, and right is shorter than up here.
    const shift = shiftToClear({ x: 150, y: 560 }, [LEGEND], SIZE, MARGIN)!;
    expect(shift).toEqual({ x: LEGEND.right + MARGIN - 150, y: 0 });
    // A legend as wide as the map: only up is left.
    const wide = { left: 0, top: 400, right: 800, bottom: 600 };
    expect(shiftToClear({ x: 400, y: 450 }, [wide], SIZE, MARGIN)).toEqual({ x: 0, y: 400 - MARGIN - 450 });
  });

  it('gives up when no single shift clears the point', () => {
    const everything = { left: 0, top: 0, right: 800, bottom: 600 };
    expect(shiftToClear({ x: 400, y: 300 }, [everything], SIZE, MARGIN)).toBeNull();
  });

  it("doesn't move a point from under one card to under another", () => {
    const zoom = { left: 12, top: 12, right: 46, bottom: 90 };
    const tall = { left: 12, top: 110, right: 280, bottom: 576 };
    // Up from under the tall card would land under the zoom buttons, so it goes right.
    expect(shiftToClear({ x: 30, y: 120 }, [zoom, tall], SIZE, MARGIN)).toEqual({ x: tall.right + MARGIN - 30, y: 0 });
  });
});
