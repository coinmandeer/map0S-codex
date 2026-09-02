import { lazy, Suspense, useEffect, useMemo, type ReactNode } from "react";
import type { Fix } from "../../lib/geolocation";
import { getLayerManifestV2 } from "../../layers/registry";
import {
  ShellBrowserHistoryBinding,
  windowShellHistoryPort
} from "../../store/shellBrowserHistory";
import { getShellStore } from "../../store/shellStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { useShellStoreSnapshot } from "../../store/useShellStoreSnapshot";
import { BottomNav } from "../BottomNav";
import { LayerNotices } from "../LayerNotices";
import { ModeBar } from "../ModeBar";
import { SearchHereButton } from "../SearchHereButton";
import { SourceStatus } from "../SourceStatus";
import { TaskCenter } from "../TaskCenter";
import { legendContributions, timelineContributions } from "../footerContributions";
import { ModuleErrorBoundary } from "../primitives/ModuleErrorBoundary";
import { MapFooterStack } from "./MapFooterStack";
import { LegendStack } from "./LegendStack";
import { MapPickerHost } from "./MapPickerHost";
import { ModalHost } from "./ModalHost";
import { RightUtilityDrawer } from "./RightUtilityDrawer";

const PinDetail = lazy(() =>
  import("../PinDetail").then((module) => ({ default: module.PinDetail }))
);
const AuthSheet = lazy(() =>
  import("../AuthSheet").then((module) => ({ default: module.AuthSheet }))
);
const EditLayerSheet = lazy(() =>
  import("../EditLayerSheet").then((module) => ({ default: module.EditLayerSheet }))
);
const RouteSheet = lazy(() =>
  import("../RouteSheet").then((module) => ({ default: module.RouteSheet }))
);
const SettingsSheet = lazy(() =>
  import("../SettingsSheet").then((module) => ({ default: module.SettingsSheet }))
);
const BasemapSheet = lazy(() =>
  import("../BasemapSheet").then((module) => ({ default: module.BasemapSheet }))
);
const GlobalTimeline = lazy(() =>
  import("../GlobalTimeline").then((module) => ({ default: module.GlobalTimeline }))
);
const GameHud = lazy(() => import("../GameHud").then((module) => ({ default: module.GameHud })));
const GameControls = lazy(() =>
  import("../GameControls").then((module) => ({ default: module.GameControls }))
);
const DiscoverPanel = lazy(() =>
  import("../DiscoverPanel").then((module) => ({ default: module.DiscoverPanel }))
);
const PlanningPanel = lazy(() =>
  import("../PlanningPanel").then((module) => ({ default: module.PlanningPanel }))
);
const MinePanel = lazy(() =>
  import("../MinePanel").then((module) => ({ default: module.MinePanel }))
);
const GameSimulationBridge = lazy(() =>
  import("../GameSimulationBridge").then((module) => ({ default: module.GameSimulationBridge }))
);
const CreateWizard = lazy(() =>
  import("../CreateWizard").then((module) => ({ default: module.CreateWizard }))
);

export interface AppChromeProps {
  onFlyToMe: () => Promise<Fix | null>;
}

function AsyncSurface({
  id,
  title,
  children,
  compact = false,
  resetKey,
  onDismiss,
  placement = "inline"
}: {
  id: string;
  title: string;
  children: ReactNode;
  compact?: boolean;
  resetKey?: unknown;
  onDismiss?: () => void;
  placement?: "inline" | "panel" | "drawer" | "modal" | "overlay";
}) {
  return (
    <ModuleErrorBoundary
      moduleId={id}
      title={title}
      compact={compact}
      resetKey={resetKey}
      onDismiss={onDismiss}
      placement={placement}
    >
      <Suspense fallback={<span className="spinner" aria-label={`Načítám: ${title}`} />}>
        {children}
      </Suspense>
    </ModuleErrorBoundary>
  );
}

