import type { ReactNode } from "react";
import { Button, Dialog, Tabs } from "../kit";
import { PLAN_EXPORT_LABELS, type PlanExportFormat } from "../../planning/planExport";

export type PlanShareTab = "share" | "export" | "handoff";

/** §29.3 collapsed share, export and hand-off into one dialog with tabs, so the footer needs
 *  three icons instead of a popover, a menu and a second popover. */
export function PlanShareDialog({
  tab,
  onTabChange,
  onClose,
  shareTools,
  handoffs,
  exporting,
  onExport
}: {
  /** `null` closes the dialog; a tab id opens it on that tab. */
  tab: PlanShareTab | null;
  onTabChange: (next: PlanShareTab) => void;
  onClose: () => void;
  shareTools: ReactNode;
  handoffs: ReactNode;
  exporting: string | null;
  onExport: (format: PlanExportFormat) => void;
}) {
  return (
    <Dialog
      open={tab !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Sdílet plán"
      testId="plan-share-dialog"
    >
      <Tabs
        testId="plan-share-tabs"
        value={tab ?? "share"}
        onValueChange={(next) => onTabChange(next as PlanShareTab)}
        tabs={[
          { id: "share", label: "Sdílet", icon: "share", children: shareTools },
          {
            id: "export",
            label: "Exportovat",
            icon: "download",
            children: (
              <div className="planner-share">
                {(Object.keys(PLAN_EXPORT_LABELS) as PlanExportFormat[]).map((format) => (
                  <Button
                    key={format}
                    variant="text"
                    icon="download"
                    block
                    disabled={exporting !== null}
                    loading={exporting === format}
                    testId={`plan-export-${format}`}
                    onClick={() => onExport(format)}
                  >
                    {PLAN_EXPORT_LABELS[format]}
                  </Button>
                ))}
              </div>
            )
          },
          {
            id: "handoff",
            label: "Otevřít v jiné mapě",
            icon: "open_in_new",
            children: handoffs
          }
        ]}
      />
    </Dialog>
  );
}
