export interface Point2D {
  x: number;
  y: number;
}

export function joystickVector(centre: Point2D, pointer: Point2D, radius: number): Point2D {
  if (!(radius > 0)) return { x: 0, y: 0 };
  const rawX = pointer.x - centre.x;
  const rawY = centre.y - pointer.y;
  const magnitude = Math.hypot(rawX, rawY);
  if (magnitude === 0) return { x: 0, y: 0 };
  const scale = Math.min(1, magnitude / radius) / magnitude;
  return { x: rawX * scale, y: rawY * scale };
}
