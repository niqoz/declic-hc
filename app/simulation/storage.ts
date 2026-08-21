import { clamp } from "./calculate.js";
import { INTERNAL_ESTIMATE_SOURCE } from "./presets.js";
import { REFERENCE_RESIDENTS, scaleApplianceForHousehold } from "./scaling.js";
import type {
  Appliance,
  AppliancePreset,
  ApplianceSource,
  CalculationMode,
  HeatingSettings,
  LegacyAppliance,
  LegacySimulatorState,
  OffPeakWindow,
  SimulatorState,
  SourceKind,
  Tariff,
} from "./types.js";

export const STATE_STORAGE_KEY = "hphc-simulator-state";
export const CURRENT_STATE_VERSION = 6;

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

const isFiniteNonNegative = (value: unknown): value is number => Number.isFinite(value) && Number(value) >= 0;
const validTime = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const validCalculationMode = (value: unknown): value is CalculationMode => value === "reference" || value === "detailed" || value === "measured";
const validSourceKind = (value: unknown): value is SourceKind => value === "internal" || value === "official" || value === "user";

function cloneSource(source: ApplianceSource) {
  return { ...source };
}

function cloneAppliance(appliance: Appliance): Appliance {
  return { ...appliance, source: cloneSource(appliance.source) };
}

function cloneDefaults(defaults: SimulatorState): SimulatorState {
  return {
    ...defaults,
    version: CURRENT_STATE_VERSION,
    tariffs: defaults.tariffs.map((tariff) => ({ ...tariff })),
    appliances: defaults.appliances.map(cloneAppliance),
    heating: { ...defaults.heating },
    offPeakWindows: defaults.offPeakWindows.map((window) => ({ ...window })),
  };
}

function migrateHeating(value: unknown, fallback: HeatingSettings): HeatingSettings {
  if (!value || typeof value !== "object") return { ...fallback };
  const heating = value as Partial<HeatingSettings>;
  return {
    enabled: typeof heating.enabled === "boolean" ? heating.enabled : fallback.enabled,
    surfaceM2: isFiniteNonNegative(heating.surfaceM2) ? clamp(heating.surfaceM2, 10, 400) : fallback.surfaceM2,
    system: heating.system === "radiators" || heating.system === "heat-pump" ? heating.system : fallback.system,
    dwellingType: heating.dwellingType === "house" || heating.dwellingType === "apartment" ? heating.dwellingType : fallback.dwellingType,
    insulation: heating.insulation === "good" || heating.insulation === "standard" || heating.insulation === "poor" ? heating.insulation : fallback.insulation,
    altitude: heating.altitude === "low" || heating.altitude === "medium" || heating.altitude === "high" ? heating.altitude : fallback.altitude,
    occupancy: heating.occupancy === "away" || heating.occupancy === "mixed" || heating.occupancy === "home" ? heating.occupancy : fallback.occupancy,
  };
}

function migrateTariffs(value: unknown, fallback: Tariff[]) {
  if (!Array.isArray(value)) return fallback.map((tariff) => ({ ...tariff }));
  const tariffs = value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as Partial<Tariff>;
    const values = [row.power, row.baseSubscription, row.hphcSubscription, row.basePrice, row.hpPrice, row.hcPrice];
    if (!values.every(isFiniteNonNegative)) return [];
    return [{
      power: Number(row.power),
      baseSubscription: Number(row.baseSubscription),
      hphcSubscription: Number(row.hphcSubscription),
      basePrice: Number(row.basePrice),
      hpPrice: Number(row.hpPrice),
      hcPrice: Number(row.hcPrice),
    }];
  });
  return tariffs.length ? tariffs : fallback.map((tariff) => ({ ...tariff }));
}

