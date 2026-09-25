interface GoogleRuntime {
  maps: { importLibrary(name: "places"): Promise<unknown> };
}
type GoogleWindow = Window & {
  google?: GoogleRuntime;
  maposGooglePlacesReady?: () => void;
};
let loading: Promise<void> | undefined;

/** Called only by the explicit Google action, after the server's free-capacity gate. */
export function loadGooglePlaces(publicKey: string): Promise<void> {
  if (loading) return loading;
  const host = window as GoogleWindow;
  loading = (async () => {
    if (!host.google?.maps.importLibrary) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        const timer = window.setTimeout(() => fail(), 20_000);
        const cleanup = () => {
          window.clearTimeout(timer);
          delete host.maposGooglePlacesReady;
        };
        const fail = () => {
          cleanup();
          script.remove();
          reject(new Error("Google se nepodařilo načíst. Zkuste běžné hledání."));
        };
        host.maposGooglePlacesReady = () => {
          cleanup();
          resolve();
        };
        const url = new URL("https://maps.googleapis.com/maps/api/js");
        url.search = new URLSearchParams({
          key: publicKey,
          loading: "async",
          callback: "maposGooglePlacesReady",
          v: "weekly",
          language: "cs"
        }).toString();
        script.src = url.toString();
        script.async = true;
        script.onerror = fail;
        document.head.append(script);
      });
    }
    if (!host.google) throw new Error("Google není dostupný.");
    await host.google.maps.importLibrary("places");
  })().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

/** Only coordinates leave the attributed component. No names, reviews or photos enter AI/cache. */
export function googleSelectionCoordinates(event: Event): { lng: number; lat: number } | null {
  const place = (event as Event & { place?: { location?: { lat(): number; lng(): number } } })
    .place;
  try {
    const lat = place?.location?.lat();
    const lng = place?.location?.lng();
    return typeof lat === "number" &&
      typeof lng === "number" &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180
      ? { lng, lat }
      : null;
  } catch {
    return null;
  }
}