/** New D06 composition. MapCore deliberately lives in App.tsx, outside this feature branch. */
export function AppShell({ onFlyToMe }: AppChromeProps) {
  const shell = getShellStore();
  const mode = useShellStoreSnapshot((state) => state.mode);
  const leftContext = useShellStoreSnapshot((state) => state.leftContext);
  const rightUtility = useShellStoreSnapshot((state) => state.rightUtility);
  const modal = useShellStoreSnapshot((state) => state.modal);
  const mapPicker = useShellStoreSnapshot((state) => state.mapPicker);
  const toast = useMapStoreSnapshot((state) => state.toast);
  const activeLayers = useMapStoreSnapshot((state) => state.activeLayers);
  const activePlan = useMapStoreSnapshot((state) => state.activePlan);

  useEffect(() => {
    const port = windowShellHistoryPort();
    if (!port) return;
    const binding = new ShellBrowserHistoryBinding(shell, port);
    return () => binding.dispose();
  }, [shell]);

  const footerEntries = useMemo(() => {
    const timeline = timelineContributions(activeLayers, activePlan, getLayerManifestV2);
    const legends = legendContributions(activeLayers, getLayerManifestV2);
    return [
      ...(legends.length
        ? [
            {
              descriptor: {
                id: "global-legends",
                kind: "legend" as const,
                priority: 200
              },
              content: <LegendStack legends={legends} />
            }
          ]
        : []),
      ...(timeline.length
        ? [
            {
              descriptor: {
                id: "global-timeline",
                kind: "timeline" as const,
                priority: timeline[0]!.priority
              },
              content: (
                <AsyncSurface id="timeline" title="Časová osa" compact>
                  <GlobalTimeline />
                </AsyncSurface>
              )
            }
          ]
        : [])
    ];
  }, [activeLayers, activePlan]);

  return (
    <>
      <div className="shell-command-zone chrome top-chrome" data-testid="command-bar-host">
        <ModuleErrorBoundary moduleId="command-bar" title="Horní ovládání" compact>
          <ModeBar onFlyToMe={onFlyToMe} shellManagedUtilities />
        </ModuleErrorBoundary>
      </div>

      <ModuleErrorBoundary
        moduleId="search-here"
        title="Hledání v mapě"
        compact
        placement="overlay"
      >
        <SearchHereButton />
      </ModuleErrorBoundary>
      <ModuleErrorBoundary moduleId="layer-notices" title="Stav vrstev" compact placement="overlay">
        <LayerNotices />
      </ModuleErrorBoundary>
      <ModuleErrorBoundary moduleId="source-status" title="Stav zdrojů" compact placement="overlay">
        <SourceStatus floating testId="map-source-strip" />
      </ModuleErrorBoundary>
      <ModuleErrorBoundary moduleId="task-center" title="Průběh úloh" compact placement="overlay">
        <TaskCenter />
      </ModuleErrorBoundary>
      <ModuleErrorBoundary
        moduleId="bottom-navigation"
        title="Mobilní navigace"
        compact
        placement="overlay"
      >
        <BottomNav />
      </ModuleErrorBoundary>

      <div
        id="left-context-host"
        className="shell-left-context-host"
        data-testid="left-context-host"
        data-context={leftContext.type}
      >
        {leftContext.type === "mode" && leftContext.mode === "planning" && (
          <AsyncSurface
            id="planning-panel"
            title="Plánování"
            resetKey={leftContext.mode}
            onDismiss={() => shell.closeLeftContext()}
            placement="panel"
          >
            <PlanningPanel />
          </AsyncSurface>
        )}
        {leftContext.type === "mode" && leftContext.mode === "discover" && (
          <AsyncSurface
            id="discover-panel"
            title="Objevování a AI souhrn"
            resetKey={leftContext.mode}
            onDismiss={() => shell.closeLeftContext()}
            placement="panel"
          >
            <DiscoverPanel />
          </AsyncSurface>
        )}
        {leftContext.type === "mode" && leftContext.mode === "personal" && (
          <AsyncSurface
            id="personal-panel"
            title="Osobní místa"
            resetKey={leftContext.mode}
            onDismiss={() => shell.closeLeftContext()}
            placement="panel"
          >
            <MinePanel />
          </AsyncSurface>
        )}
        {leftContext.type === "mode" && leftContext.mode === "game" && (
          <AsyncSurface
            id="game-panel"
            title="Herní panel"
            resetKey={leftContext.mode}
            onDismiss={() => shell.closeLeftContext()}
            placement="panel"
          >
            <GameHud />
          </AsyncSurface>
        )}
        {leftContext.type === "feature" && (
          <AsyncSurface
            id="place-detail-extensions"
            title="Detail místa a jeho rozšíření"
            resetKey={`${leftContext.featureRef.layerId}:${leftContext.featureRef.featureId}`}
            onDismiss={() => shell.closeLeftContext()}
            placement="panel"
          >
            <PinDetail />
          </AsyncSurface>
        )}
      </div>

      {mode === "game" && (
        <AsyncSurface id="game-runtime" title="Herní svět" compact>
          <GameSimulationBridge />
        </AsyncSurface>
      )}
      {mode === "game" && (
        <AsyncSurface id="game-controls" title="Ovládání hry" compact>
          <GameControls />
        </AsyncSurface>
      )}

      <ModuleErrorBoundary moduleId="map-footer" title="Spodní informace" compact>
        <MapFooterStack entries={footerEntries} />
      </ModuleErrorBoundary>
      <ModuleErrorBoundary
        moduleId="right-utility"
        title="Pravý nástroj"
        compact
        placement="drawer"
        resetKey={rightUtility.type}
        onDismiss={() => shell.closeRightUtility()}
      >
        <RightUtilityDrawer />
      </ModuleErrorBoundary>
      <ModuleErrorBoundary
        moduleId="modal-host"
        title="Dialog"
        compact
        placement="modal"
        resetKey={modal.type === "legacy" ? modal.sheet : modal.type}
        onDismiss={() => shell.closeModal()}
      >
        <ModalHost />
      </ModuleErrorBoundary>
      <ModuleErrorBoundary
        moduleId="map-picker"
        title="Výběr na mapě"
        compact
        placement="overlay"
        resetKey={mapPicker.type === "active" ? mapPicker.session.id : mapPicker.type}
        onDismiss={() => shell.closeMapPicker("user")}
      >
        <MapPickerHost />
      </ModuleErrorBoundary>

      {toast && (
        <div className="toast" data-testid="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </>
  );
}

/** Exact compatibility fallback kept behind VITE_APP_SHELL_V2=0 for a low-risk rollback. */
export function LegacyAppShell({ onFlyToMe }: AppChromeProps) {
  const sheet = useMapStoreSnapshot((state) => state.sheet);
  const toast = useMapStoreSnapshot((state) => state.toast);
  const mode = useMapStoreSnapshot((state) => state.mode);

  return (
    <>
      <div className="chrome top-chrome">
        <ModuleErrorBoundary moduleId="legacy-command-bar" title="Horní ovládání" compact>
          <ModeBar onFlyToMe={onFlyToMe} />
        </ModuleErrorBoundary>
      </div>

      <ModuleErrorBoundary moduleId="legacy-map-overlays" title="Mapové ovládání" compact>
        <SearchHereButton />
        <LayerNotices />
        <SourceStatus floating testId="map-source-strip" />
        <TaskCenter />
        <BottomNav />
      </ModuleErrorBoundary>
      <AsyncSurface id="legacy-planning-panel" title="Plánování">
        <PlanningPanel />
      </AsyncSurface>
      <AsyncSurface id="legacy-discover-panel" title="Objevování">
        <DiscoverPanel />
      </AsyncSurface>
      <AsyncSurface id="legacy-personal-panel" title="Osobní místa">
        <MinePanel />
      </AsyncSurface>
      <AsyncSurface id="legacy-game-panel" title="Herní panel">
        <GameHud />
      </AsyncSurface>

      {mode === "game" && (
        <AsyncSurface id="legacy-game-runtime" title="Herní svět" compact>
          <GameSimulationBridge />
        </AsyncSurface>
      )}
      {mode === "game" && (
        <AsyncSurface id="legacy-game-controls" title="Ovládání hry" compact>
          <GameControls />
        </AsyncSurface>
      )}

      <AsyncSurface id="legacy-timeline" title="Časová osa" compact>
        <GlobalTimeline />
      </AsyncSurface>

      <AsyncSurface id="legacy-modal" title="Dialog" compact>
        {sheet === "pin" && <PinDetail />}
        {sheet === "auth" && <AuthSheet />}
        {sheet === "edit" && <EditLayerSheet />}
        {sheet === "route" && <RouteSheet />}
        {sheet === "settings" && <SettingsSheet />}
        {(sheet === "basemap" || sheet === "tiles") && <BasemapSheet />}
        {sheet === "wizard" && <CreateWizard />}
      </AsyncSurface>

      {toast && (
        <div className="toast" data-testid="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </>
  );
}
