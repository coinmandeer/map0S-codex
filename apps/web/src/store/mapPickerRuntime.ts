import { MapPickerControllerRegistry } from "../search/mapPicker";
import { safeBrowserErrorFields } from "../lib/safeError";

/** The single runtime callback registry paired with ShellState's data-only picker session. */
export const mapPickerControllers = new MapPickerControllerRegistry({
  onCallbackError(error) {
    console.error("Map picker owner callback failed", safeBrowserErrorFields(error));
  }
});
