import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { worldRuntime } from "./runtime";

const ActionBar = lazy(() =>
  import("./WorldHud").then((module) => ({ default: module.WorldActionBar }))
);
const SocialOverlay = lazy(() =>
  import("./WorldSocial").then((module) => ({ default: module.WorldSocialOverlay }))
);

/** The transport bridge stays mounted; heavyweight UI loads only when its feature is used. */
export function WorldUiBoundary() {
  const game = useMapStoreSnapshot((state) => state.mode === "game");
  const socialOpen = useSyncExternalStore(
    worldRuntime.subscribe,
    () => worldRuntime.get().socialOpen,
    () => false
  );
  const [socialVisited, setSocialVisited] = useState(false);
  useEffect(() => {
    if (socialOpen) setSocialVisited(true);
  }, [socialOpen]);
  // Keep a visited panel mounted so closing it still clears its map filter and preserves tabs.
  return (
    <Suspense fallback={null}>
      {game && <ActionBar />}
      {(socialOpen || socialVisited) && <SocialOverlay />}
    </Suspense>
  );
}
