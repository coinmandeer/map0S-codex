/** Display offsets only. Persisted geographic coordinates never change. */
export function pinSpreadOffsets(count: number): Array<[number, number]> {
  if (!Number.isInteger(count) || count < 2 || count > 12) return [];
  const radius = Math.max(42, (count * 38) / (2 * Math.PI));
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
}
