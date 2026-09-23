import { useEffect, useRef, type ReactNode } from "react";
import { t } from "../../i18n";
import type { FooterContributionState, MinimizableFooterKind } from "../../store/shellState";
import { getShellStore } from "../../store/shellStore";
import { useShellStoreSnapshot } from "../../store/useShellStoreSnapshot";
import { Icon } from "../kit";

export interface FooterContributionView {
  descriptor: FooterContributionState;
  content: ReactNode;
}

export function MapFooterStack({ entries }: { entries: FooterContributionView[] }) {
  const shell = getShellStore();
  const registered = useShellStoreSnapshot((state) => state.footerContributions);
  const minimized = useShellStoreSnapshot((state) => state.footerMinimized);
  const leftOpen = useShellStoreSnapshot((state) => state.leftContext.type !== "closed");
  const rightOpen = useShellStoreSnapshot((state) => state.rightUtility.type !== "closed");
  const signature = entries
    .map(({ descriptor }) => `${descriptor.id}:${descriptor.kind}:${descriptor.priority}`)
    .join("|");

  useEffect(() => {
    const unregister = entries.map(({ descriptor }) =>
      shell.registerFooterContribution(descriptor)
    );
    return () => {
      for (const remove of unregister) remove();
    };
    // Content does not belong in serializable shell state. Registration changes only when the
    // descriptor signature changes; callers keep React nodes in this host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell, signature]);

  // The toast sits above whatever the footer currently is (§4.14), and legends/timelines change
  // height as layers come and go, so the height is published rather than guessed.
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const publish = () => {
      const height = registered.length ? Math.round(host.getBoundingClientRect().height) : 0;
      document.documentElement.style.setProperty("--footer-stack-h", `${height}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(host);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--footer-stack-h");
    };
  }, [registered.length]);

  const contentById = new Map(entries.map((entry) => [entry.descriptor.id, entry.content]));
  const shown = registered.filter((descriptor) => contentById.get(descriptor.id) !== undefined);
  const chips = shown
    .map((descriptor) => minimizableKind(descriptor.kind))
    .filter((kind): kind is MinimizableFooterKind => kind !== null && minimized[kind]);

  return (
    <div
      ref={hostRef}
      className="map-footer-stack"
      data-testid="map-footer-stack"
      data-left-open={leftOpen}
      data-right-open={rightOpen}
    >
      {shown.map((descriptor) => {
        const kind = minimizableKind(descriptor.kind);
        if (kind && minimized[kind]) return null;
        return (
          <div
            className="map-footer-contribution"
            data-footer-id={descriptor.id}
            data-footer-kind={descriptor.kind}
            key={descriptor.id}
          >
            {contentById.get(descriptor.id)}
          </div>
        );
      })}

      {/* Rolled-up trays become one row of chips, so the map is clear but nothing has silently
          disappeared: what is off screen is still named and one click away. */}
      {chips.length > 0 && (
        <div className="map-footer-chips" data-testid="footer-chips">
          {chips.map((kind) => (
            <button
              type="button"
              key={kind}
              className="map-footer-chip"
              data-testid={`footer-restore-${kind}`}
              onClick={() => shell.setFooterMinimized(kind, false)}
            >
              <Icon name={kind === "legend" ? "info" : "schedule"} size={18} />
              <span>{t(kind === "legend" ? "layers.legend" : "footer.timeline")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Legends and timelines can be rolled up; a route summary or a status line cannot. */
function minimizableKind(kind: FooterContributionState["kind"]): MinimizableFooterKind | null {
  if (kind === "legend") return "legend";
  if (kind === "timeline") return "timeline";
  return null;
}
