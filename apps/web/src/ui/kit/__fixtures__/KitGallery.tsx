import { useState } from "react";
import { getMapStore } from "../../../store/mapStore";
import { useMapStoreSnapshot } from "../../../store/useMapStoreSnapshot";
import {
  Accordion,
  Badge,
  Button,
  Checkbox,
  Chip,
  Combobox,
  ConfirmDialog,
  Dialog,
  Divider,
  EmptyState,
  Icon,
  ICON_NAMES,
  IconButton,
  InfoTip,
  InlineNotice,
  ListItem,
  Menu,
  NumberField,
  Popover,
  ProgressCircular,
  ProgressLinear,
  RadioGroup,
  RangeSlider,
  SearchField,
  Section,
  SegmentedButton,
  Select,
  Skeleton,
  Slider,
  StatChip,
  Switch,
  Tabs,
  TextArea,
  TextField,
  Tooltip,
  notify
} from "..";

/** Every kit component on one page, in both themes, so a token change can be reviewed in a
 *  single screenshot instead of by clicking through the app.
 *
 *  Reachable at `?kit=1` in development only — `App` checks the flag before mounting the
 *  real shell, and the production build never renders it. */
export function KitGallery() {
  const store = getMapStore();
  const theme = useMapStoreSnapshot((state) => state.theme);

  const [text, setText] = useState("Karlštejn");
  const [search, setSearch] = useState("");
  const [comboValue, setComboValue] = useState("Vinar");
  const [count, setCount] = useState<number | null>(3);
  const [segment, setSegment] = useState<"fast" | "short" | "noTolls" | "scenic">("fast");
  const [selectValue, setSelectValue] = useState<"car" | "bike" | "foot">("car");
  const [radio, setRadio] = useState<"rain" | "temp" | "wind">("rain");
  const [switched, setSwitched] = useState(true);
  const [checked, setChecked] = useState(false);
  const [slider, setSlider] = useState(24);
  const [range, setRange] = useState<[number, number]>([2, 8]);
  const [tab, setTab] = useState("guide");
  const [badgeCount, setBadgeCount] = useState(3);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="kit-gallery">
      <header className="kit-gallery-bar">
        <h1>MapOS kit</h1>
        <span className="kit-gallery-spacer" />
        <SegmentedButton
          ariaLabel="Téma"
          value={theme}
          onChange={(next) => store.setTheme(next)}
          options={[
            { value: "light", label: "Světlý", icon: "light_mode" },
            { value: "dark", label: "Tmavý", icon: "dark_mode" }
          ]}
        />
      </header>

      <div className="kit-gallery-grid">
        <Section title="Button" eyebrow="Akce">
          <div className="kit-gallery-row">
            <Button variant="filled" icon="route">
              Spočítat trasu
            </Button>
            <Button variant="tonal" icon="bookmark">
              Uložit
            </Button>
            <Button variant="outlined" icon="share">
              Sdílet
            </Button>
            <Button variant="text">Zrušit</Button>
            <Button variant="danger" icon="delete">
              Smazat
            </Button>
          </div>
          <div className="kit-gallery-row">
            <Button variant="filled" size="sm">
              Malé
            </Button>
            <Button variant="filled" size="lg">
              Velké
            </Button>
            <Button variant="filled" loading>
              Načítám
            </Button>
            <Button variant="filled" disabled>
              Nedostupné
            </Button>
          </div>
          <Button variant="filled" block icon="add">
            Přes celou šířku
          </Button>
        </Section>

        <Section title="IconButton" eyebrow="Akce">
          <div className="kit-gallery-row">
            <IconButton icon="menu" label="Panel" />
            <IconButton icon="my_location" label="Moje poloha" variant="tonal" />
            <IconButton icon="layers" label="Vrstvy" variant="filled" />
            <IconButton icon="settings" label="Nastavení" variant="outlined" />
            <IconButton icon="close" label="Zavřít" round />
            <IconButton icon="star" label="Oblíbené" active />
            <IconButton icon="add" label="Přidat" size="sm" />
            <IconButton icon="add" label="Přidat" size="lg" />
          </div>
        </Section>

        <Section title="SegmentedButton" eyebrow="Volba">
          <SegmentedButton
            ariaLabel="Typ trasy"
            value={segment}
            onChange={setSegment}
            block
            options={[
              { value: "fast", label: "Rychlá", icon: "bolt" },
              { value: "short", label: "Krátká", icon: "straighten" },
              { value: "noTolls", label: "Bez dálnic", icon: "toll" },
              { value: "scenic", label: "Dobrodružná", icon: "landscape" }
            ]}
          />
          <SegmentedButton
            ariaLabel="Typ trasy, jen ikony"
            value={segment}
            onChange={setSegment}
            iconsOnly
            options={[
              { value: "fast", label: "Rychlá", icon: "bolt" },
              { value: "short", label: "Krátká", icon: "straighten" },
              { value: "noTolls", label: "Bez dálnic", icon: "toll" },
              { value: "scenic", label: "Dobrodružná", icon: "landscape" }
            ]}
          />
        </Section>

        <Section title="Pole" eyebrow="Vstup">
          <TextField
            label="Název plánu"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onClear={() => setText("")}
            hint="Uloží se do Osobní › Plány"
          />
          <SearchField
            label="Hledat"
            hideLabel
            placeholder="Hledat místo, GPS nebo se zeptat AI"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch("")}
            trailing={<IconButton icon="my_location" label="Moje poloha" size="sm" round />}
          />
          <TextField
            label="E-mail"
            value="neplatny"
            onChange={() => undefined}
            error="Zadej adresu ve tvaru jmeno@domena.cz"
          />
          <NumberField label="Počet dní" value={count} onChange={setCount} min={1} max={30} unit="dní" />
          <TextArea label="Popis místa" placeholder="Co je na tom místě zajímavé?" />
        </Section>

        <Section title="Select a Combobox" eyebrow="Vstup">
          <Select
            label="Vozidlo"
            value={selectValue}
            onChange={setSelectValue}
            options={[
              { value: "car", label: "Auto", icon: "directions_car" },
              { value: "bike", label: "Kolo", icon: "directions_bike" },
              { value: "foot", label: "Pěšky", icon: "directions_walk" }
            ]}
          />
          <Combobox
            label="Zastávka"
            hideLabel
            icon="place"
            placeholder="Adresa, město, GPS nebo dotaz na AI"
            inputValue={comboValue}
            onInputChange={setComboValue}
            onSelect={(item) => notify(`Vybráno: ${item.label}`)}
            groupOrder={["Ostatní"]}
            items={[
              { id: "1", label: "Vinaròs", detail: "Castellón, Španělsko", icon: "place" },
              { id: "2", label: "Vinařice", detail: "Kladno, Česko", icon: "place" },
              { id: "3", label: "Vinařství u Kapličky", detail: "Zaječí, Česko", icon: "local_bar" },
              {
                id: "4",
                label: "Zapnout vrstvu Vinice",
                detail: "Vrstva",
                icon: "layers",
                group: "Ostatní"
              }
            ]}
          />
        </Section>

        <Section title="Přepínače" eyebrow="Volba">
          <div className="kit-gallery-row">
            <Switch checked={switched} onChange={setSwitched} label="3D budovy" />
            <Switch checked={!switched} onChange={(next) => setSwitched(!next)} label="Popisky" />
            <Switch checked={false} onChange={() => undefined} label="Nedostupné" disabled />
          </div>
          <Checkbox checked={checked} onChange={setChecked} label="Zahrnout placená místa" />
          <RadioGroup
            ariaLabel="Počasí"
            value={radio}
            onChange={setRadio}
            options={[
              { value: "rain", label: "Srážky", description: "Radar, aktualizace 10 min" },
              { value: "temp", label: "Teplota", description: "2 m nad zemí" },
              { value: "wind", label: "Vítr", description: "Nárazy v 10 m" }
            ]}
          />
        </Section>

        <Section title="Slidery" eyebrow="Volba">
          <Slider
            label="Okolí"
            value={slider}
            onChange={setSlider}
            min={1}
            max={100}
            format={(value) => `${value} km`}
          />
          <RangeSlider
            label="Délka trasy"
            value={range}
            onChange={setRange}
            min={0}
            max={20}
            format={([from, to]) => `${from}–${to} h`}
          />
        </Section>

        <Section
          title="Chip, Badge, Stat"
          eyebrow="Zobrazení"
          action={<InfoTip title="Kdy použít chip">Chip je filtr, ne tlačítko akce.</InfoTip>}
        >
          <div className="kit-gallery-row">
            <Chip label="Kempy" icon="rv_hookup" active onClick={() => undefined} />
            <Chip label="Restaurace" icon="restaurant" onClick={() => undefined} />
            <Chip label="Příroda" color="var(--layer-nature)" onClick={() => undefined} />
            <Chip label="Vlastní vrstva" onRemove={() => undefined} />
            <Chip label="Statický" />
          </div>
          <div className="kit-gallery-row">
            <Button variant="tonal" size="sm" onClick={() => setBadgeCount((n) => n + 1)}>
              Přidat vrstvu
            </Button>
            <span className="kit-gallery-badge-holder">
              <Icon name="layers" size={24} />
              <Badge count={badgeCount} />
            </span>
            <Badge count={132} tone="neutral" />
            <Badge count={2} tone="danger" />
          </div>
          <div className="kit-gallery-row">
            <StatChip label="km" value="128" />
            <StatChip label="hodiny" value="2:14" />
            <StatChip label="zastávek" value="6" />
          </div>
        </Section>

        <Section title="Seznam" eyebrow="Zobrazení">
          <ListItem
            icon="place"
            title="Karlštejn"
            subtitle="Hrad · Beroun, Česko"
            trailing={<IconButton icon="more_vert" label="Možnosti" size="sm" round />}
            onClick={() => undefined}
          />
          <Divider inset />
          <ListItem
            icon="rv_hookup"
            iconColor="var(--layer-stay)"
            title="Camping Slapy"
            subtitle="Elektřina · voda · sprchy"
            trailing={<Switch checked label="Zapnout vrstvu" onChange={() => undefined} />}
          />
          <Divider inset />
          <ListItem icon="route" title="Aktivní" subtitle="Vybraný řádek" active onClick={() => undefined} />
        </Section>

        <Section title="Accordion" eyebrow="Struktura">
          <Accordion
            value={["world"]}
            sections={[
              {
                id: "world",
                title: "Svět",
                icon: "public",
                count: 2,
                children: (
                  <>
                    <ListItem icon="public" title="Default" subtitle="Čistý MapOS" onClick={() => undefined} />
                    <ListItem
                      icon="stadia_controller"
                      title="Aavegotchi"
                      subtitle="Questy a zóny"
                      onClick={() => undefined}
                    />
                  </>
                )
              },
              {
                id: "categories",
                title: "Kategorie",
                icon: "layers",
                count: 12,
                action: <InfoTip title="Kategorie">Počet je počet zapnutých vrstev v kategorii.</InfoTip>,
                children: <EmptyState title="Zapni kategorii a objeví se na mapě." />
              }
            ]}
          />
        </Section>

        <Section title="Tabs" eyebrow="Struktura">
          <Tabs
            value={tab}
            onValueChange={setTab}
            tabs={[
              { id: "guide", label: "Průvodce", icon: "menu_book", children: <p>Text průvodce.</p> },
              { id: "numbers", label: "Čísla", icon: "signal_cellular_alt", count: 8, children: <p>Statistiky.</p> },
              { id: "photos", label: "Fotky", icon: "photo_library", children: <p>Galerie.</p> }
            ]}
          />
        </Section>

        <Section title="Overlays" eyebrow="Struktura">
          <div className="kit-gallery-row">
            <Tooltip content="Vycentruje mapu na tvou polohu">
              <Button variant="outlined" icon="my_location">
                S tooltipem
              </Button>
            </Tooltip>
            <Popover
              title="Filtr vrstvy"
              trigger={
                <Button variant="outlined" icon="filter_list">
                  Popover
                </Button>
              }
            >
              <Checkbox checked label="Jen s elektřinou" onChange={() => undefined} />
              <Checkbox checked={false} label="Jen otevřené" onChange={() => undefined} />
            </Popover>
            <Menu
              trigger={<IconButton icon="more_vert" label="Možnosti" variant="outlined" />}
              actions={[
                { id: "share", label: "Sdílet", icon: "share", onSelect: () => undefined },
                { id: "export", label: "Uložit GPX", icon: "download", onSelect: () => undefined },
                {
                  id: "delete",
                  label: "Smazat plán",
                  icon: "delete",
                  destructive: true,
                  onSelect: () => undefined
                }
              ]}
            />
            <Button variant="outlined" onClick={() => setDialogOpen(true)}>
              Dialog
            </Button>
            <Button variant="outlined" onClick={() => setConfirmOpen(true)}>
              Potvrzení
            </Button>
            <InfoTip title="Co se odesílá">
              <p>AI dostane výřez mapy, zapnuté vrstvy a tvůj dotaz.</p>
              <p>Neposíláme tvou přesnou polohu ani uložená místa.</p>
            </InfoTip>
          </div>
        </Section>

        <Section title="Stav" eyebrow="Zpětná vazba">
          <div className="kit-gallery-row">
            <ProgressCircular />
            <ProgressCircular size={32} />
            <Button
              variant="outlined"
              onClick={() => notify("Vrstva zapnutá", { description: "Kempy · 42 míst", tone: "success" })}
            >
              Toast
            </Button>
            <Button
              variant="outlined"
              onClick={() =>
                notify("Trasu nešlo spočítat", {
                  tone: "danger",
                  description: "Zkus jinou zastávku.",
                  action: { label: "Zkusit znovu", onClick: () => undefined }
                })
              }
            >
              Chybový toast
            </Button>
          </div>
          <ProgressLinear label="Import vrstvy" value={0.62} />
          <ProgressLinear label="Načítám dlaždice" />
          <Skeleton count={3} />
          <InlineNotice tone="warning">Data pro tuhle oblast jsou starší než rok.</InlineNotice>
          <InlineNotice tone="danger">Vrstva se nepodařila načíst.</InlineNotice>
          <EmptyState
            icon="route"
            title="Přidej první zastávku a spočítáme trasu."
            actionLabel="Přidat zastávku"
            onAction={() => undefined}
          />
        </Section>

        <Section title={`Ikony (${ICON_NAMES.length})`} eyebrow="Zobrazení">
          <div className="kit-gallery-icons">
            {ICON_NAMES.map((name) => (
              <span key={name} className="kit-gallery-icon" title={name}>
                <Icon name={name} size={24} />
                <small>{name}</small>
              </span>
            ))}
          </div>
        </Section>
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Sdílet plán"
        description="Odkaz uvidí každý, komu ho pošleš."
        footer={
          <>
            <Button variant="text" onClick={() => setDialogOpen(false)}>
              Zavřít
            </Button>
            <Button variant="filled" icon="content_copy">
              Kopírovat odkaz
            </Button>
          </>
        }
      >
        <TextField label="Odkaz" value="https://mapos.app/p/abc123" onChange={() => undefined} readOnly />
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Smazat plán?"
        description="Zastávky ani trasu už nepůjde obnovit."
        confirmLabel="Smazat"
        onConfirm={() => undefined}
        destructive
      />
    </div>
  );
}
