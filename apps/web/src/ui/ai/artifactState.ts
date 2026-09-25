import { isMapResultArtifact, type MapResultArtifact } from "@mapos/layer-sdk";
let artifacts: MapResultArtifact[] = [];
const listeners = new Set<() => void>();
export const artifactSnapshot = () => artifacts;
export function setArtifacts(next: readonly MapResultArtifact[]) {
  if (next.length > 30 || !next.every(isMapResultArtifact))
    throw new Error("Neplatný mapový výsledek");
  artifacts = structuredClone([...new Map(next.map((a) => [a.id, a])).values()]);
  listeners.forEach((f) => f());
}
export function subscribeArtifacts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