function sanitizeSource(value: unknown, fallback: ApplianceSource): ApplianceSource {
  if (!value || typeof value !== "object") return cloneSource(fallback);
  const source = value as Partial<ApplianceSource>;
  return {
    kind: validSourceKind(source.kind) ? source.kind : fallback.kind,
    organization: typeof source.organization === "string" && source.organization.trim() ? source.organization : fallback.organization,
    label: typeof source.label === "string" && source.label.trim() ? source.label : fallback.label,
    ...(isFiniteNonNegative(source.year) ? { year: source.year } : {}),
    ...(typeof source.url === "string" && source.url ? { url: source.url } : {}),
  };
}

function sanitizeCurrentAppliance(candidate: LegacyAppliance, index: number, matchingPreset?: AppliancePreset): Appliance | null {
  if (!isFiniteNonNegative(candidate.annualKwh)) return null;
  const annualKwh = candidate.annualKwh;
  const lowKwh = isFiniteNonNegative(candidate.lowKwh) ? Math.min(candidate.lowKwh, annualKwh) : annualKwh;
  const highKwh = isFiniteNonNegative(candidate.highKwh) ? Math.max(candidate.highKwh, annualKwh) : annualKwh;
  return {
    id: Number.isFinite(candidate.id) ? Number(candidate.id) : index + 1,
    type: typeof candidate.type === "string" && candidate.type ? candidate.type : matchingPreset?.type ?? "custom",
    name: typeof candidate.name === "string" && candidate.name ? candidate.name : `Usage ${index + 1}`,
    annualKwh,
    lowKwh,
    highKwh,
    calculationMode: validCalculationMode(candidate.calculationMode) ? candidate.calculationMode : "reference",
    source: sanitizeSource(candidate.source, matchingPreset?.source ?? INTERNAL_ESTIMATE_SOURCE),
  };
}

function migrateLegacyAppliance(
  candidate: LegacyAppliance,
  index: number,
  annualKwh: number,
  presets: AppliancePreset[],
) {
  const matchingPreset = presets.find((preset) => preset.name === candidate.name);
  const legacyKwh = isFiniteNonNegative(candidate.kwh) ? candidate.kwh : matchingPreset?.annualKwh ?? 0;
  const referenceKwh = isFiniteNonNegative(candidate.referenceKwh) && candidate.referenceKwh > 0
    ? candidate.referenceKwh
    : annualKwh || 4500;
  const centralKwh = candidate.mode === "proportional"
    ? legacyKwh * annualKwh / referenceKwh
    : candidate.mode === "fixed"
      ? legacyKwh
      : matchingPreset?.annualKwh ?? legacyKwh;
  const presetScale = matchingPreset && matchingPreset.annualKwh > 0 ? centralKwh / matchingPreset.annualKwh : 1;
  const lowKwh = matchingPreset ? matchingPreset.lowKwh * presetScale : centralKwh * 0.7;
  const highKwh = matchingPreset ? matchingPreset.highKwh * presetScale : centralKwh * 1.3;
  return {
    id: Number.isFinite(candidate.id) ? Number(candidate.id) : index + 1,
    type: matchingPreset?.type ?? "custom",
    name: typeof candidate.name === "string" && candidate.name ? candidate.name : `Usage ${index + 1}`,
    annualKwh: centralKwh,
    lowKwh,
    highKwh,
    calculationMode: "reference",
    source: cloneSource(matchingPreset?.source ?? INTERNAL_ESTIMATE_SOURCE),
  } satisfies Appliance;
}

function migrateAppliances(
  state: LegacySimulatorState,
  fallback: Appliance[],
  presets: AppliancePreset[],
  annualKwh: number,
) {
  if (!Array.isArray(state.appliances)) return fallback.map(cloneAppliance);
  return state.appliances.flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const candidate = value as LegacyAppliance;
    const matchingPreset = presets.find((preset) => preset.name === candidate.name);
    const migrated = isFiniteNonNegative(candidate.annualKwh)
      ? sanitizeCurrentAppliance(candidate, index, matchingPreset)
      : migrateLegacyAppliance(candidate, index, annualKwh, presets);
    return migrated ? [migrated] : [];
  });
}

