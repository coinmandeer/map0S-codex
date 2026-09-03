import { Button, ListItem, Skeleton, TextField } from "../kit";
import type { PlanShareLink } from "./types";

/** Contents of the footer's share popover: the two copy actions and the real revocable link. */
export function PlanShareTools({
  readOnlyShared,
  shareBusy,
  shareListLoading,
  shareLinks,
  newShareUrl,
  onShareSummary,
  onCopyItinerary,
  onCreateShare,
  onCopyShareUrl,
  onRevokeShare
}: {
  readOnlyShared: boolean;
  shareBusy: boolean;
  shareListLoading: boolean;
  shareLinks: PlanShareLink[];
  newShareUrl: string | null;
  onShareSummary: () => void;
  onCopyItinerary: () => void;
  onCreateShare: () => void;
  onCopyShareUrl: () => void;
  onRevokeShare: (share: PlanShareLink) => void;
}) {
  return (
    <div className="planner-share">
      <Button
        variant="text"
        icon="share"
        block
        testId="share-plan-summary"
        onClick={onShareSummary}
      >
        Sdílet přehled
      </Button>
      <Button
        variant="text"
        icon="content_copy"
        block
        testId="copy-plan-itinerary"
        onClick={onCopyItinerary}
      >
        Kopírovat itinerář
      </Button>

      {!readOnlyShared && (
        <div className="planner-share-links" data-testid="plan-share-manager">
          <span className="kit-eyebrow">Odkaz jen pro čtení</span>
          <p className="planner-hint">
            Každý s odkazem uvidí trasu a zastávky. Poznámky, identita ani AI konverzace se nesdílí.
          </p>
          <Button
            variant="tonal"
            icon="link"
            block
            loading={shareBusy}
            disabled={shareBusy}
            testId="create-plan-share"
            onClick={onCreateShare}
          >
            Vytvořit a zkopírovat odkaz
          </Button>
          {shareListLoading && <Skeleton height={40} />}
          {newShareUrl && (
            <div className="planner-share-url" data-testid="plan-share-url">
              <TextField
                readOnly
                label="Nový odkaz"
                hint="Po zavření už ho nelze znovu zobrazit"
                value={newShareUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button variant="text" size="sm" icon="content_copy" onClick={onCopyShareUrl}>
                Kopírovat
              </Button>
            </div>
          )}
          {shareLinks.map((share) => (
            <ListItem
              key={share.id}
              icon={share.revokedAt ? "lock" : "link"}
              title={share.revokedAt ? "Odvolaný odkaz" : "Aktivní odkaz"}
              subtitle={`Jen pro čtení · ${new Date(share.createdAt).toLocaleDateString("cs-CZ")}`}
              trailing={
                share.revokedAt ? undefined : (
                  <Button
                    variant="text"
                    size="sm"
                    disabled={shareBusy}
                    onClick={() => onRevokeShare(share)}
                  >
                    Odvolat
                  </Button>
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
