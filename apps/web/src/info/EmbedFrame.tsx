import { EmptyState, Skeleton } from "../ui/primitives";
import { useInfoData } from "./useInfoData";

interface Probe {
  url: string;
  verdict: "allowed" | "blocked" | "unknown";
  reason: string;
}

/**
 * An iframe that asks first.
 *
 * A page refusing to be framed does so with headers the parent can't read, and the frame's load
 * event fires regardless — so without the server-side probe the only feedback is a silent blank
 * box. Asking up front means the panel can offer the link instead.
 */
export function EmbedFrame({
  url,
  title,
  linkLabel,
  attribution,
  height = 420,
  testId
}: {
  url: string;
  title: string;
  linkLabel: string;
  attribution?: string;
  height?: number;
  testId?: string;
}) {
  const state = useInfoData<Probe>("/info/embeddable", { url });

  const link = (
    <a className="btn btn-accent" href={url} target="_blank" rel="noreferrer">
      {linkLabel}
    </a>
  );

  if (state.status === "loading") return <Skeleton height={height} />;

  // An unreachable probe is not a reason to hide the content: the link always works.
  if (state.status !== "ready" || state.data.verdict !== "allowed") {
    return (
      <div className="info-panel" data-testid={testId}>
        <EmptyState icon="info" title="Tato služba nedovoluje vložení do stránky." action={link} />
        {attribution && <p className="meta">{attribution}</p>}
      </div>
    );
  }

  return (
    <div className="info-panel" data-testid={testId}>
      <iframe
        className="info-frame"
        src={url}
        title={title}
        style={{ height }}
        loading="lazy"
        // The frame gets scripting and its own origin so real embeds work, but no access to
        // forms, downloads, top-level navigation or our storage.
        sandbox="allow-scripts allow-same-origin allow-popups"
        referrerPolicy="no-referrer"
      />
      <div className="info-frame-actions">
        {link}
        {attribution && <span className="meta">{attribution}</span>}
      </div>
    </div>
  );
}
