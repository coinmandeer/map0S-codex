import type { LayerMode } from "../store/mapStore";
import type { IconName } from "./primitives/Icon";

export const LAYER_MODES: {
  id: LayerMode;
  label: string;
  shortLabel: string;
  icon: IconName;
  testId: string;
}[] = [
  { id: "poi", label: "Mapa a místa", shortLabel: "Mapa", icon: "pin", testId: "mode-poi" },
  {
    id: "discover",
    label: "Objevuj",
    shortLabel: "Objevuj",
    icon: "compass",
    testId: "mode-discover"
  },
  { id: "game", label: "Hra", shortLabel: "Hra", icon: "gamepad", testId: "mode-game" },
  { id: "mine", label: "Moje", shortLabel: "Moje", icon: "bookmark", testId: "mode-mine" },
  { id: "weather", label: "Počasí", shortLabel: "Počasí", icon: "cloud", testId: "mode-weather" }
];