function refreshCalibratedReferences(
  appliances: Appliance[],
  presets: AppliancePreset[],
  annualKwh: number,
  residents: number,
) {
  return appliances.map((appliance) => {
    if (appliance.calculationMode !== "reference") return appliance;
    const preset = presets.find((candidate) => candidate.type === appliance.type);
    if (!preset) return appliance;
    return scaleApplianceForHousehold({
      ...appliance,
      annualKwh: preset.annualKwh,
      lowKwh: preset.lowKwh,
      highKwh: preset.highKwh,
      source: cloneSource(preset.source),
    }, {
      annualKwh: 4500,
      residents: REFERENCE_RESIDENTS,
    }, {
      annualKwh,
      residents,
    });
  });
}

function migrateWindows(value: unknown, fallback: OffPeakWindow[]) {
  if (!Array.isArray(value)) return fallback.map((window) => ({ ...window }));
  const windows = value.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const window = candidate as Partial<OffPeakWindow>;
    if (!validTime(window.start) || !validTime(window.end) || window.start === window.end) return [];
    return [{
      id: Number.isFinite(window.id) ? Number(window.id) : index + 1,
      start: window.start,
      end: window.end,
    }];
  });
  return windows.length ? windows : fallback.map((window) => ({ ...window }));
}

export function migrateSimulationState(
  value: unknown,
  defaults: SimulatorState,
  presets: AppliancePreset[],
): SimulatorState {
  if (!value || typeof value !== "object") return cloneDefaults(defaults);
  const state = value as LegacySimulatorState;
  const annualKwh = isFiniteNonNegative(state.annualKwh) ? state.annualKwh : defaults.annualKwh;
  const tariffs = migrateTariffs(state.tariffs, defaults.tariffs);
  const offPeakWindows = migrateWindows(state.offPeakWindows, defaults.offPeakWindows);
  const requestedPower = isFiniteNonNegative(state.power) ? state.power : defaults.power;
  const power = tariffs.some((tariff) => tariff.power === requestedPower) ? requestedPower : tariffs[0].power;
  const requestedWindowId = Number.isFinite(state.activeOffPeakWindowId)
    ? Number(state.activeOffPeakWindowId)
    : defaults.activeOffPeakWindowId;
  const activeOffPeakWindowId = offPeakWindows.some((window) => window.id === requestedWindowId)
    ? requestedWindowId
    : offPeakWindows[0].id;
  const residents = isFiniteNonNegative(state.residents) && state.residents >= 1
    ? Math.min(12, Math.round(state.residents))
    : defaults.residents;
  const migratedAppliances = migrateAppliances(state, defaults.appliances, presets, annualKwh);
  const appliances = Number(state.version ?? 0) < CURRENT_STATE_VERSION
    ? refreshCalibratedReferences(migratedAppliances, presets, annualKwh, residents)
    : migratedAppliances;

  return {
    version: CURRENT_STATE_VERSION,
    tariffs,
    power,
    annualKwh,
    residents,
    backgroundHcShare: Number.isFinite(state.backgroundHcShare)
      ? clamp(Number(state.backgroundHcShare), 0, 100)
      : defaults.backgroundHcShare,
    appliances,
    heating: migrateHeating(state.heating, defaults.heating),
    offPeakWindows,
    activeOffPeakWindowId,
  };
}

export function loadSimulationState(
  storage: StorageReader,
  defaults: SimulatorState,
  presets: AppliancePreset[],
) {
  try {
    const serialized = storage.getItem(STATE_STORAGE_KEY);
    if (!serialized) return cloneDefaults(defaults);
    return migrateSimulationState(JSON.parse(serialized), defaults, presets);
  } catch {
    return cloneDefaults(defaults);
  }
}

export function saveSimulationState(storage: StorageWriter, state: Omit<SimulatorState, "version">) {
  storage.setItem(STATE_STORAGE_KEY, JSON.stringify({ ...state, version: CURRENT_STATE_VERSION }));
}
