import {
  resolvePlanRoutingRequestV2,
  type PlanCommandV2,
  type PlanDocumentV2,
  type PlanRoutePreferenceV2,
  type PlanRoutingProviderV2,
  type PlanTravelProfileV2
} from "@mapos/layer-sdk";
import { useEffect } from "react";
import { localDateTime, planOptionsSummary } from "../../planning/planFormat";
import {
  Accordion,
  InfoTip,
  Popover,
  IconButton,
  SegmentedButton,
  Select,
  Switch,
  TextField,
  type SelectOption
} from "../kit";

export const PLAN_PROFILE_OPTIONS: readonly SelectOption<PlanTravelProfileV2>[] = [
  { value: "car", label: "Auto", icon: "directions_car" },
  { value: "camper", label: "Obytné auto", icon: "rv_hookup" },
  { value: "truck", label: "Kamion", icon: "local_shipping" },
  { value: "moto", label: "Motorka", icon: "two_wheeler" },
  { value: "bike", label: "Kolo", icon: "directions_bike" },
  { value: "foot", label: "Pěšky", icon: "directions_walk" }
];

const PREFERENCE_OPTIONS = [
  { value: "fast", label: "Rychlá" },
  { value: "short", label: "Krátká" },
  { value: "nohwy", label: "Bez dálnic" },
  { value: "adventure", label: "Dobrodružná" }
] as const;

const DETOUR_OPTIONS = [
  { value: "10", label: "10 %" },
  { value: "15", label: "15 %" },
  { value: "25", label: "25 %" }
] as const;

const VEHICLE_LIMITS = [
  { field: "heightM", label: "Výška m" },
  { field: "widthM", label: "Šířka m" },
  { field: "weightT", label: "Hmotnost t" }
] as const;

export function planProfileLabel(profile: PlanTravelProfileV2): string {
  return PLAN_PROFILE_OPTIONS.find((option) => option.value === profile)?.label ?? profile;
}

export function planPreferenceLabel(preference: PlanRoutePreferenceV2): string {
  return PREFERENCE_OPTIONS.find((option) => option.value === preference)?.label ?? preference;
}

/** Everything about a plan that is a setting rather than a stop (§4.5).
 *
 *  Collapsed by default; the header carries the summary so a departure time or a vehicle that
 *  was set stays visible without opening the section. */
