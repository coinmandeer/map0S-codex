import { skyAtlasGrid } from "../skyAtlasService.js";
import type { DataSource } from "./types.js";
export const skyAtlas: DataSource = {
  id: "sky-brightness",
  tooLarge: (bbox) =>
    (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) > 250 ? "Přibližte mapu pro model jasu oblohy" : null,
  load: (bbox, _query, signal) => skyAtlasGrid(bbox, signal)
};
