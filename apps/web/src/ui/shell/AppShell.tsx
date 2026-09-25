import { StatisticsDialog } from "../../statistics/StatisticsDialog";
import { flushSync } from "react-dom";
import { chatSession } from "../ai/chatSession";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode
} from "react";
import type { Fix } from "../../lib/geolocation";
import { getLayerManifestV2 } from "../../layers/registry";
import {
  ShellBrowserHistoryBinding,
  windowShellHistoryPort
} from "../../store/shellBrowserHistory";
import { getShellStore } from "../../store/shellStore";
import { getMapStore, type ToastState } from "../../store/mapStore";
import { useMapStoreSnapshot } from "../../store/useMapStoreSnapshot";
import { useShellStoreSnapshot } from "../../store/useShellStoreSnapshot";
import { BottomNav } from "../BottomNav";

import { ModeBar } from "../ModeBar";

import { SourceStatus } from "../SourceStatus";
import { TaskCenter } from "../TaskCenter";
import { legendContributions, timelineContributions } from "../footerContributions";
import { ModuleErrorBoundary } from "../primitives/ModuleErrorBoundary";
import { Button } from "../kit";

import { DiscoverHereButton } from "../DiscoverHereButton";
import { SearchHereButton } from "../SearchHereButton";
import { DesktopModeBar } from "./DesktopModeBar";
import { MapFooterStack } from "./MapFooterStack";
import { LegendStack } from "./LegendStack";

import { MapPickerHost } from "./MapPickerHost";
import { ModalHost } from "./ModalHost";
import { RightUtilityDrawer } from "./RightUtilityDrawer";
import { TopBar } from "./TopBar";

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
/**
 * The game panel is opened while the board redraws every frame and the HUD clock ticks. A lazy
 * component resumes through a Suspense retry, which React never expires, and on a slow phone those
 * constant updates kept the retry from ever committing: the panel stayed a spinner. It loads
 * through ordinary state instead (which React does commit), and starts loading when the game mode
 * does, so opening it is usually instant.
 */
