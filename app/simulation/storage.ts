import { clamp } from "./calculate.js";
import { INTERNAL_ESTIMATE_SOURCE } from "./presets.js";
import type {
  Appliance,
  AppliancePreset,
  ApplianceSource,
  CalculationMode,
  LegacyAppliance,
  LegacySimulatorState,
  OffPeakWindow,
  SimulatorState,
  SourceKind,
  Tariff,
} from "./types.js";

export const STATE_STORAGE_KEY = "hphc-simulator-state";
export const CURRENT_STATE_VERSION = 3;

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
    offPeakWindows: defaults.offPeakWindows.map((window) => ({ ...window })),
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
  const shiftableShare = clamp(Number(candidate.shiftableShare), 0, 100);
  return {
    id: Number.isFinite(candidate.id) ? Number(candidate.id) : index + 1,
    type: typeof candidate.type === "string" && candidate.type ? candidate.type : matchingPreset?.type ?? "custom",
    name: typeof candidate.name === "string" && candidate.name ? candidate.name : `Usage ${index + 1}`,
    annualKwh,
    lowKwh,
    highKwh,
    calculationMode: validCalculationMode(candidate.calculationMode) ? candidate.calculationMode : "reference",
    shiftableShare,
    offPeakShare: clamp(Number(candidate.offPeakShare), 0, shiftableShare),
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
  const shiftableShare = matchingPreset?.shiftableShare ?? 100;

  return {
    id: Number.isFinite(candidate.id) ? Number(candidate.id) : index + 1,
    type: matchingPreset?.type ?? "custom",
    name: typeof candidate.name === "string" && candidate.name ? candidate.name : `Usage ${index + 1}`,
    annualKwh: centralKwh,
    lowKwh,
    highKwh,
    calculationMode: "reference",
    shiftableShare,
    offPeakShare: candidate.inOffPeak ? shiftableShare : 0,
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

  return {
    version: CURRENT_STATE_VERSION,
    tariffs,
    power,
    annualKwh,
    backgroundHcShare: Number.isFinite(state.backgroundHcShare)
      ? clamp(Number(state.backgroundHcShare), 0, 100)
      : defaults.backgroundHcShare,
    appliances: migrateAppliances(state, defaults.appliances, presets, annualKwh),
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
