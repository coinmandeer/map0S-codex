import { GAME_MANIFESTS } from "../product/registry";
import { getMapStore } from "../store/mapStore";
import { useMapStoreSnapshot } from "../store/useMapStoreSnapshot";
import { Icon, Popover, Switch } from "../ui/kit";
import { st } from "../statistics/labels";

/** The modular world/game switcher.
 *
 *  More than one game can be active over the same avatar and render loop; the focused one owns
 *  the HUD title and the input focus. Aavegotchi is the default and the only one shipping a full
 *  world today, but the list comes from `GAME_MANIFESTS` so adding a game needs no HUD change. */
export function GameSwitcher() {
  const store = getMapStore();
  const activeGameIds = useMapStoreSnapshot((s) => s.activeGameIds);
  const focusedGameId = useMapStoreSnapshot((s) => s.focusedGameId);
  const camera = useMapStoreSnapshot((s) => s.gameCameraMode);
  const avatarStyle = useMapStoreSnapshot((s) => s.avatarStyle);

  const setActive = (id: string, on: boolean) => {
    const next = on
      ? [...new Set([...activeGameIds, id])]
      : activeGameIds.filter((gameId) => gameId !== id);
    // The world must keep at least one game; turning the last one off keeps Aavegotchi.
    store.setActiveGames(next.length ? next : ["aavegotchi"], focusedGameId);
  };

  return (
    <div className="game-switcher">
      <div className="game-switcher-tabs" role="tablist" aria-label={st("Svět", "World")}>
        {GAME_MANIFESTS.map((game) => (
          <button
            key={game.id}
            type="button"
            role="tab"
            className="game-switcher-tab"
            data-testid={`game-selector-${game.id}`}
            aria-selected={game.id === focusedGameId}
            onClick={() => store.setFocusedGame(game.id)}
          >
            {game.name}
          </button>
        ))}
      </div>
      <Popover
        title="Nastavení hry"
        side="bottom"
        align="end"
        width={300}
        testId="game-settings"
        trigger={
          <button
            type="button"
            className="game-hud-icon"
            title="Nastavení hry"
            aria-label="Nastavení hry"
            data-testid="game-settings-open"
          >
            <Icon name="tune" size={18} />
          </button>
        }
      >
        <div className="game-settings-body">
          <p className="game-settings-label">{st("Aktivní hry", "Active games")}</p>
          {GAME_MANIFESTS.map((game) => (
            <div className="game-settings-row" key={game.id}>
              <span className="game-settings-name">{game.name}</span>
              <Switch
                label={game.name}
                checked={activeGameIds.includes(game.id)}
                testId={`game-active-${game.id}`}
                onChange={(next) => setActive(game.id, next)}
              />
            </div>
          ))}

          <p className="game-settings-label">{st("Kamera", "Camera")}</p>
          <div className="game-settings-buttons">
            <button
              type="button"
              className="game-settings-chip"
              data-testid="game-camera-follow"
              aria-pressed={camera === "follow"}
              onClick={() => store.setGameCameraMode("follow")}
            >
              {st("Za hráčem", "Follow")}
            </button>
            <button
              type="button"
              className="game-settings-chip"
              data-testid="game-camera-top"
              aria-pressed={camera === "top"}
              onClick={() => store.setGameCameraMode("top")}
            >
              {st("Shora", "Top")}
            </button>
          </div>

          <p className="game-settings-label">{st("Avatar", "Avatar")}</p>
          <div className="game-settings-buttons">
            <button
              type="button"
              className="game-settings-chip"
              data-testid="avatar-gotchi"
              aria-pressed={avatarStyle === "aavegotchi"}
              onClick={() => store.setAvatarStyle("aavegotchi")}
            >
              Gotchi
            </button>
            <button
              type="button"
              className="game-settings-chip"
              data-testid="avatar-cube"
              aria-pressed={avatarStyle === "cube"}
              onClick={() => store.setAvatarStyle("cube")}
            >
              {st("Kostka", "Cube")}
            </button>
          </div>
        </div>
      </Popover>
    </div>
  );
}