let worldHudModule: Promise<typeof import("../../world/WorldHud")> | null = null;
let loadedWorldHud: ComponentType | null = null;
function loadWorldHud() {
  worldHudModule ??= import("../../world/WorldHud").then(
    (module) => {
      loadedWorldHud = module.WorldHud;
      return module;
    },
    (error: unknown) => {
      worldHudModule = null;
      throw error;
    }
  );
  return worldHudModule;
}
function GameHud() {
  const [WorldHud, setWorldHud] = useState<ComponentType | null>(() => loadedWorldHud);
  const [failure, setFailure] = useState<unknown>(null);
  useEffect(() => {
    if (WorldHud) return;
    let live = true;
    loadWorldHud().then(
      // Synchronously: the panel is what was just asked for, and a normal update can still wait
      // behind the board's own updates for seconds before React forces it through.
      (module) => live && flushSync(() => setWorldHud(() => module.WorldHud)),
      (error: unknown) => live && setFailure(error)
    );
    return () => {
      live = false;
    };
  }, [WorldHud]);
  // Thrown during render so the surrounding module boundary offers its retry.
  if (failure) throw failure;
  return WorldHud ? <WorldHud /> : <span className="spinner" aria-label="Načítám: Herní panel" />;
}
const GameHudOverlay = lazy(() =>
  import("../../world/GameHudOverlay").then((module) => ({ default: module.GameHudOverlay }))
);
const GameControls = lazy(() =>
  import("../GameControls").then((module) => ({ default: module.GameControls }))
);
const DiscoverPanel = lazy(() =>
  import("../DiscoverPanel").then((module) => ({ default: module.DiscoverPanel }))
);
const PlanningPanel = lazy(() =>
  import("../PlanningPanel").then((module) => ({ default: module.PlanningPanel }))
);
const PersonalPanel = lazy(() =>
  import("../PersonalPanel").then((module) => ({ default: module.PersonalPanel }))
);
const FeedPanel = lazy(() =>
  import("../FeedPanel").then((module) => ({ default: module.FeedPanel }))
);
const GameSimulationBridge = lazy(() =>
  import("../GameSimulationBridge").then((module) => ({ default: module.GameSimulationBridge }))
);
const CreateWizard = lazy(() =>
  import("../CreateWizard").then((module) => ({ default: module.CreateWizard }))
);
const AiPanel = lazy(() => import("../AiPanel").then((module) => ({ default: module.AiPanel })));

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
  const selectedPin = useMapStoreSnapshot((state) => state.selectedPin);
  const discoverFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (mode === "game") void loadWorldHud().catch(() => {});
  }, [mode]);
  const previousContext = useRef(leftContext.type);
  useEffect(() => {
    if (
      previousContext.current === "feature" &&
      leftContext.type === "mode" &&
      leftContext.mode === "discover"
    )
      discoverFocus.current?.focus({ preventScroll: true });
    previousContext.current = leftContext.type;
  }, [leftContext]);

  useEffect(() => {
    const port = windowShellHistoryPort();
    if (!port) return;
    const binding = new ShellBrowserHistoryBinding(shell, port);
    return () => binding.dispose();
  }, [shell]);

  // §4.10: the map, the panels and search all select pins through MapStore. Translating that one
  // signal into the left feature context here keeps every caller free of shell knowledge.
  useEffect(() => {
    const keepsSession =
      leftContext.type === "ai" ||
      (leftContext.type === "feature" && leftContext.returnTo?.type === "ai");
    if (!keepsSession) chatSession.stop();
  }, [leftContext]);

  const selectedRef = useMemo(() => {
    if (!selectedPin) return null;
    const featureId = String(selectedPin.feature.properties?.id ?? selectedPin.layerId);
    return { layerId: selectedPin.layerId, featureId };
  }, [selectedPin]);

  useEffect(() => {
    if (selectedRef) {
      shell.openFeatureContext(selectedRef);
      return;
    }
    shell.closeFeatureContext();
  }, [selectedRef, shell]);

  // Closing the detail through the panel chrome, Escape or browser-back has to release the pin,
  // otherwise the map keeps its highlight and the same pin cannot be reopened. The live snapshot
  // is what matters here: `leftContext` from this render is one commit behind the effect above.
  useEffect(() => {
    if (!selectedRef || shell.snapshot.leftContext.type === "feature") return;
    getMapStore().selectPin(null);
  }, [leftContext, selectedRef, shell]);

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
      <ModuleErrorBoundary moduleId="command-bar" title="Horní ovládání" compact>
        <TopBar onFlyToMe={onFlyToMe} />
      </ModuleErrorBoundary>

      <ModuleErrorBoundary
        moduleId="bottom-navigation"
        title="Mobilní navigace"
        compact
        placement="overlay"
      >
        <BottomNav />
      </ModuleErrorBoundary>
      <ModuleErrorBoundary
        moduleId="desktop-modebar"
        title="Přepínač režimů"
        compact
        placement="overlay"
      >
        <DesktopModeBar />
      </ModuleErrorBoundary>
      {/* Discover's "What is here?" chip. Styles keep it hidden until the open discover panel
          marks the document, so it only appears while that panel can show the answer. */}
      <ModuleErrorBoundary moduleId="discover-here" title="Co je tady" compact placement="overlay">
        <DiscoverHereButton />
      </ModuleErrorBoundary>
      {/* "Search this area": floats over the map whenever the view is waiting for it. */}
      <ModuleErrorBoundary moduleId="search-here" title="Hledat tady" compact placement="overlay">
        <SearchHereButton />
      </ModuleErrorBoundary>

      {/* The arcade HUD floats over the board: in game mode the map panel stays closed and the
          player gets vitals, zone clock and the three actions without opening anything. */}
      <AsyncSurface id="game-hud-overlay" title="Herní HUD" compact placement="overlay">
        <GameHudOverlay />
      </AsyncSurface>

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
        {leftContext.type === "mode" && leftContext.mode === "feed" && (
          <AsyncSurface
            id="feed-panel"
            title="Feed"
            resetKey={leftContext.mode}
            onDismiss={() => shell.closeLeftContext()}
            placement="panel"
          >
            <FeedPanel />
          </AsyncSurface>
        )}
        {((leftContext.type === "mode" && leftContext.mode === "discover") ||
          (leftContext.type === "feature" &&
            leftContext.returnTo?.type === "mode" &&
            leftContext.returnTo.mode === "discover")) && (
          <div
            hidden={leftContext.type === "feature"}
            onFocusCapture={(event) => {
              if (event.target instanceof HTMLElement) discoverFocus.current = event.target;
            }}
          >
            <AsyncSurface
              id="discover-panel"
              title="Objevování a AI souhrn"
              resetKey="discover"
              onDismiss={() => shell.closeLeftContext()}
              placement="panel"
            >
              <DiscoverPanel />
            </AsyncSurface>
          </div>
        )}
        {leftContext.type === "mode" && leftContext.mode === "personal" && (
          <AsyncSurface
            id="personal-panel"
            title="Osobní místa"
            resetKey={leftContext.mode}
            onDismiss={() => shell.closeLeftContext()}
            placement="panel"
          >
            <PersonalPanel />
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
        {leftContext.type === "ai" && (
          <AsyncSurface
            id="ai-panel"
            title="Asistent"
            resetKey={leftContext.prompt ?? "ai"}
            onDismiss={() => shell.closeLeftContext()}
            placement="panel"
          >
            <AiPanel />
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
        <StatisticsDialog />
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

      {toast && <Toast toast={toast} />}
    </>
  );
}

/** One line, at most one action — the undo for something the app did on the user's behalf. */
function Toast({ toast }: { toast: ToastState }) {
  return (
    <div className="toast" data-testid="toast" role="status" aria-live="polite">
      <span className="toast-message">{toast.message}</span>
      {toast.secondaryAction && (
        <Button variant="text" size="sm" onClick={toast.secondaryAction.onSelect}>
          {toast.secondaryAction.label}
        </Button>
      )}
      {toast.action && (
        <Button variant="text" size="sm" testId="toast-action" onClick={toast.action.onSelect}>
          {toast.action.label}
        </Button>
      )}
    </div>
  );
}

/** Exact compatibility fallback kept behind VITE_APP_SHELL_V2=0 for a low-risk rollback. */
export function LegacyAppShell({ onFlyToMe }: AppChromeProps) {
  const sheet = useMapStoreSnapshot((state) => state.sheet);
  const toast = useMapStoreSnapshot((state) => state.toast);
  const mode = useMapStoreSnapshot((state) => state.mode);
  const legacySelectedPin = useMapStoreSnapshot((state) => state.selectedPin);

  return (
    <>
      <div className="chrome top-chrome">
        <ModuleErrorBoundary moduleId="legacy-command-bar" title="Horní ovládání" compact>
          <ModeBar onFlyToMe={onFlyToMe} />
        </ModuleErrorBoundary>
      </div>

      <ModuleErrorBoundary moduleId="legacy-map-overlays" title="Mapové ovládání" compact>
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
        <PersonalPanel />
      </AsyncSurface>
      <AsyncSurface id="legacy-feed-panel" title="Feed">
        <FeedPanel />
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
        {legacySelectedPin && <PinDetail />}
        {sheet === "auth" && <AuthSheet />}
        {sheet === "edit" && <EditLayerSheet />}
        {sheet === "route" && <RouteSheet />}
        {sheet === "settings" && <SettingsSheet />}
        {(sheet === "basemap" || sheet === "tiles") && <BasemapSheet />}
        {sheet === "wizard" && <CreateWizard />}
      </AsyncSurface>

      {toast && <Toast toast={toast} />}
    </>
  );
}
