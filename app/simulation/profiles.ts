import { CURRENT_STATE_VERSION, loadSimulationState, migrateSimulationState, STATE_STORAGE_KEY } from "./storage.js";
import type {
  AppliancePreset,
  ProfilesStore,
  SavedProfile,
  SimulatorState,
  SimulatorStateInput,
} from "./types.js";

export const PROFILES_STORAGE_KEY = "hphc-profiles";
export const PROFILES_STORE_VERSION = 4;
const DEFAULT_PROFILE_NAME = "Ma simulation";

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem" | "removeItem">;

export function generateProfileId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createSavedProfile(name: string, state: SimulatorStateInput): SavedProfile {
  const now = new Date().toISOString();
  return {
    id: generateProfileId(),
    name,
    state: deepCloneState(state),
    createdAt: now,
    updatedAt: now,
  };
}

function deepCloneState(state: SimulatorStateInput): SimulatorStateInput {
  return {
    tariffs: state.tariffs.map((tariff) => ({ ...tariff })),
    power: state.power,
    annualKwh: state.annualKwh,
    energyMode: state.energyMode,
    projectedBackgroundKwh: state.projectedBackgroundKwh,
    residents: state.residents,
    backgroundHcShare: state.backgroundHcShare,
    appliances: state.appliances.map((appliance) => ({ ...appliance, source: { ...appliance.source } })),
    heating: { ...state.heating },
    offPeakWindows: state.offPeakWindows.map((window) => ({ ...window })),
    activeOffPeakWindowId: state.activeOffPeakWindowId,
  };
}

function stateInputFromState(state: SimulatorState): SimulatorStateInput {
  return {
    tariffs: state.tariffs,
    power: state.power,
    annualKwh: state.annualKwh,
    energyMode: state.energyMode,
    projectedBackgroundKwh: state.projectedBackgroundKwh,
    residents: state.residents,
    backgroundHcShare: state.backgroundHcShare,
    appliances: state.appliances,
    heating: state.heating,
    offPeakWindows: state.offPeakWindows,
    activeOffPeakWindowId: state.activeOffPeakWindowId,
  };
}

function isValidProfile(value: unknown): value is SavedProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Record<string, unknown>;
  return typeof profile.id === "string"
    && typeof profile.name === "string"
    && typeof profile.createdAt === "string"
    && typeof profile.updatedAt === "string"
    && profile.state != null
    && typeof profile.state === "object";
}

function emptyStore(): ProfilesStore {
  return { version: PROFILES_STORE_VERSION, profiles: [], activeProfileId: null };
}

export function loadProfilesStore(storage: StorageReader): ProfilesStore {
  try {
    const serialized = storage.getItem(PROFILES_STORAGE_KEY);
    if (!serialized) return emptyStore();
    const parsed = JSON.parse(serialized) as Partial<ProfilesStore>;
    if (!Array.isArray(parsed.profiles)) return emptyStore();
    const profiles = parsed.profiles.filter(isValidProfile);
    const activeProfileId = profiles.some((profile) => profile.id === parsed.activeProfileId)
      ? parsed.activeProfileId ?? null
      : (profiles[0]?.id ?? null);
    const version = Number.isFinite(parsed.version) ? Number(parsed.version) : 1;
    return { version, profiles, activeProfileId };
  } catch {
    return emptyStore();
  }
}

export function saveProfilesStore(storage: StorageWriter, store: ProfilesStore): void {
  storage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(store));
}

