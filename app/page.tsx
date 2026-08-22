"use client";

import { ChangeEvent, InputHTMLAttributes, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  calculateSimulation,
  clamp,
  HOUSEHOLD_REFERENCE_KWH,
  summarizeDelta,
} from "./simulation/calculate";
import { confidenceLabel, getApplianceCalibration } from "./simulation/calibration";
import { estimateCoolingProfile } from "./simulation/cooling";
import { estimateHeating, HEATING_HIGH_RATIO, HEATING_LOW_RATIO, offPeakDurationMinutes, updateOffPeakWindowTime } from "./simulation/heating";
import { shouldAdoptExternalValue } from "./simulation/numeric-field";
import { REFERENCE_RESIDENTS, scaleAppliancesForResidents } from "./simulation/occupants";
import {
  APPLIANCE_PRESETS,
  DEFAULT_APPLIANCES,
  INTERNAL_ESTIMATE_SOURCE,
} from "./simulation/presets";
import {
  addProfile,
  downloadProfileJson,
  getActiveProfile,
  migrateFromLegacyState,
  PROFILES_STORE_VERSION,
  readProfileFile,
  removeProfile,
  renameProfile,
  saveProfilesStore,
  setActiveProfile,
  upsertProfile,
} from "./simulation/profiles";
import { CURRENT_STATE_VERSION, isDefaultSimulation, migrateSimulationState } from "./simulation/storage";
import { baseOptionNotice, tariffGridNotice, TARIFF_GRID_LABEL } from "./simulation/tariff";
import type {
  Appliance,
  AppliancePreset,
  CalculationMode,
  HeatingSettings,
  OffPeakWindow,
  ProfilesStore,
  SimulatorState,
  SimulatorStateInput,
  Tariff,
} from "./simulation/types";
import { APP_VERSION } from "./version";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DEFAULT_TARIFFS: Tariff[] = [
  { power: 3, baseSubscription: 133.59, hphcSubscription: 133.59, basePrice: 0.1834, hpPrice: 0.1964, hcPrice: 0.1457 },
  { power: 6, baseSubscription: 175.56, hphcSubscription: 175.56, basePrice: 0.1834, hpPrice: 0.1964, hcPrice: 0.1457 },
  { power: 9, baseSubscription: 220.69, hphcSubscription: 220.69, basePrice: 0.182, hpPrice: 0.1964, hcPrice: 0.1457 },
  { power: 12, baseSubscription: 264.23, hphcSubscription: 264.23, basePrice: 0.182, hpPrice: 0.1964, hcPrice: 0.1457 },
  { power: 15, baseSubscription: 305.14, hphcSubscription: 305.14, basePrice: 0.182, hpPrice: 0.1964, hcPrice: 0.1457 },
  { power: 18, baseSubscription: 347.24, hphcSubscription: 347.24, basePrice: 0.182, hpPrice: 0.1964, hcPrice: 0.1457 },
  { power: 24, baseSubscription: 436.97, hphcSubscription: 436.97, basePrice: 0.182, hpPrice: 0.1964, hcPrice: 0.1457 },
  { power: 30, baseSubscription: 519.44, hphcSubscription: 519.44, basePrice: 0.182, hpPrice: 0.1964, hcPrice: 0.1457 },
  { power: 36, baseSubscription: 602.71, hphcSubscription: 602.71, basePrice: 0.182, hpPrice: 0.1964, hcPrice: 0.1457 },
];

const DEFAULT_HC_WINDOWS: OffPeakWindow[] = [
  { id: 1, start: "21:40", end: "05:40" },
  { id: 2, start: "22:10", end: "06:10" },
  { id: 3, start: "22:45", end: "06:45" },
  { id: 4, start: "23:45", end: "07:45" },
];

// Version d'état embarquée par chaque génération de fichier exporté, l'export ne
// portant que le numéro de version de l'application.
const IMPORT_STATE_VERSIONS: [RegExp, number][] = [
  [/^0\.9\./, 8],
  [/^0\.(10|11)\./, 10],
];

