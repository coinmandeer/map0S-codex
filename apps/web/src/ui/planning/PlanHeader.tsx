import { IconButton, Menu } from "../kit";

/** The planning panel's header controls (§4.5): the AI toggle and the overflow menu that owns
 *  the plan lifecycle. The revision line lives here instead of taking a row in the body. */
export function PlanHeader({
  revision,
  canUndo,
  aiEnabled,
  aiOpen,
  readOnlyShared,
  onToggleAi,
  onNewPlan,
  onDuplicate,
  onUndo
}: {
  revision: number;
  canUndo: boolean;
  aiEnabled: boolean;
  aiOpen: boolean;
  readOnlyShared: boolean;
  onToggleAi: () => void;
  onNewPlan: () => void;
  onDuplicate: () => void;
  onUndo: () => void;
}) {
  return (
    <>
      {aiEnabled && (
        <IconButton
          icon="auto_awesome"
          label="AI k plánu"
          size="sm"
          active={aiOpen}
          disabled={readOnlyShared}
          testId="plan-ai-toggle"
          onClick={onToggleAi}
        />
      )}
      <Menu
        testId="plan-menu"
        trigger={<IconButton icon="more_vert" label="Akce plánu" size="sm" />}
        actions={[
          { id: "new", label: "Nový plán", icon: "add", onSelect: onNewPlan },
          {
            id: "duplicate",
            label: "Duplikovat",
            icon: "content_copy",
            disabled: readOnlyShared,
            onSelect: onDuplicate
          },
          {
            id: "undo",
            label: "Vrátit změnu",
            icon: "undo",
            disabled: !canUndo || readOnlyShared,
            onSelect: onUndo
          },
          {
            id: "revision",
            label: `Revize ${revision}`,
            icon: "history",
            disabled: true,
            onSelect: () => undefined
          }
        ]}
      />
    </>
  );
}
