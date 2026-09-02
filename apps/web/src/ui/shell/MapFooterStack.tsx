import { useEffect, type ReactNode } from "react";
import type { FooterContributionState } from "../../store/shellState";
import { getShellStore } from "../../store/shellStore";
import { useShellStoreSnapshot } from "../../store/useShellStoreSnapshot";

export interface FooterContributionView {
  descriptor: FooterContributionState;
  content: ReactNode;
}

export function MapFooterStack({ entries }: { entries: FooterContributionView[] }) {
  const shell = getShellStore();
  const registered = useShellStoreSnapshot((state) => state.footerContributions);
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

  const contentById = new Map(entries.map((entry) => [entry.descriptor.id, entry.content]));

  return (
    <div
      className="map-footer-stack"
      data-testid="map-footer-stack"
      data-left-open={leftOpen}
      data-right-open={rightOpen}
    >
      {registered.map((descriptor) => {
        const content = contentById.get(descriptor.id);
        return content === undefined ? null : (
          <div
            className="map-footer-contribution"
            data-footer-id={descriptor.id}
            data-footer-kind={descriptor.kind}
            key={descriptor.id}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}