export function migrateFromLegacyState(
  storage: StorageReader & StorageWriter,
  defaults: SimulatorState,
  presets: AppliancePreset[],
): ProfilesStore {
  const store = loadProfilesStore(storage);
  if (store.profiles.length > 0) {
    if (store.version >= PROFILES_STORE_VERSION) return store;
    const profiles = store.profiles.map((profile) => {
      const migrated = migrateSimulationState(
        { ...profile.state, version: CURRENT_STATE_VERSION - 1 },
        defaults,
        presets,
      );
      return { ...profile, state: stateInputFromState(migrated), updatedAt: new Date().toISOString() };
    });
    const upgraded = { ...store, version: PROFILES_STORE_VERSION, profiles };
    saveProfilesStore(storage, upgraded);
    return upgraded;
  }
  try {
    const legacyRaw = storage.getItem(STATE_STORAGE_KEY);
    const migrated = legacyRaw
      ? loadSimulationState(storage, defaults, presets)
      : migrateSimulationState(defaults, defaults, presets);
    const stateInput = stateInputFromState(migrated);
    const profile = createSavedProfile(DEFAULT_PROFILE_NAME, stateInput);
    const next: ProfilesStore = { version: PROFILES_STORE_VERSION, profiles: [profile], activeProfileId: profile.id };
    saveProfilesStore(storage, next);
    if (legacyRaw) storage.removeItem(STATE_STORAGE_KEY);
    return next;
  } catch {
    return store;
  }
}

export function getActiveProfile(store: ProfilesStore): SavedProfile | null {
  return store.profiles.find((profile) => profile.id === store.activeProfileId) ?? null;
}

export function upsertProfile(store: ProfilesStore, profileId: string, state: SimulatorStateInput): ProfilesStore {
  const existing = store.profiles.find((profile) => profile.id === profileId);
  if (existing) {
    const updated: SavedProfile = { ...existing, state: deepCloneState(state), updatedAt: new Date().toISOString() };
    return { ...store, profiles: store.profiles.map((profile) => profile.id === profileId ? updated : profile) };
  }
  return store;
}

export function addProfile(store: ProfilesStore, name: string, state: SimulatorStateInput): { store: ProfilesStore; profile: SavedProfile } {
  const profile = createSavedProfile(name, state);
  return {
    store: { ...store, profiles: [...store.profiles, profile], activeProfileId: profile.id },
    profile,
  };
}

export function removeProfile(store: ProfilesStore, profileId: string): ProfilesStore {
  const profiles = store.profiles.filter((profile) => profile.id !== profileId);
  const activeProfileId = store.activeProfileId === profileId ? (profiles[0]?.id ?? null) : store.activeProfileId;
  return { ...store, profiles, activeProfileId };
}

export function renameProfile(store: ProfilesStore, profileId: string, name: string): ProfilesStore {
  return {
    ...store,
    profiles: store.profiles.map((profile) => profile.id === profileId ? { ...profile, name, updatedAt: new Date().toISOString() } : profile),
  };
}

export function setActiveProfile(store: ProfilesStore, profileId: string): ProfilesStore {
  if (!store.profiles.some((profile) => profile.id === profileId)) return store;
  return { ...store, activeProfileId: profileId };
}

type ExportEnvelope = {
  app: string;
  version: string;
  exportedAt: string;
  profile: SavedProfile;
};

export function buildExportEnvelope(profile: SavedProfile, appVersion: string): ExportEnvelope {
  return {
    app: "declic-hc",
    version: appVersion,
    exportedAt: new Date().toISOString(),
    profile: { ...profile, state: deepCloneState(profile.state) },
  };
}

export function downloadProfileJson(profile: SavedProfile, appVersion: string): void {
  const envelope = buildExportEnvelope(profile, appVersion);
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const slug = profile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "simulation";
  anchor.download = `declic-hc-${slug}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function parseProfileJson(text: string): SavedProfile {
  const parsed = JSON.parse(text);
  const candidate = parsed?.profile ?? parsed;
  if (!isValidProfile(candidate)) {
    throw new Error("Format de profil invalide");
  }
  return {
    id: generateProfileId(),
    name: candidate.name,
    state: candidate.state as SimulatorStateInput,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(typeof parsed?.version === "string" ? { importedAppVersion: parsed.version } : {}),
  };
}

export function readProfileFile(file: File): Promise<SavedProfile> {
  return file.text().then((text) => parseProfileJson(text));
}