const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const preciseEuros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const validTime = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const timeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};
const formatTime = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return `${hours} h ${String(minutes).padStart(2, "0")}`;
};
const formatDuration = (minutes: number) => minutes % 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}` : `${minutes / 60} h`;
const offPeakSegments = ({ start, end }: OffPeakWindow) => {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  if (startMinutes === endMinutes) return [];
  if (startMinutes < endMinutes) return [{ left: startMinutes / 14.4, width: (endMinutes - startMinutes) / 14.4 }];
  return [{ left: 0, width: endMinutes / 14.4 }, { left: startMinutes / 14.4, width: (1440 - startMinutes) / 14.4 }];
};

const DEFAULT_SIMULATOR_STATE: SimulatorState = {
  version: CURRENT_STATE_VERSION,
  tariffs: DEFAULT_TARIFFS,
  power: 6,
  annualKwh: HOUSEHOLD_REFERENCE_KWH,
  knownHeatingKwh: 0,
  residents: REFERENCE_RESIDENTS,
  backgroundHcShare: 25,
  appliances: DEFAULT_APPLIANCES,
  heating: {
    enabled: false,
    surfaceM2: 80,
    system: "radiators",
    dwellingType: "apartment",
    insulation: "standard",
    altitude: "low",
    occupancy: "away",
  },
  offPeakWindows: DEFAULT_HC_WINDOWS,
  activeOffPeakWindowId: DEFAULT_HC_WINDOWS[0].id,
};

const toStateInput = (state: SimulatorState): SimulatorStateInput => ({
  tariffs: state.tariffs,
  power: state.power,
  annualKwh: state.annualKwh,
  knownHeatingKwh: state.knownHeatingKwh,
  residents: state.residents,
  backgroundHcShare: state.backgroundHcShare,
  appliances: state.appliances,
  heating: state.heating,
  offPeakWindows: state.offPeakWindows,
  activeOffPeakWindowId: state.activeOffPeakWindowId,
});

export default function Home() {
  const [tariffs, setTariffs] = useState<Tariff[]>(DEFAULT_TARIFFS);
  const [power, setPower] = useState(6);
  const [annualKwh, setAnnualKwh] = useState(4500);
  const [knownHeatingKwh, setKnownHeatingKwh] = useState(0);
  const [residents, setResidents] = useState(REFERENCE_RESIDENTS);
  const residentsRef = useRef(REFERENCE_RESIDENTS);
  const nextApplianceIdRef = useRef(1000);
  const [backgroundHcShare, setBackgroundHcShare] = useState(25);
  const [appliances, setAppliances] = useState<Appliance[]>(DEFAULT_APPLIANCES);
  const [heating, setHeating] = useState<HeatingSettings>(DEFAULT_SIMULATOR_STATE.heating);
  const [tariffsOpen, setTariffsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installHelp, setInstallHelp] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [offPeakWindows, setOffPeakWindows] = useState<OffPeakWindow[]>(DEFAULT_HC_WINDOWS);
  const [activeOffPeakWindowId, setActiveOffPeakWindowId] = useState(DEFAULT_HC_WINDOWS[0].id);
  const [scheduleEditorOpen, setScheduleEditorOpen] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [profilesStore, setProfilesStore] = useState<ProfilesStore>({ version: PROFILES_STORE_VERSION, stateVersion: CURRENT_STATE_VERSION, profiles: [], activeProfileId: null });
  const activeProfileId = profilesStore.activeProfileId;
  const importProfileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const store = migrateFromLegacyState(localStorage, DEFAULT_SIMULATOR_STATE, APPLIANCE_PRESETS);
    const active = getActiveProfile(store);
    const state = active
      ? { ...active.state, version: CURRENT_STATE_VERSION }
      : DEFAULT_SIMULATOR_STATE;
    // Hydratation unique de la sauvegarde locale, disponible seulement après le montage côté client.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfilesStore(store);
    setTariffs(state.tariffs);
    setPower(state.power);
    setAnnualKwh(state.annualKwh);
    setKnownHeatingKwh(state.knownHeatingKwh);
    setResidents(state.residents);
    residentsRef.current = state.residents;
    setBackgroundHcShare(state.backgroundHcShare);
    setAppliances(state.appliances);
    setHeating(state.heating);
    nextApplianceIdRef.current = Math.max(1000, ...state.appliances.map((appliance) => appliance.id + 1));
    setOffPeakWindows(state.offPeakWindows);
    setActiveOffPeakWindowId(state.activeOffPeakWindowId);
    setStorageReady(true);
    if ("serviceWorker" in navigator) {
      const serviceWorkerUrl = new URL("sw.js", document.baseURI);
      navigator.serviceWorker.register(serviceWorkerUrl.pathname).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    // L'état d'installation dépend d'une API navigateur qui n'existe pas pendant le rendu serveur.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsInstalled(window.matchMedia("(display-mode: standalone)").matches);
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const confirmInstall = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
      setInstallHelp(false);
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", confirmInstall);
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", confirmInstall);
    };
  }, []);

  useEffect(() => {
    if (!storageReady || !activeProfileId) return;
    const stateInput: SimulatorStateInput = toStateInput({ version: CURRENT_STATE_VERSION, tariffs, power, annualKwh, knownHeatingKwh, residents, backgroundHcShare, appliances, heating, offPeakWindows, activeOffPeakWindowId });
    // Mise à jour du profil actif sans redéclencher l'effet sur le nouvel objet magasin.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfilesStore((current) => {
      const updated = upsertProfile(current, activeProfileId, stateInput);
      saveProfilesStore(localStorage, updated);
      return updated;
    });
  }, [storageReady, tariffs, power, annualKwh, knownHeatingKwh, residents, backgroundHcShare, appliances, heating, offPeakWindows, activeOffPeakWindowId, activeProfileId]);

  useEffect(() => {
    // Une plage active supprimée doit immédiatement basculer vers la première plage restante.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!offPeakWindows.some((window) => window.id === activeOffPeakWindowId)) setActiveOffPeakWindowId(offPeakWindows[0].id);
  }, [activeOffPeakWindowId, offPeakWindows]);

  const activeTariff = tariffs.find((tariff) => tariff.power === power) ?? tariffs[0];
  const activeOffPeakWindow = offPeakWindows.find((window) => window.id === activeOffPeakWindowId) ?? offPeakWindows[0];
  const heatingEstimate = useMemo(() => estimateHeating(heating, activeOffPeakWindow), [activeOffPeakWindow, heating]);
  const coolingProfile = useMemo(
    () => estimateCoolingProfile(heating.occupancy, activeOffPeakWindow, { surfaceM2: heating.surfaceM2, insulation: heating.insulation }),
    [activeOffPeakWindow, heating.insulation, heating.occupancy, heating.surfaceM2],
  );
  const modeledAppliances = useMemo(
    () => appliances.map((appliance) => appliance.type === "air-conditioning"
      ? { ...appliance,
        annualKwh: appliance.calculationMode === "measured" ? appliance.annualKwh : appliance.annualKwh * coolingProfile.demandFactor,
        lowKwh: appliance.calculationMode === "measured" ? appliance.lowKwh : appliance.lowKwh * coolingProfile.demandFactor,
        highKwh: appliance.calculationMode === "measured" ? appliance.highKwh : appliance.highKwh * coolingProfile.demandFactor,
        hcShare: coolingProfile.hcShare }
      : appliance),
    [appliances, coolingProfile],
  );
  // La quantité retenue reste le scénario central, mais elle garde la marge
  // d'incertitude du poste : une consommation de chauffage n'est jamais connue
  // au kWh près, même relevée sur une facture.
  const retainedHeating = useMemo(() => ({
    ...heatingEstimate,
    annualKwh: heating.enabled ? knownHeatingKwh : 0,
    lowKwh: heating.enabled ? knownHeatingKwh * HEATING_LOW_RATIO : 0,
    highKwh: heating.enabled ? knownHeatingKwh * HEATING_HIGH_RATIO : 0,
  }), [heating.enabled, heatingEstimate, knownHeatingKwh]);
  const results = useMemo(
    () => calculateSimulation({ annualKwh, backgroundHcShare, tariff: activeTariff, appliances: modeledAppliances, heating: retainedHeating }),
    [activeTariff, annualKwh, backgroundHcShare, modeledAppliances, retainedHeating],
  );

  function updateHeating(patch: Partial<HeatingSettings>) {
    setHeating((current) => ({ ...current, ...patch }));
  }

  function updateTariff(field: keyof Omit<Tariff, "power">, value: number) {
    setTariffs((current) => current.map((tariff) => tariff.power === power ? { ...tariff, [field]: Math.max(0, value) } : tariff));
  }

  function updateAppliance(id: number, patch: Partial<Appliance>) {
    setAppliances((current) => current.map((appliance) => appliance.id === id ? { ...appliance, ...patch } : appliance));
  }

  function updateAnnualKwh(value: number) {
    setAnnualKwh(Math.max(0, value));
  }

  function updateResidents(value: number) {
    const nextResidents = Math.min(12, Math.max(1, Math.round(value || 1)));
    const previousResidents = residentsRef.current;
    residentsRef.current = nextResidents;
    setResidents(nextResidents);
    setAppliances((current) => scaleAppliancesForResidents(current, previousResidents, nextResidents));
  }

  function updateApplianceKwh(id: number, annualKwhValue: number) {
    const appliance = appliances.find((item) => item.id === id);
    if (!appliance) return;
    const nextAnnualKwh = Math.max(0, annualKwhValue);
    if (appliance.calculationMode === "measured") {
      updateAppliance(id, { annualKwh: nextAnnualKwh, lowKwh: nextAnnualKwh, highKwh: nextAnnualKwh });
      return;
    }
    updateAppliance(id, {
      annualKwh: nextAnnualKwh,
      lowKwh: Math.min(appliance.lowKwh, nextAnnualKwh),
      highKwh: Math.max(appliance.highKwh, nextAnnualKwh),
    });
  }

  function addAppliance(preset?: AppliancePreset) {
    const model = preset ?? {
      type: "custom",
      name: "Nouvel usage",
      annualKwh: 150,
      lowKwh: 100,
      highKwh: 200,
      calculationMode: "reference" as CalculationMode,
      source: { ...INTERNAL_ESTIMATE_SOURCE },
    };
    const [appliance] = scaleAppliancesForResidents([{
      id: nextApplianceIdRef.current++,
      type: model.type,
      name: model.name,
      annualKwh: model.annualKwh,
      lowKwh: model.lowKwh,
      highKwh: model.highKwh,
      calculationMode: model.calculationMode,
      source: { ...model.source },
    }], REFERENCE_RESIDENTS, residents);
    setAppliances((current) => [...current, appliance]);
  }

  function updateCalculationMode(id: number, mode: CalculationMode) {
    const appliance = appliances.find((item) => item.id === id);
    if (!appliance) return;
    if (mode === "measured") {
      updateAppliance(id, {
        calculationMode: mode,
        lowKwh: appliance.annualKwh,
        highKwh: appliance.annualKwh,
        source: { kind: "user", organization: "Foyer", label: "Valeur mesurée ou relevée par l’utilisateur" },
      });
      return;
    }
    const preset = APPLIANCE_PRESETS.find((candidate) => candidate.type === appliance.type);
    const scale = preset && preset.annualKwh > 0 ? appliance.annualKwh / preset.annualKwh : 1;
    updateAppliance(id, {
      calculationMode: mode,
      lowKwh: preset ? preset.lowKwh * scale : appliance.annualKwh * 0.7,
      highKwh: preset ? preset.highKwh * scale : appliance.annualKwh * 1.3,
      source: { ...(preset?.source ?? INTERNAL_ESTIMATE_SOURCE) },
    });
  }

  function updateOffPeakWindow(id: number, field: "start" | "end", value: string) {
    setOffPeakWindows((current) => current.map((window) => (
      window.id === id ? updateOffPeakWindowTime(window, field, value) : window
    )));
  }

  function addOffPeakWindow() {
    setOffPeakWindows((current) => current.length >= 8 ? current : [...current, { id: Date.now(), start: "22:00", end: "06:00" }]);
  }

  function setTotalHcShare(totalShare: number) {
    if (results.totalKwh <= 0 || results.backgroundKwh <= 0) return;
    const desiredHcKwh = results.totalKwh * totalShare / 100;
    const backgroundShare = (desiredHcKwh - results.scheduledHc - results.heatingHcKwh) / results.backgroundKwh * 100;
    setBackgroundHcShare(clamp(backgroundShare, 0, 100));
  }

  async function installApp() {
    if (!installPrompt) {
      setInstallHelp(true);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setIsInstalled(true);
    setInstallPrompt(null);
  }

  function exportGrid() {
    const blob = new Blob([JSON.stringify({ name: "Grille tarifaire", tariffs }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "grille-tarifaire.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function importGrid(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      try {
        const parsed = JSON.parse(text);
        const imported = Array.isArray(parsed) ? parsed : parsed.tariffs;
        if (!Array.isArray(imported) || !imported.length) throw new Error();
        const clean = imported.map((row: Tariff) => ({
          power: Number(row.power), baseSubscription: Number(row.baseSubscription), hphcSubscription: Number(row.hphcSubscription),
          basePrice: Number(row.basePrice), hpPrice: Number(row.hpPrice), hcPrice: Number(row.hcPrice),
        })).filter((row: Tariff) => Object.values(row).every(Number.isFinite));
        if (!clean.length) throw new Error();
        setTariffs(clean);
        setPower(clean[0].power);
        setNotice("Grille importée avec succès.");
      } catch { setNotice("Ce fichier ne correspond pas au format attendu."); }
      event.target.value = "";
    });
  }

  // Toute reprise de profil — bascule, suppression, import — repasse par la
  // migration : c'est elle qui assainit les valeurs et garantit des objets
  // neufs, donc un recalcul effectif de tous les usages.
  function loadProfileIntoState(state: SimulatorStateInput, stateVersion = CURRENT_STATE_VERSION) {
    const migrated = migrateSimulationState({ ...state, version: stateVersion }, DEFAULT_SIMULATOR_STATE, APPLIANCE_PRESETS);
    applyStateToInterface(migrated);
  }

  function applyStateToInterface(state: SimulatorStateInput) {
    setTariffs(state.tariffs);
    setPower(state.power);
    setAnnualKwh(state.annualKwh);
    setKnownHeatingKwh(state.knownHeatingKwh);
    setResidents(state.residents);
    residentsRef.current = state.residents;
    setBackgroundHcShare(state.backgroundHcShare);
    setAppliances(state.appliances);
    setHeating(state.heating);
    nextApplianceIdRef.current = Math.max(1000, ...state.appliances.map((appliance) => appliance.id + 1));
    setOffPeakWindows(state.offPeakWindows);
    setActiveOffPeakWindowId(state.activeOffPeakWindowId);
  }

  function handleCreateProfile() {
    const name = prompt("Nom de la nouvelle simulation :");
    if (!name?.trim()) return;
    const stateInput: SimulatorStateInput = toStateInput({ version: CURRENT_STATE_VERSION, tariffs, power, annualKwh, knownHeatingKwh, residents, backgroundHcShare, appliances, heating, offPeakWindows, activeOffPeakWindowId });
    const { store: updated } = addProfile(profilesStore, name.trim(), stateInput);
    setProfilesStore(updated);
    saveProfilesStore(localStorage, updated);
  }

  function handleSwitchProfile(profileId: string) {
    const updated = setActiveProfile(profilesStore, profileId);
    const profile = getActiveProfile(updated);
    if (profile) {
      setProfilesStore(updated);
      saveProfilesStore(localStorage, updated);
      loadProfileIntoState(profile.state);
    }
  }

  function handleExportProfile() {
    const profile = getActiveProfile(profilesStore);
    if (!profile) return;
    const currentState: SimulatorStateInput = toStateInput({ version: CURRENT_STATE_VERSION, tariffs, power, annualKwh, knownHeatingKwh, residents, backgroundHcShare, appliances, heating, offPeakWindows, activeOffPeakWindowId });
    const withLatest: typeof profile = { ...profile, state: currentState, updatedAt: new Date().toISOString() };
    downloadProfileJson(withLatest, APP_VERSION);
  }

  function handleImportProfileClick() {
    importProfileInputRef.current?.click();
  }

  function handleImportProfile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    readProfileFile(file).then((profile) => {
      const importedAppVersion = "importedAppVersion" in profile ? String(profile.importedAppVersion) : "";
      const importedStateVersion = IMPORT_STATE_VERSIONS.find(([pattern]) => pattern.test(importedAppVersion))?.[1] ?? CURRENT_STATE_VERSION;
      const migratedState = migrateSimulationState({ ...profile.state, version: importedStateVersion }, DEFAULT_SIMULATOR_STATE, APPLIANCE_PRESETS);
      const migratedProfile = {
        id: profile.id,
        name: profile.name,
        state: toStateInput(migratedState),
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      };
      const updated: ProfilesStore = {
        ...profilesStore,
        profiles: [...profilesStore.profiles, migratedProfile],
        activeProfileId: migratedProfile.id,
      };
      setProfilesStore(updated);
      saveProfilesStore(localStorage, updated);
      loadProfileIntoState(migratedProfile.state);
      setNotice(`Profil « ${migratedProfile.name} » importé.`);
    }).catch(() => {
      setNotice("Ce fichier ne correspond pas au format attendu.");
    });
    event.target.value = "";
  }

  function handleRenameProfile() {
    const profile = getActiveProfile(profilesStore);
    if (!profile) return;
    const name = prompt("Nouveau nom :", profile.name);
    if (!name?.trim() || name.trim() === profile.name) return;
    const updated = renameProfile(profilesStore, profile.id, name.trim());
    setProfilesStore(updated);
    saveProfilesStore(localStorage, updated);
  }

  function handleDeleteProfile() {
    const profile = getActiveProfile(profilesStore);
    if (!profile || profilesStore.profiles.length <= 1) return;
    if (!confirm(`Supprimer le profil « ${profile.name} » ?`)) return;
    const updated = removeProfile(profilesStore, profile.id);
    setProfilesStore(updated);
    saveProfilesStore(localStorage, updated);
    const next = getActiveProfile(updated);
    if (next) loadProfileIntoState(next.state);
  }

  const baseNotice = baseOptionNotice(power);
  const gridNotice = tariffGridNotice(new Date());
  const isExample = storageReady && isDefaultSimulation(
    { tariffs, power, annualKwh, knownHeatingKwh, residents, backgroundHcShare, appliances, heating, offPeakWindows, activeOffPeakWindowId },
    DEFAULT_SIMULATOR_STATE,
  );
  const summary = summarizeDelta(results);
  const verdictPositive = summary.status === "positive";
  const verdictUncertain = summary.status === "uncertain";
  const hasRange = summary.spread >= 1;
  const rangeText = !hasRange
    ? null
    : verdictUncertain
      ? <>Selon les hypothèses basse et haute : de {euros.format(Math.abs(summary.low))} de surcoût à {euros.format(summary.high)} d’économie.</>
      : verdictPositive
        ? <>Économie comprise entre {euros.format(summary.low)} et {euros.format(summary.high)} selon les hypothèses basse et haute.</>
        : <>Surcoût compris entre {euros.format(Math.abs(summary.high))} et {euros.format(Math.abs(summary.low))} selon les hypothèses basse et haute.</>;
  const annualSliderMax = Math.max(20000, Math.ceil(annualKwh / 5000) * 5000);
  const powerSliderIndex = Math.max(0, tariffs.findIndex((tariff) => tariff.power === power));
  const schedulesCustomized = offPeakWindows.length !== DEFAULT_HC_WINDOWS.length || offPeakWindows.some((window, index) => window.start !== DEFAULT_HC_WINDOWS[index]?.start || window.end !== DEFAULT_HC_WINDOWS[index]?.end);
  const breakEvenText = results.breakEven.status === "above"
    ? <>HP/HC devient intéressant à partir d’environ <b>{results.breakEven.share.toFixed(0)} %</b> de consommation en heures creuses.</>
    : results.breakEven.status === "below"
      ? <>Avec cette grille atypique, HP/HC n’est intéressant qu’en dessous d’environ <b>{results.breakEven.share.toFixed(0)} %</b> en heures creuses.</>
      : results.breakEven.status === "always"
        ? <>HP/HC est avantageux quelle que soit la répartition HP/HC.</>
        : results.breakEven.status === "never"
          ? <>HP/HC ne devient pas avantageux, même avec 100 % de consommation en heures creuses.</>
          : <>Les deux options ont le même coût quelle que soit la répartition HP/HC.</>;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Déclic HC, accueil"><span className="brand-mark">⌁</span><span>Déclic <strong>HC</strong><small className="version-badge">v{APP_VERSION}</small></span></a>
        <div className="top-actions"><span className="offline-badge"><i /> Fonctionne hors ligne</span><div className="profile-selector"><select className="profile-select" value={profilesStore.activeProfileId ?? ""} onChange={(event) => handleSwitchProfile(event.target.value)} aria-label="Profil de simulation">{profilesStore.profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}</select><button className="button subtle icon-sm" type="button" onClick={handleCreateProfile} aria-label="Nouvelle simulation" title="Nouvelle simulation">＋</button><button className="button subtle icon-sm" type="button" onClick={handleExportProfile} aria-label="Exporter la simulation" title="Exporter JSON" disabled={!profilesStore.activeProfileId}>↓</button><button className="button subtle icon-sm" type="button" onClick={handleImportProfileClick} aria-label="Importer une simulation" title="Importer JSON">↑</button><button className="button subtle icon-sm" type="button" onClick={handleRenameProfile} aria-label="Renommer le profil" title="Renommer" disabled={!profilesStore.activeProfileId}>✎</button><button className="button subtle icon-sm" type="button" onClick={handleDeleteProfile} aria-label="Supprimer le profil" title="Supprimer" disabled={profilesStore.profiles.length <= 1}>×</button><input ref={importProfileInputRef} type="file" accept="application/json,.json" onChange={handleImportProfile} style={{ display: "none" }} /></div><button className="button install-button" disabled={isInstalled} onClick={installApp}>{isInstalled ? "✓ Installée" : "⇩ Installer"}</button><button className="button subtle tariff-button" onClick={() => setTariffsOpen((open) => !open)}>⚙ Grille tarifaire</button></div>
      </header>
      {installHelp && <div className="install-help" role="status"><span><strong>Installer Déclic HC</strong>Sur iPhone : Partager → Sur l’écran d’accueil. Sur Android : menu ⋮ → Installer l’application.</span><button aria-label="Fermer les instructions" onClick={() => setInstallHelp(false)}>×</button></div>}

      <section className="hero" id="top">
        <div><p className="eyebrow">SIMULATEUR PÉDAGOGIQUE · CORSE</p><h1>Base ou HP/HC :<br /><em>le vrai calcul</em></h1><p className="intro">Déplacez vos usages flexibles en heures creuses et voyez immédiatement l’effet sur votre facture annuelle.</p></div>
        <div className="hero-orbit" aria-hidden="true"><span className="sun">☀</span><span className="moon">☾</span><div className="orbit-line" /></div>
      </section>

      {tariffsOpen && <section className="tariff-editor panel">
        <div className="section-heading"><div><p className="step">GRILLE TARIFAIRE</p><h2>Vos prix, votre puissance</h2></div><div className="file-actions"><label className="button subtle file-button">Importer JSON<input type="file" accept="application/json,.json" onChange={importGrid} /></label><button className="button subtle" onClick={exportGrid}>Exporter</button><button className="icon-button" aria-label="Fermer" onClick={() => setTariffsOpen(false)}>×</button></div></div>
        {notice && <p className="notice">{notice}</p>}
        <div className="power-tabs" role="list" aria-label="Puissance souscrite">{tariffs.map((tariff) => <button key={tariff.power} className={power === tariff.power ? "active" : ""} onClick={() => setPower(tariff.power)}>{tariff.power} kVA</button>)}</div>
        <div className="tariff-fields">
          <Field label="Abonnement Base" suffix="€/an" value={activeTariff.baseSubscription} onChange={(v) => updateTariff("baseSubscription", v)} />
          <Field label="Abonnement HP/HC" suffix="€/an" value={activeTariff.hphcSubscription} onChange={(v) => updateTariff("hphcSubscription", v)} />
          <Field label="Prix Base" suffix="€/kWh" value={activeTariff.basePrice} step={0.0001} onChange={(v) => updateTariff("basePrice", v)} />
          <Field label="Heures pleines" suffix="€/kWh" value={activeTariff.hpPrice} step={0.0001} onChange={(v) => updateTariff("hpPrice", v)} />
          <Field label="Heures creuses" suffix="€/kWh" value={activeTariff.hcPrice} step={0.0001} onChange={(v) => updateTariff("hcPrice", v)} />
        </div>
        <p className="source-note">Préremplie avec le Tarif Bleu résidentiel EDF Corse TTC au {TARIFF_GRID_LABEL} : l’abonnement y est identique en Base et en HP/HC. Au-delà de 6 kVA, l’option Base est en extinction. Toutes les valeurs restent modifiables.</p>
      </section>}

      <section className="simulator-grid">
        <div className="controls-column">
          <section className="panel setup-panel">
            <div className="step-heading"><span>01</span><div><p>VOTRE FOYER</p><h2>Posons le décor</h2></div></div>
            <div className="household-sliders">
              <label className="household-slider wide">
                <span>Consommation annuelle connue <strong>{number.format(annualKwh)} kWh/an</strong></span>
                <ThumbOnlyRange aria-label="Consommation annuelle connue en kilowattheures" min={0} max={annualSliderMax} step={100} value={annualKwh} onValueChange={updateAnnualKwh} />
                <small><span>0 kWh</span><span>{number.format(annualSliderMax)} kWh</span></small>
              </label>
              <label className="household-slider">
                <span>Habitants <strong>{residents} personne{residents > 1 ? "s" : ""}</strong></span>
                <ThumbOnlyRange aria-label="Nombre d’habitants" min={1} max={12} step={1} value={residents} onValueChange={updateResidents} />
                <small><span>1 personne</span><span>12 personnes</span></small>
              </label>
              <label className="household-slider">
                <span>Puissance du compteur <strong>{power} kVA</strong></span>
                <ThumbOnlyRange aria-label="Puissance du compteur" min={0} max={Math.max(0, tariffs.length - 1)} step={1} value={powerSliderIndex} onValueChange={(index) => setPower(tariffs[Math.round(index)]?.power ?? power)} />
                <small><span>{tariffs[0]?.power ?? power} kVA</span><span>{tariffs.at(-1)?.power ?? power} kVA</span></small>
              </label>
              <label className="household-slider">
                <span>Surface du logement <strong>{number.format(heating.surfaceM2)} m²</strong></span>
                <ThumbOnlyRange aria-label="Surface du logement" min={10} max={250} step={5} value={heating.surfaceM2} onValueChange={(surfaceM2) => updateHeating({ surfaceM2 })} />
                <small><span>10 m²</span><span>250 m²</span></small>
              </label>
              <label className="household-occupancy"><span>Présence dans le logement</span><select value={heating.occupancy} onChange={(event) => updateHeating({ occupancy: event.target.value as HeatingSettings["occupancy"] })}><option value="away">Absent en journée</option><option value="mixed">Mixte · 2 jours de télétravail</option><option value="home">Télétravail / présent</option></select><small>Utilisée pour les profils de chauffage et de climatisation estivale. La surface et l’isolation les dimensionnent tous les deux.</small></label>
            </div>
            <section className={`heating-card ${heating.enabled ? "enabled" : ""}`}>
              <div className="heating-heading">
                <span><b>♨ Chauffage électrique</b><small>Estimation séparée du reste du foyer</small></span>
                <button type="button" aria-pressed={heating.enabled} onClick={() => updateHeating({ enabled: !heating.enabled })}>{heating.enabled ? "✓ Pris en compte" : "＋ Ajouter"}</button>
              </div>
              {heating.enabled && <>
                <div className="heating-fields">
                  <label>Système<select value={heating.system} onChange={(event) => updateHeating({ system: event.target.value as HeatingSettings["system"] })}><option value="radiators">Radiateurs électriques</option><option value="heat-pump">Pompe à chaleur / clim réversible</option></select></label>
                  <label>Logement<select value={heating.dwellingType} onChange={(event) => updateHeating({ dwellingType: event.target.value as HeatingSettings["dwellingType"] })}><option value="apartment">Appartement</option><option value="house">Maison</option></select></label>
                  <label>Isolation<select value={heating.insulation} onChange={(event) => updateHeating({ insulation: event.target.value as HeatingSettings["insulation"] })}><option value="good">Bonne</option><option value="standard">Standard</option><option value="poor">Faible</option></select></label>
                  <label>Altitude<select value={heating.altitude} onChange={(event) => updateHeating({ altitude: event.target.value as HeatingSettings["altitude"] })}><option value="low">Moins de 400 m</option><option value="medium">400 à 800 m</option><option value="high">Plus de 800 m</option></select></label>
                </div>
                <div className="heating-result">
                  <span><small>CHAUFFAGE ESTIMÉ</small><strong>{number.format(heatingEstimate.annualKwh)} kWh/an</strong><em>fourchette {number.format(heatingEstimate.lowKwh)}–{number.format(heatingEstimate.highKwh)} kWh</em></span>
                  <span><small>CHAUFFAGE RETENU DANS LA FACTURE</small><strong>{number.format(results.heatingKwh)} kWh/an</strong><em>{number.format(results.heatingHcKwh)} kWh/an en HC · {heatingEstimate.hcShare.toFixed(0)} %</em></span>
                </div>
                <label className="heating-surface">
                  <span>Consommation de chauffage dans la facture <strong>{number.format(knownHeatingKwh)} kWh/an</strong></span>
                  <ThumbOnlyRange aria-label="Consommation annuelle de chauffage dans la facture" min={0} max={Math.max(annualKwh, 1000)} step={100} value={Math.min(knownHeatingKwh, Math.max(annualKwh, 1000))} onValueChange={setKnownHeatingKwh} />
                  <small><span>0 kWh</span><button type="button" className="button subtle" onClick={() => setKnownHeatingKwh(Math.min(heatingEstimate.annualKwh, Math.max(0, annualKwh - results.applianceKwh)))}>Utiliser l’estimation</button><span>{number.format(Math.max(annualKwh, 1000))} kWh</span></small>
                </label>
                <p className="heating-note">La quantité retenue est incluse dans le total annuel connu et remplace une partie du « reste du foyer ». Elle garde la marge d’incertitude du poste, qui alimente la fourchette de facture. Elle est répartie entre HP et HC selon le profil standardisé : 19 °C en confort, 17 °C la nuit et 16 °C pendant les absences de journée, le besoin de chaque heure étant pondéré par la température extérieure. Sans stockage thermique, seuls les besoins ayant naturellement lieu pendant la plage HC sont comptés en heures creuses. Estimation pédagogique H3 à affiner avec les <a href="https://www.data.corsica/explore/dataset/dpe-logements-existants-en-corse-depuis-juillet-2021/" target="_blank" rel="noreferrer">DPE corses</a>.</p>
              </>}
            </section>
            <label className="range-label"><span>Répartition totale en heures creuses <strong>{results.share.toFixed(0)} % · {number.format(results.hcKwh)} kWh/an</strong></span><ThumbOnlyRange aria-label="Répartition totale en heures creuses" min={results.minShare} max={results.maxShare} step={1} value={results.share} disabled={results.backgroundKwh <= 0} onValueChange={setTotalHcShare} /></label>
            <div className="range-scale"><span>Minimum {results.minShare.toFixed(0)} %</span><span>Maximum {results.maxShare.toFixed(0)} %</span></div>
            <p className="hint">Commencez le glissement sur la poignée. Le curseur agit sur les usages non listés ; les appareils programmés et les usages profilés fixent les limites atteignables.</p>
          </section>

          <section className="panel appliance-panel">
            <div className="step-heading"><span>02</span><div><p>USAGES PILOTÉS</p><h2>Programmez les bons usages</h2></div></div>
            <div className="behavior-guide"><span><strong>Dépendances ciblées</strong>La surface conditionne uniquement le chauffage. Les habitants conditionnent uniquement l’ECS, le lave-linge, le sèche-linge et le lave-vaisselle. Une valeur mesurée reste inchangée.</span><div className="usage-balance"><b>{number.format(results.applianceKwh)} kWh</b><small>usages listés</small><b>{number.format(results.backgroundKwh)} kWh</b><small>reste du foyer</small></div></div>
            <div className="appliance-list">{appliances.map((appliance) => {
              const calibration = getApplianceCalibration(appliance.type);
              const isSummerCooling = appliance.type === "air-conditioning";
              return <article className="appliance" key={appliance.id}>
              <button className="remove" aria-label={`Retirer ${appliance.name}`} onClick={() => setAppliances((current) => current.filter((item) => item.id !== appliance.id))}>×</button>
              <div className="appliance-identity"><input className="appliance-name" aria-label="Nom de l’usage" value={appliance.name} onChange={(e) => updateAppliance(appliance.id, { name: e.target.value })} /><span className={`behavior-toggle ${appliance.calculationMode}`}><i />{appliance.calculationMode === "measured" ? "Valeur mesurée" : appliance.calculationMode === "detailed" ? "Calcul détaillé" : "Valeur de référence"}</span></div>
              <div className="appliance-energy"><NumericInput aria-label={`Consommation annuelle de ${appliance.name}`} min={0} step={10} value={Math.round(appliance.annualKwh)} onValueChange={(value) => updateApplianceKwh(appliance.id, value)} /><span>kWh/an</span></div>
              <div className="schedule scheduled"><span className="schedule-icon">{isSummerCooling ? "☀" : "☾"}</span><span><small>{isSummerCooling ? "USAGE ESTIVAL SELON PRÉSENCE" : "TOUJOURS PROGRAMMÉ EN HC"}</small>{isSummerCooling ? `${coolingProfile.hcShare.toFixed(0)} % en HC · ${number.format(modeledAppliances.find((item) => item.id === appliance.id)?.annualKwh ?? appliance.annualKwh)} kWh profilés · profil ${heating.occupancy === "away" ? "absent" : heating.occupancy === "mixed" ? "mixte" : "présent"}` : `${formatTime(activeOffPeakWindow.start)}–${formatTime(activeOffPeakWindow.end)}`}</span></div>
              <details className="appliance-assumptions">
                <summary><span><strong>Ajuster le modèle</strong><small>Fourchette {number.format(appliance.lowKwh)}–{number.format(appliance.highKwh)} kWh/an · méthode et sources</small></span><span className="assumption-summary-action" aria-hidden="true">Réglages <b>⌄</b></span></summary>
                <div className="assumption-grid">
                  <label>Méthode<select value={appliance.calculationMode} onChange={(event) => updateCalculationMode(appliance.id, event.target.value as CalculationMode)}><option value="reference">Valeur de référence</option><option value="measured">Valeur mesurée</option><option value="detailed" disabled>Calcul détaillé — lot 4</option></select></label>
                  <label>Estimation basse<div className="compact-input"><NumericInput min={0} step={10} disabled={appliance.calculationMode === "measured"} value={Math.round(appliance.lowKwh)} onValueChange={(value) => updateAppliance(appliance.id, { lowKwh: clamp(value, 0, appliance.annualKwh) })} /><span>kWh</span></div></label>
                  <label>Estimation haute<div className="compact-input"><NumericInput min={appliance.annualKwh} step={10} disabled={appliance.calculationMode === "measured"} value={Math.round(appliance.highKwh)} onValueChange={(value) => updateAppliance(appliance.id, { highKwh: Math.max(appliance.annualKwh, value) })} /><span>kWh</span></div></label>
                </div>
                <p className="offpeak-assumption"><strong>Placement retenu :</strong> {isSummerCooling ? <>usage diurne de 12 h à 22 h, limité aux périodes de présence : soirée en semaine pour le profil absent, deux journées de télétravail pour le profil mixte et journée complète pour le profil présent.</> : <>100 % de cet usage opportuniste pendant les heures creuses.</>}</p>
                {calibration && <p className={`calibration-status ${calibration.confidence}`}><strong>Données {confidenceLabel(calibration.confidence)}</strong>{calibration.sampleSize > 0 ? <>Échantillon : {calibration.sampleSize} logements. La valeur de référence et sa fourchette ne sont pas redimensionnées automatiquement.</> : <>Aucune observation exploitable dans le fichier ouvert : cette valeur est indicative.</>}</p>}
                <p className={`appliance-source ${appliance.source.kind}`}>Source : <strong>{appliance.source.organization}</strong> — {appliance.source.label}{appliance.source.year ? ` (${appliance.source.year})` : ""}{appliance.source.url && <> · <a href={appliance.source.url} target="_blank" rel="noreferrer">consulter</a></>}</p>
              </details>
            </article>})}</div>
            <details className="preset-library">
              <summary>＋ Ajouter un consommateur préenregistré</summary>
              <div className="preset-heading"><strong>Modèles opportunistes</strong><span>Calibrés sur ElecDom lorsque l’échantillon est suffisant</span></div>
              <div className="preset-grid">
                {APPLIANCE_PRESETS.map((preset) => <button type="button" key={preset.name} onClick={() => addAppliance(preset)}>
                  <span className="preset-icon">{preset.icon}</span>
                  <span><strong>{preset.name}</strong><small>{preset.detail} · {getApplianceCalibration(preset.type)?.confidence === "insufficient" ? "indicatif" : "calibré"} · {number.format(preset.annualKwh)} kWh/an</small></span>
                  <b>＋</b>
                </button>)}
              </div>
              <button type="button" className="custom-preset" onClick={() => addAppliance()}>＋ Créer un usage personnalisé</button>
            </details>
            {results.warnings.map((warning) => <p className="warning" key={warning.code}>{warning.message}</p>)}
          </section>
        </div>

        <aside className="result-card" id="result">
          <p className="step light">VOTRE SIMULATION · {power} KVA</p>
          {isExample && <p className="example-notice">Résultat d’exemple : ajustez votre consommation, vos habitants et vos usages pour obtenir le vôtre.</p>}
          <h2>{verdictPositive ? "Les heures creuses prennent l’avantage" : verdictUncertain ? "Trop serré pour trancher" : "Le tarif Base reste devant"}</h2>
          <div className={`saving ${verdictPositive ? "positive" : verdictUncertain ? "uncertain" : "negative"}`}><span>{verdictPositive ? "ÉCONOMIE ESTIMÉE" : verdictUncertain ? "ÉCART ESTIMÉ" : "SURCOÛT HP/HC ESTIMÉ"}<em>HP/HC − BASE</em></span><div className="lcd-readout"><strong>{results.delta > 0 ? "−" : "+"}{number.format(Math.abs(results.delta))}</strong><em>EUR / an</em></div><p><span>soit {euros.format(Math.abs(results.delta) / 12)} par mois</span><span>{number.format(results.totalKwh)} kWh/an</span></p>{rangeText && <p className="saving-range">{rangeText}</p>}</div>
          <div className="cost-lines">
            <p>FACTURE EDF ANNUELLE ESTIMÉE · TTC</p>
            <article><span><strong>Option Base</strong><small>Abonnement {preciseEuros.format(results.baseSubscriptionCost)} + énergie {preciseEuros.format(results.baseEnergyCost)}</small></span><span className="cost-total"><strong>{preciseEuros.format(results.baseCost)}</strong><small>{preciseEuros.format(results.baseCost / 12)} / mois</small></span></article>
            <article className="highlight"><span><strong>Option HP / HC</strong><small>Abonnement {preciseEuros.format(results.hphcSubscriptionCost)} + HP {preciseEuros.format(results.hpEnergyCost)} + HC {preciseEuros.format(results.hcEnergyCost)}</small></span><span className="cost-total"><strong>{preciseEuros.format(results.hphcCost)}</strong><small>{preciseEuros.format(results.hphcCost / 12)} / mois</small></span></article>
          </div>
          <div className="distribution"><div className="distribution-title"><span>Répartition HP / HC<small>Total connu : {number.format(results.totalKwh)} kWh · plage {formatTime(activeOffPeakWindow.start)}–{formatTime(activeOffPeakWindow.end)}</small></span><strong>{results.share.toFixed(0)} % en HC</strong></div><div className="bar"><span style={{ width: `${results.share}%` }} /></div><div className="bar-legend"><span>Heures creuses · {number.format(results.hcKwh)} kWh</span><span>Heures pleines · {number.format(results.hpKwh)} kWh</span></div><div className="energy-breakdown"><span>Total en heures creuses<strong>{number.format(results.hcKwh)} kWh</strong></span><span>Usages listés<strong>{number.format(results.applianceKwh)} kWh</strong></span><span>Reste du foyer<strong>{number.format(results.backgroundKwh)} kWh</strong></span><span>Chauffage<strong>{number.format(results.heatingKwh)} kWh</strong></span><span>Chauffage en HC<strong>{number.format(results.heatingHcKwh)} kWh</strong></span><span>Appareils en HC<strong>{number.format(results.scheduledHc)} kWh</strong></span></div></div>
          <div className="threshold"><span className="threshold-icon">◎</span><p><strong>Votre point d’équilibre</strong><br />{breakEvenText}</p></div>
          {gridNotice && <p className="base-extinction"><span aria-hidden="true">⚠</span> {gridNotice}</p>}
          {baseNotice && <p className="base-extinction"><span aria-hidden="true">⚠</span> {baseNotice}</p>}
          <p className="disclaimer"><strong>Total inclus :</strong> abonnement, énergie et taxes déjà intégrées aux tarifs TTC EDF Corse. Non inclus : services ou remises propres au contrat, régularisations et changements de tarif au cours des 12 mois. Comparez l’estimation à une facture réelle avant toute décision contractuelle.</p>
        </aside>
      </section>

      <a className={`mobile-summary ${verdictPositive ? "gain" : "loss"}`} href="#result"><span>{verdictPositive ? "Économie HP/HC" : "Écart HP/HC"}<small>{results.share.toFixed(0)} % en HC</small></span><strong>{euros.format(Math.abs(results.delta))}<small>/an</small></strong><b>↑</b></a>

      <section className="timeline-section">
        <div className="timeline-copy"><p className="eyebrow">COMPRENDRE EN UN COUP D’ŒIL</p><h2>Les heures creuses en Corse</h2><p>Choisissez la plage indiquée sur votre facture. Elle sera appliquée à tous les appareils que vous programmez en heures creuses.</p></div>
        <div className="timeline-card">
          <div className="timeline-card-heading"><span>PLAGES HORAIRES {schedulesCustomized && <b>PERSONNALISÉES</b>}</span><button type="button" onClick={() => setScheduleEditorOpen((open) => !open)}>{scheduleEditorOpen ? "✓ Terminer" : "✎ Modifier"}</button></div>
          {scheduleEditorOpen && <div className="hc-editor">
            {offPeakWindows.map((window, index) => <div className="hc-editor-row" key={window.id}>
              <span>Plage {index + 1}</span>
              <label>Début<input aria-label={`Début de la plage ${index + 1}`} type="time" value={window.start} onChange={(event) => { if (validTime(event.target.value)) updateOffPeakWindow(window.id, "start", event.target.value); }} /></label>
              <b>→</b>
              <label>Fin<input aria-label={`Fin de la plage ${index + 1}`} type="time" value={window.end} onChange={(event) => { if (validTime(event.target.value)) updateOffPeakWindow(window.id, "end", event.target.value); }} /></label>
              <small className={offPeakDurationMinutes(window) === 480 ? "valid" : ""}>{formatDuration(offPeakDurationMinutes(window))}</small>
              <button className="remove-window" type="button" aria-label={`Supprimer la plage ${index + 1}`} disabled={offPeakWindows.length === 1} onClick={() => setOffPeakWindows((current) => current.filter((item) => item.id !== window.id))}>×</button>
            </div>)}
            <div className="hc-editor-actions"><button type="button" disabled={offPeakWindows.length >= 8} onClick={addOffPeakWindow}>＋ Ajouter une plage</button><button type="button" onClick={() => { setOffPeakWindows(DEFAULT_HC_WINDOWS); setActiveOffPeakWindowId(DEFAULT_HC_WINDOWS[0].id); }}>↺ Horaires EDF</button></div>
            <p>Une plage officielle dure 8 h : modifier une borne décale automatiquement l’autre. Les changements mettent immédiatement à jour le graphique et restent enregistrés sur cet appareil.</p>
          </div>}
          <div className="timeline-hours"><span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>24h</span></div>
          <div className="hc-windows" aria-label="Plages d’heures creuses affichées">
            {offPeakWindows.map((window) => <div className={`hc-window ${window.id === activeOffPeakWindow.id ? "active" : ""}`} key={window.id}><button className="window-choice" type="button" aria-pressed={window.id === activeOffPeakWindow.id} onClick={() => setActiveOffPeakWindowId(window.id)}><span aria-hidden="true" /><strong>{formatTime(window.start)}–{formatTime(window.end)}</strong><small>{window.id === activeOffPeakWindow.id ? "Utilisée" : "Choisir"}</small></button><div className="hc-bar">{offPeakSegments(window).map((segment, index) => <i key={index} style={{ left: `${segment.left}%`, width: `${segment.width}%` }} />)}</div></div>)}
          </div>
          <div className="hc-legend"><span><i /> Heures creuses</span><span><i /> Heures pleines</span></div>
          <p className="timeline-note"><strong>Plage utilisée dans la simulation : {formatTime(activeOffPeakWindow.start)}–{formatTime(activeOffPeakWindow.end)}.</strong> Son horaire ne change pas le prix du kWh HC ; il indique quand les appareils marqués « programmés en HC » sont supposés fonctionner. Horaires proposés par défaut : <a href="https://corse.edf.fr/sites/sei_corse/files/2026-08/bleu_residentiel_corse.pdf" target="_blank" rel="noreferrer">grille EDF Corse au 1er août 2026</a>.</p>
        </div>
      </section>
      <footer><span>Déclic HC · v{APP_VERSION} · outil indépendant de sensibilisation</span><span>Données enregistrées uniquement sur cet appareil</span></footer>
    </main>
  );
}

type NumericInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: number;
  onValueChange: (value: number) => void;
};

function NumericInput({ value, onValueChange, onFocus, onBlur, ...props }: NumericInputProps) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  // Dernière valeur que ce champ a lui-même envoyée : tout ce qui en diffère
  // vient d'un recalcul extérieur et doit s'imposer, focus ou non.
  const emitted = useRef(value);

  const commit = (next: number) => {
    emitted.current = next;
    onValueChange(next);
  };

  useEffect(() => {
    if (!shouldAdoptExternalValue(focused.current, value, emitted.current)) return;
    emitted.current = value;
    setDraft(String(value));
  }, [value]);

  return <input
    {...props}
    type="number"
    value={draft}
    onFocus={(event) => { focused.current = true; onFocus?.(event); }}
    onChange={(event) => {
      const nextDraft = event.target.value;
      setDraft(nextDraft);
      if (nextDraft.trim() === "") return;
      const parsed = Number(nextDraft);
      if (Number.isFinite(parsed)) commit(parsed);
    }}
    onBlur={(event) => {
      focused.current = false;
      const parsed = Number(draft);
      if (draft.trim() !== "" && Number.isFinite(parsed)) {
        // Le champ se referme sur ce que le foyer a réellement saisi, jamais
        // sur une valeur d'un rendu précédent.
        commit(parsed);
        setDraft(String(parsed));
      } else {
        setDraft(String(value));
      }
      onBlur?.(event);
    }}
  />;
}

type ThumbOnlyRangeProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "min" | "max" | "step" | "onChange" | "onInput" | "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel"> & {
  value: number;
  min: number;
  max: number;
  step?: number;
  onValueChange: (value: number) => void;
};

function ThumbOnlyRange({ value, min, max, step = 1, onValueChange, ...props }: ThumbOnlyRangeProps) {
  const interactionPointer = useRef<number | null>(null);
  const draggingPointer = useRef<number | null>(null);
  const grabOffset = useRef(0);
  const suppressNativeInput = useRef(false);
  const thumbDiameter = 20;

  const thumbCenter = (range: HTMLInputElement) => {
    const bounds = range.getBoundingClientRect();
    const ratio = max > min ? clamp((value - min) / (max - min), 0, 1) : 0;
    return bounds.left + thumbDiameter / 2 + ratio * Math.max(0, bounds.width - thumbDiameter);
  };

  const updateFromPointer = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (draggingPointer.current !== event.pointerId) return;
    event.preventDefault();
    const range = event.currentTarget;
    const bounds = range.getBoundingClientRect();
    const usableWidth = Math.max(1, bounds.width - thumbDiameter);
    const x = event.clientX - grabOffset.current - bounds.left - thumbDiameter / 2;
    const rawValue = min + clamp(x / usableWidth, 0, 1) * (max - min);
    const snappedValue = clamp(min + Math.round((rawValue - min) / step) * step, min, max);
    const decimals = String(step).split(".")[1]?.length ?? 0;
    onValueChange(Number(snappedValue.toFixed(decimals)));
  };

  const finishDrag = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (interactionPointer.current !== event.pointerId) return;
    interactionPointer.current = null;
    draggingPointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    window.setTimeout(() => { suppressNativeInput.current = false; }, 0);
  };

  return <input
    {...props}
    type="range"
    min={min}
    max={max}
    step={step}
    value={value}
    onInput={(event) => {
      if (suppressNativeInput.current) event.currentTarget.value = String(value);
    }}
    onChange={(event) => {
      if (suppressNativeInput.current) {
        event.currentTarget.value = String(value);
        return;
      }
      onValueChange(Number(event.currentTarget.value));
    }}
    onPointerDown={(event) => {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLInputElement && activeElement.type === "number") activeElement.blur();

      event.preventDefault();
      const range = event.currentTarget;
      range.focus({ preventScroll: true });
      suppressNativeInput.current = true;
      interactionPointer.current = event.pointerId;
      range.setPointerCapture(event.pointerId);
      const center = thumbCenter(range);
      const hitRadius = event.pointerType === "touch" ? 18 : 12;
      if (Math.abs(event.clientX - center) > hitRadius) return;

      draggingPointer.current = event.pointerId;
      grabOffset.current = event.clientX - center;
    }}
    onPointerMove={updateFromPointer}
    onPointerUp={finishDrag}
    onPointerCancel={finishDrag}
  />;
}

function Field({ label, suffix, value, step = 0.01, onChange }: { label: string; suffix: string; value: number; step?: number; onChange: (value: number) => void }) {
  return <label>{label}<div className="input-wrap"><NumericInput min={0} step={step} value={value} onValueChange={onChange} /><span>{suffix}</span></div></label>;
}
