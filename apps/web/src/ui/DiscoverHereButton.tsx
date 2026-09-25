import { emit } from "../lib/events";
import { t } from "../i18n";
import { Icon } from "./kit";

/** The discover mode's standing question, asked from the map itself rather than from inside
 * the panel: it answers "what is here" for wherever the map is centred right now. Shown only
 * while the discover panel is open (the panel toggles the html attribute that shows it). */
export function DiscoverHereButton() {
  return (
    <button
      type="button"
      className="discover-here-btn"
      data-testid="discover-here-fab"
      onClick={() => emit("discover-here")}
    >
      <Icon name="explore" />
      {t("discover.here")}
    </button>
  );
}
