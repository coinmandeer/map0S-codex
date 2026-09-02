export type PresetNavigationKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

export function nextPresetIndex(current: number, key: string, itemCount: number): number | null {
  if (itemCount <= 0 || current < 0 || current >= itemCount) return null;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  if (key === "ArrowLeft") return Math.max(0, current - 1);
  if (key === "ArrowRight") return Math.min(itemCount - 1, current + 1);
  return null;
}
