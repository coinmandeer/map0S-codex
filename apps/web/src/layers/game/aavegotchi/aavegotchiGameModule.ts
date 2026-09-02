import type { GameRuntimeContext, GameRuntimeModule } from "../gameRegistry";
import { gameById } from "../../../product/registry";

export function createAavegotchiGameModule(_context: GameRuntimeContext): GameRuntimeModule {
  const manifest = gameById("aavegotchi");
  if (!manifest) throw new Error("Aavegotchi manifest is missing");
  let lastPosition: { lng: number; lat: number } | null = null;
  let timeCursor = new Date().toISOString();
  return {
    manifest,
    onPlayerPosition(position) {
      lastPosition = position;
    },
    onTimeCursor(cursor) {
      timeCursor = cursor;
    },
    textState() {
      return { namespace: "aavegotchi", lastPosition, timeCursor };
    },
    destroy() {
      lastPosition = null;
    }
  };
}
