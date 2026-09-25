import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { st } from "../statistics/labels";
import { IconButton } from "../ui/kit";

/** The same preference controls the tile boundaries and Discover's region outlines. */
export function AreaControls() {
  const store = getMapStore();
  const mode = useMapStoreSnapshot((state) => state.mode);
  const experience = useMapStoreSnapshot((state) => state.experienceId);
  const enabled = useMapStoreSnapshot((state) => state.boundariesEnabled);
  const area = useMapStoreSnapshot((state) => state.areaSelection);
  if (experience === "global" || mode === "game" || (mode !== "discover" && !area)) return null;

  return (
    <IconButton
      icon="grid_on"
      label={st("Hranice oblastí", "Borders")}
      active={enabled}
      aria-pressed={enabled}
      testId="borders-toggle"
      onClick={() => {
        store.setBoundariesEnabled(!enabled);
        store.setBoundaryLevel("auto");
      }}
    />
  );
}
