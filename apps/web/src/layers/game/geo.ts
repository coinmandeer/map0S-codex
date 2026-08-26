export interface Coordinates {
  latitude: number;
  longitude: number;
}

export function offsetCoordinates(
  current: Coordinates,
  eastMeters: number,
  northMeters: number
): Coordinates {
  const latRad = (current.latitude * Math.PI) / 180;
  const dLat = northMeters / 110540;
  const dLng = eastMeters / (111320 * Math.cos(latRad));
  return {
    latitude: current.latitude + dLat,
    longitude: current.longitude + dLng
  };
}
