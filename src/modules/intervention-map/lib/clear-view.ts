// Keeping a point on the map out from under the cards that sit over it, such as the legend.

export interface ScreenPoint {
  x: number;
  y: number;
}

// A card's box, in the map's own pixels: 0, 0 is the map's top left corner.
export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// How far a point has to move to be clear of the cards: the shortest shift up, down, left or right that
// leaves it in view and under none of them, with the margin to spare all round. Null when it's already
// clear, or when no single shift clears it. Panning the map by the opposite moves it there.
export function shiftToClear(point: ScreenPoint, covers: ScreenBox[], size: ScreenPoint, margin: number): ScreenPoint | null {
  const under = (at: ScreenPoint) =>
    covers.find((box) => at.x > box.left - margin && at.x < box.right + margin && at.y > box.top - margin && at.y < box.bottom + margin);
  const inView = (at: ScreenPoint) => at.x >= margin && at.x <= size.x - margin && at.y >= margin && at.y <= size.y - margin;

  const cover = under(point);
  if (!cover) return null;
  const shifts: ScreenPoint[] = [
    { x: 0, y: cover.top - margin - point.y },
    { x: 0, y: cover.bottom + margin - point.y },
    { x: cover.left - margin - point.x, y: 0 },
    { x: cover.right + margin - point.x, y: 0 },
  ].sort((a, b) => Math.abs(a.x) + Math.abs(a.y) - (Math.abs(b.x) + Math.abs(b.y)));

  for (const shift of shifts) {
    const moved = { x: point.x + shift.x, y: point.y + shift.y };
    if (inView(moved) && !under(moved)) return shift;
  }
  return null;
}
