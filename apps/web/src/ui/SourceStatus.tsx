import { RELEASED_PLACE_SOURCES } from "@mapos/layer-sdk";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { SourceIconStrip } from "./primitives";

/** Store-connected view of `SourceIconStrip`. Rendered both in the places panel header and as
 *  a floating strip over the map, so a user watching the map still sees which source is still
 *  arriving without opening any panel. */
export function SourceStatus({
  testId,
  floating = false
}: {
  testId?: string;
  floating?: boolean;
}) {
  const sourceStatus = useMapStoreSnapshot((s) => s.sourceStatus);
  const poiSources = useMapStoreSnapshot((s) => s.poiSources);
  const sources = RELEASED_PLACE_SOURCES.filter((source) => poiSources[source.id]).map(
    (source) => ({
      id: source.id,
      label: source.label,
      glyph: source.glyph,
      state: sourceStatus[source.id]?.state ?? "idle",
      count: sourceStatus[source.id]?.count,
      message: sourceStatus[source.id]?.message
    })
  );

  const strip = <SourceIconStrip sources={sources} testId={testId} />;
  return <div className={floating ? "source-strip-floating" : "source-task-status"}>{strip}</div>;
}
