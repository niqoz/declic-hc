import { clamp } from "./calculate.js";
import type {
  Appliance,
  AppliancePreset,
  LegacySimulatorState,
  OffPeakWindow,
  SimulatorState,
  Tariff,
} from "./types.js";

export const STATE_STORAGE_KEY = "hphc-simulator-state";
export const CURRENT_STATE_VERSION = 2;

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

const isFiniteNonNegative = (value: unknown): value is number => Number.isFinite(value) && Number(value) >= 0;
const validTime = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

function cloneDefaults(defaults: SimulatorState): SimulatorState {
  return {
    ...defaults,
    version: CURRENT_STATE_VERSION,
    tariffs: defaults.tariffs.map((tariff) => ({ ...tariff })),
    appliances: defaults.appliances.map((appliance) => ({ ...appliance })),
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

function migrateAppliances(
  state: LegacySimulatorState,
  fallback: Appliance[],
  presets: AppliancePreset[],
  annualKwh: number,
) {
  if (!Array.isArray(state.appliances)) return fallback.map((appliance) => ({ ...appliance }));
  const legacyReferenceKwh = isFiniteNonNegative(state.recipeReferenceKwh) && state.recipeReferenceKwh > 0
    ? state.recipeReferenceKwh
    : annualKwh || 4500;
  const legacyScale = state.consumptionMode === "proportional" ? annualKwh / legacyReferenceKwh : 1;

  return state.appliances.map((candidate, index) => {
    const appliance = candidate as Partial<Appliance>;
    const hasIndividualMode = appliance.mode === "fixed" || appliance.mode === "proportional";
    const matchingPreset = presets.find((preset) => preset.name === appliance.name);
    const legacyKwh = isFiniteNonNegative(appliance.kwh) ? appliance.kwh : 0;
    return {
      id: Number.isFinite(appliance.id) ? Number(appliance.id) : index + 1,
      name: typeof appliance.name === "string" ? appliance.name : `Usage ${index + 1}`,
      kwh: hasIndividualMode ? legacyKwh : matchingPreset?.kwh ?? legacyKwh * legacyScale,
      inOffPeak: Boolean(appliance.inOffPeak),
      mode: hasIndividualMode ? appliance.mode! : matchingPreset?.mode ?? "fixed",
      referenceKwh: isFiniteNonNegative(appliance.referenceKwh) && appliance.referenceKwh > 0
        ? appliance.referenceKwh
        : matchingPreset?.referenceKwh ?? (annualKwh || 4500),
    } satisfies Appliance;
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