export function PlanOptions({
  plan,
  provider,
  disabled,
  detourLimit,
  contextNotes,
  onDetourLimit,
  onCommand
}: {
  plan: PlanDocumentV2;
  provider: PlanRoutingProviderV2;
  disabled: boolean;
  detourLimit: number;
  /** What the last temporal-context call actually returned — source attribution and the
   *  provider's own reason for missing data, which §29.3 moved out of a separate card. */
  contextNotes: readonly string[];
  onDetourLimit: (next: number) => void;
  onCommand: (command: PlanCommandV2) => void;
}) {
  const profile = plan.routePolicy.profile;
  const preference = plan.routePolicy.preference;
  const showVehicleLimits = profile === "camper" || profile === "truck";
  const mapping = resolvePlanRoutingRequestV2(
    provider,
    profile,
    preference,
    plan.routePolicy.avoid
  );
  const nativeMapping =
    mapping.profileCapability === "native" && mapping.preferenceCapability === "native";

  // §29.3: the request the provider will actually get is diagnostics, not interface. It stays
  // available for a bug report, behind `?debug=1`.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!new URLSearchParams(window.location.search).has("debug")) return;
    console.info("[mapos] plan routing request", {
      provider,
      profile: mapping.providerProfile,
      preference: mapping.effectivePreference,
      native: nativeMapping
    });
  }, [mapping.effectivePreference, mapping.providerProfile, nativeMapping, profile, provider]);

  const summary = planOptionsSummary([
    plan.departureAt
      ? new Date(plan.departureAt).toLocaleString("cs-CZ", {
          weekday: "short",
          day: "numeric",
          month: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        })
      : null,
    planProfileLabel(profile),
    planPreferenceLabel(preference)
  ]);

  return (
    <Accordion
      testId="plan-options"
      sections={[
        {
          id: "options",
          title: "Více možností",
          icon: "tune",
          testId: "plan-more-options",
          action: <span className="planner-options-summary">{summary}</span>,
          children: (
            <div className="planner-options">
              <div className="planner-options-grid">
                <TextField
                  type="datetime-local"
                  label="Datum odjezdu"
                  disabled={disabled}
                  value={localDateTime(plan.departureAt)}
                  onChange={(event) =>
                    onCommand({
                      type: "set-departure",
                      departureAt: event.target.value
                        ? new Date(event.target.value).toISOString()
                        : null
                    })
                  }
                />
                <Select<PlanTravelProfileV2>
                  label="Typ vozidla"
                  testId="plan-vehicle"
                  disabled={disabled}
                  value={profile}
                  options={PLAN_PROFILE_OPTIONS}
                  onChange={(next) =>
                    onCommand({
                      type: "replace-vehicle",
                      vehicle: { ...(plan.vehicle ?? { profile: next }), profile: next }
                    })
                  }
                />
              </div>

              {showVehicleLimits && (
                <div className="planner-options-grid three" data-testid="plan-vehicle-limits">
                  {VEHICLE_LIMITS.map(({ field, label }) => (
                    <TextField
                      key={field}
                      type="number"
                      min={0}
                      step={0.1}
                      label={label}
                      disabled={disabled}
                      value={plan.vehicle?.[field] ?? ""}
                      onChange={(event) =>
                        onCommand({
                          type: "replace-vehicle",
                          vehicle: {
                            ...(plan.vehicle ?? { profile }),
                            [field]: event.target.value ? Number(event.target.value) : null
                          }
                        })
                      }
                    />
                  ))}
                </div>
              )}

              <div className="planner-options-field">
                <span className="kit-eyebrow">
                  Profil trasy
                  <InfoTip
                    title="Profil trasy"
                    label="Podpora profilu trasy"
                    testId="plan-profile-support"
                  >
                    {nativeMapping
                      ? "Vybrané vozidlo i profil zdroj tras počítá přímo."
                      : `Tuhle kombinaci zdroj tras neumí přímo; trasa vznikne podle nejbližšího podporovaného nastavení (${planPreferenceLabel(mapping.effectivePreference)}).`}
                  </InfoTip>
                  {preference === "adventure" && (
                    <Popover
                      title="Povolená zajížďka"
                      width={260}
                      testId="plan-detour-limit"
                      trigger={
                        <IconButton
                          icon="alt_route"
                          label="Povolená zajížďka"
                          size="sm"
                          variant="plain"
                          round
                        />
                      }
                    >
                      <SegmentedButton<string>
                        ariaLabel="Povolená zajížďka"
                        block
                        testId="adventure-limit"
                        value={String(detourLimit)}
                        options={DETOUR_OPTIONS}
                        onChange={(next) => onDetourLimit(Number(next))}
                      />
                    </Popover>
                  )}
                </span>
                <SegmentedButton<PlanRoutePreferenceV2>
                  ariaLabel="Profil trasy"
                  block
                  testId="plan-preference"
                  value={preference}
                  options={PREFERENCE_OPTIONS}
                  onChange={(next) =>
                    onCommand({
                      type: "replace-route-policy",
                      routePolicy: { ...plan.routePolicy, preference: next }
                    })
                  }
                />
              </div>

              <div className="planner-options-field">
                <span className="planner-options-switch">
                  <span>
                    Počasí a doprava po trase
                    <InfoTip
                      title="Kontext odjezdu"
                      label="Co ukáže kontext odjezdu"
                      testId="plan-context-info"
                    >
                      S datem odjezdu se u každého úseku ukáže čas příjezdu, teplota a varování;
                      dopravu doplní jen provider, který ji pro daný čas zná.
                      {contextNotes.map((note) => (
                        <span className="planner-context-note" key={note}>
                          {note}
                        </span>
                      ))}
                    </InfoTip>
                  </span>
                  <Switch
                    label="Počasí a doprava po trase"
                    testId="plan-context-switch"
                    disabled={disabled || !plan.departureAt}
                    checked={
                      plan.routePolicy.weatherAlongRoute !== false &&
                      plan.routePolicy.trafficAlongRoute !== false
                    }
                    onChange={(next) =>
                      onCommand({
                        type: "replace-route-policy",
                        routePolicy: {
                          ...plan.routePolicy,
                          weatherAlongRoute: next,
                          trafficAlongRoute: next
                        }
                      })
                    }
                  />
                </span>
                {!plan.departureAt && <p className="planner-hint">Aktivní až s datem odjezdu.</p>}
              </div>
            </div>
          )
        }
      ]}
    />
  );
}
