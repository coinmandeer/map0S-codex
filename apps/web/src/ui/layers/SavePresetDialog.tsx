import { useState } from "react";
import { getMapStore } from "../../store/mapStore";
import { emit } from "../../lib/events";
import { st } from "../../statistics/labels";
import { Button, Dialog, TextField } from "../kit";
import {
  USER_PRESET_LIMIT,
  loadUserPresets,
  saveUserPresets,
  withUserPreset
} from "../userPresets";

export function SavePresetDialog({
  open,
  onOpenChange
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [replace, setReplace] = useState("");
  const [error, setError] = useState("");
  const presets = loadUserPresets();

  const save = () => {
    try {
      const store = getMapStore();
      const appearance = store.captureAppearance();
      const preset = {
        id: replace || `user:${crypto.randomUUID()}`,
        name: name.trim(),
        version: 2 as const,
        layers: Object.keys(appearance.layers),
        appearance,
        updatedAt: Date.now()
      };
      const next = withUserPreset(
        replace ? presets.filter((p) => p.id !== replace) : presets,
        preset
      );
      if (next.length > USER_PRESET_LIMIT && !replace) {
        setError(
          st(
            `Uloženo je maximum ${USER_PRESET_LIMIT} sad. Nejdřív některou sadu odeberte.`,
            `The limit of ${USER_PRESET_LIMIT} sets is reached. Remove one first.`
          )
        );
        return;
      }
      saveUserPresets(next);
      store.rememberPreset(preset.id);
      emit("layers-changed");
      setName("");
      setReplace("");
      setError("");
      onOpenChange(false);
    } catch {
      setError(
        st(
          "Sadu se nepodařilo uložit. Zkontrolujte dostupné úložiště.",
          "Could not save the preset. Check available storage."
        )
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={st("Uložit podobu mapy", "Save map appearance")}
      testId="save-preset-dialog"
      footer={
        <Button disabled={!name.trim()} onClick={save} testId="save-preset-submit">
          {st("Uložit", "Save")}
        </Button>
      }
    >
      <TextField
        label={st("Název", "Name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        testId="save-preset-name"
      />
      <label>
        {st("Uložit jako", "Save as")}
        <select
          value={replace}
          onChange={(e) => {
            setReplace(e.target.value);
            if (e.target.value) setName(presets.find((p) => p.id === e.target.value)?.name ?? "");
          }}
        >
          <option value="">{st("Nový preset", "New preset")}</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <p>
        {st(
          "Uloží se vybrané i pozastavené vrstvy, jejich nastavení, zdroje, podklad a 3D volby.",
          "Saves selected and paused layers, their settings, sources, basemap and 3D options."
        )}
      </p>
      {error && <p role="alert">{error}</p>}
    </Dialog>
  );
}
