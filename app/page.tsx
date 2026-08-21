"use client";

import { ChangeEvent, InputHTMLAttributes, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  calculateSimulation,
  clamp,
  HOUSEHOLD_REFERENCE_KWH,
} from "./simulation/calculate";
import { confidenceLabel, getApplianceCalibration } from "./simulation/calibration";
import {
  APPLIANCE_PRESETS,
  DEFAULT_APPLIANCES,
  INTERNAL_ESTIMATE_SOURCE,
} from "./simulation/presets";
import {
  CURRENT_STATE_VERSION,
  loadSimulationState,
  saveSimulationState,
} from "./simulation/storage";
import {
  householdScaleFactor,
  REFERENCE_RESIDENTS,
  scaleApplianceForHousehold,
  scaleAppliancesForHousehold,
} from "./simulation/scaling";
import type {
  Appliance,
  AppliancePreset,
  CalculationMode,
  OffPeakWindow,
  SimulatorState,
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
const offPeakDuration = ({ start, end }: OffPeakWindow) => (timeToMinutes(end) - timeToMinutes(start) + 1440) % 1440;
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
  residents: REFERENCE_RESIDENTS,
  backgroundHcShare: 25,
  appliances: DEFAULT_APPLIANCES,
  offPeakWindows: DEFAULT_HC_WINDOWS,
  activeOffPeakWindowId: DEFAULT_HC_WINDOWS[0].id,
};

export default function Home() {
  const [tariffs, setTariffs] = useState<Tariff[]>(DEFAULT_TARIFFS);
  const [power, setPower] = useState(6);
  const [annualKwh, setAnnualKwh] = useState(4500);
  const [residents, setResidents] = useState(REFERENCE_RESIDENTS);
  const annualKwhRef = useRef(4500);
  const residentsRef = useRef(REFERENCE_RESIDENTS);
  const nextApplianceIdRef = useRef(1000);
  const [backgroundHcShare, setBackgroundHcShare] = useState(25);
  const [appliances, setAppliances] = useState<Appliance[]>(DEFAULT_APPLIANCES);
  const [tariffsOpen, setTariffsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installHelp, setInstallHelp] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [offPeakWindows, setOffPeakWindows] = useState<OffPeakWindow[]>(DEFAULT_HC_WINDOWS);
  const [activeOffPeakWindowId, setActiveOffPeakWindowId] = useState(DEFAULT_HC_WINDOWS[0].id);
  const [scheduleEditorOpen, setScheduleEditorOpen] = useState(false);
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    const state = loadSimulationState(localStorage, DEFAULT_SIMULATOR_STATE, APPLIANCE_PRESETS);
    // Hydratation unique de la sauvegarde locale, disponible seulement après le montage côté client.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTariffs(state.tariffs);
    setPower(state.power);
    setAnnualKwh(state.annualKwh);
    annualKwhRef.current = state.annualKwh;
    setResidents(state.residents);
    residentsRef.current = state.residents;
    setBackgroundHcShare(state.backgroundHcShare);
    setAppliances(state.appliances);
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
    if (!storageReady) return;
    saveSimulationState(localStorage, { tariffs, power, annualKwh, residents, backgroundHcShare, appliances, offPeakWindows, activeOffPeakWindowId });
  }, [storageReady, tariffs, power, annualKwh, residents, backgroundHcShare, appliances, offPeakWindows, activeOffPeakWindowId]);

  useEffect(() => {
    // Une plage active supprimée doit immédiatement basculer vers la première plage restante.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!offPeakWindows.some((window) => window.id === activeOffPeakWindowId)) setActiveOffPeakWindowId(offPeakWindows[0].id);
  }, [activeOffPeakWindowId, offPeakWindows]);

  const activeTariff = tariffs.find((tariff) => tariff.power === power) ?? tariffs[0];
  const activeOffPeakWindow = offPeakWindows.find((window) => window.id === activeOffPeakWindowId) ?? offPeakWindows[0];
  const results = useMemo(
    () => calculateSimulation({ annualKwh, backgroundHcShare, tariff: activeTariff, appliances }),
    [activeTariff, annualKwh, appliances, backgroundHcShare],
  );

  function updateTariff(field: keyof Omit<Tariff, "power">, value: number) {
    setTariffs((current) => current.map((tariff) => tariff.power === power ? { ...tariff, [field]: Math.max(0, value) } : tariff));
  }

  function updateAppliance(id: number, patch: Partial<Appliance>) {
    setAppliances((current) => current.map((appliance) => appliance.id === id ? { ...appliance, ...patch } : appliance));
  }

  function updateAnnualKwh(value: number) {
    const nextAnnualKwh = Math.max(0, value);
    const from = { annualKwh: annualKwhRef.current, residents: residentsRef.current };
    const to = { annualKwh: nextAnnualKwh, residents: residentsRef.current };
    annualKwhRef.current = nextAnnualKwh;
    setAnnualKwh(nextAnnualKwh);
    setAppliances((current) => scaleAppliancesForHousehold(current, from, to));
  }

  function updateResidents(value: number) {
    const nextResidents = Math.min(12, Math.max(1, Math.round(value || 1)));
    const from = { annualKwh: annualKwhRef.current, residents: residentsRef.current };
    const to = { annualKwh: annualKwhRef.current, residents: nextResidents };
    residentsRef.current = nextResidents;
    setResidents(nextResidents);
    setAppliances((current) => scaleAppliancesForHousehold(current, from, to));
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
      shiftableShare: 100,
      defaultOffPeakShare: 100,
      source: { ...INTERNAL_ESTIMATE_SOURCE },
    };
    const appliance = scaleApplianceForHousehold({
      id: nextApplianceIdRef.current++,
      type: model.type,
      name: model.name,
      annualKwh: model.annualKwh,
      lowKwh: model.lowKwh,
      highKwh: model.highKwh,
      calculationMode: model.calculationMode,
      shiftableShare: model.shiftableShare,
      offPeakShare: 100,
      source: { ...model.source },
    }, {
      annualKwh: HOUSEHOLD_REFERENCE_KWH,
      residents: REFERENCE_RESIDENTS,
    }, {
      annualKwh,
      residents,
    });
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
    const contextFactor = preset ? householdScaleFactor(preset.type, {
      annualKwh: HOUSEHOLD_REFERENCE_KWH,
      residents: REFERENCE_RESIDENTS,
    }, { annualKwh, residents }) : 1;
    const contextAnnualKwh = preset ? preset.annualKwh * contextFactor : appliance.annualKwh;
    const scale = contextAnnualKwh > 0 ? appliance.annualKwh / contextAnnualKwh : 1;
    updateAppliance(id, {
      calculationMode: mode,
      lowKwh: preset ? preset.lowKwh * contextFactor * scale : appliance.annualKwh * 0.7,
      highKwh: preset ? preset.highKwh * contextFactor * scale : appliance.annualKwh * 1.3,
      shiftableShare: 100,
      offPeakShare: 100,
      source: { ...(preset?.source ?? INTERNAL_ESTIMATE_SOURCE) },
    });
  }

  function updateOffPeakWindow(id: number, patch: Partial<OffPeakWindow>) {
    setOffPeakWindows((current) => current.map((window) => window.id === id ? { ...window, ...patch } : window));
  }

  function addOffPeakWindow() {
    setOffPeakWindows((current) => current.length >= 8 ? current : [...current, { id: Date.now(), start: "22:00", end: "06:00" }]);
  }

  function setTotalHcShare(totalShare: number) {
    if (annualKwh <= 0 || results.backgroundKwh <= 0) return;
    const desiredHcKwh = annualKwh * totalShare / 100;
    const backgroundShare = (desiredHcKwh - results.scheduledHc) / results.backgroundKwh * 100;
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

  const verdictPositive = results.delta > 1;
  const verdictNeutral = Math.abs(results.delta) <= 1;
  const annualSliderMax = Math.max(20000, Math.ceil(annualKwh / 5000) * 5000);
  const schedulesCustomized = offPeakWindows.length !== DEFAULT_HC_WINDOWS.length || offPeakWindows.some((window, index) => window.start !== DEFAULT_HC_WINDOWS[index]?.start || window.end !== DEFAULT_HC_WINDOWS[index]?.end);

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Déclic HC, accueil"><span className="brand-mark">⌁</span><span>Déclic <strong>HC</strong><small className="version-badge">v{APP_VERSION}</small></span></a>
        <div className="top-actions"><span className="offline-badge"><i /> Fonctionne hors ligne</span><button className="button install-button" disabled={isInstalled} onClick={installApp}>{isInstalled ? "✓ Installée" : "⇩ Installer"}</button><button className="button subtle tariff-button" onClick={() => setTariffsOpen((open) => !open)}>⚙ Grille tarifaire</button></div>
      </header>
      {installHelp && <div className="install-help" role="status"><span><strong>Installer Déclic HC</strong>Sur iPhone : Partager → Sur l’écran d’accueil. Sur Android : menu ⋮ → Installer l’application.</span><button aria-label="Fermer les instructions" onClick={() => setInstallHelp(false)}>×</button></div>}

      <section className="hero" id="top">
        <div><p className="eyebrow">SIMULATEUR PÉDAGOGIQUE · CORSE</p><h1>Et si vos appareils<br />travaillaient <em>au bon moment&nbsp;?</em></h1><p className="intro">Déplacez vos usages flexibles en heures creuses et voyez immédiatement l’effet sur votre facture annuelle.</p></div>
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
        <p className="source-note">Préremplie avec le Tarif Bleu résidentiel EDF Corse TTC au 1er août 2026. Toutes les valeurs restent modifiables.</p>
      </section>}

      <section className="simulator-grid">
        <div className="controls-column">
          <section className="panel setup-panel">
            <div className="step-heading"><span>01</span><div><p>VOTRE FOYER</p><h2>Posons le décor</h2></div></div>
            <div className="two-fields">
              <label>Consommation annuelle<div className="input-wrap"><NumericInput min={0} step={100} value={annualKwh} onValueChange={updateAnnualKwh} /><span>kWh/an</span></div></label>
              <label>Habitants<div className="input-wrap"><NumericInput aria-label="Nombre d’habitants" min={1} max={12} step={1} value={residents} onValueChange={updateResidents} /><span>pers.</span></div></label>
              <label>Puissance du compteur<select value={power} onChange={(e) => setPower(Number(e.target.value))}>{tariffs.map((tariff) => <option key={tariff.power} value={tariff.power}>{tariff.power} kVA</option>)}</select></label>
            </div>
            <label className="annual-slider">
              <span>Ajuster la consommation <strong>{number.format(annualKwh)} kWh/an</strong></span>
              <ThumbOnlyRange aria-label="Consommation annuelle en kilowattheures" min={0} max={annualSliderMax} step={100} value={annualKwh} onValueChange={updateAnnualKwh} />
              <small><span>0 kWh</span><span>{number.format(annualSliderMax)} kWh</span></small>
            </label>
            <label className="range-label"><span>Répartition totale en heures creuses <strong>{results.share.toFixed(0)} %</strong></span><ThumbOnlyRange aria-label="Répartition totale en heures creuses" min={results.minShare} max={results.maxShare} step={1} value={results.share} disabled={results.backgroundKwh <= 0} onValueChange={setTotalHcShare} /></label>
            <div className="range-scale"><span>Minimum {results.minShare.toFixed(0)} %</span><span>Maximum {results.maxShare.toFixed(0)} %</span></div>
            <p className="hint">Commencez le glissement sur la poignée. Le curseur agit sur les usages non listés ; les appareils programmés fixent les limites atteignables.</p>
          </section>

          <section className="panel appliance-panel">
            <div className="step-heading"><span>02</span><div><p>USAGES FLEXIBLES</p><h2>À vous de les décaler</h2></div></div>
            <div className="behavior-guide"><span><strong>Courbe adaptée au foyer</strong>Les usages liés au ménage évoluent avec {residents} habitant{residents > 1 ? "s" : ""} et les kWh annuels. Véhicule, piscine et climatisation restent indépendants.</span><div className="usage-balance"><b>{number.format(results.declaredApplianceKwh)} kWh</b><small>usages listés</small><b>{number.format(results.backgroundKwh)} kWh</b><small>reste du foyer</small></div></div>
            <div className="appliance-list">{appliances.map((appliance) => {
              const calibration = getApplianceCalibration(appliance.type);
              return <article className="appliance" key={appliance.id}>
              <button className="remove" aria-label={`Retirer ${appliance.name}`} onClick={() => setAppliances((current) => current.filter((item) => item.id !== appliance.id))}>×</button>
              <div className="appliance-identity"><input className="appliance-name" aria-label="Nom de l’usage" value={appliance.name} onChange={(e) => updateAppliance(appliance.id, { name: e.target.value })} /><span className={`behavior-toggle ${appliance.calculationMode}`}><i />{appliance.calculationMode === "measured" ? "Valeur mesurée" : appliance.calculationMode === "detailed" ? "Calcul détaillé" : "Valeur de référence"}</span></div>
              <div className="appliance-energy"><NumericInput aria-label={`Consommation annuelle de ${appliance.name}`} min={0} step={10} value={Math.round(appliance.annualKwh)} onValueChange={(value) => updateApplianceKwh(appliance.id, value)} /><span>kWh/an</span></div>
              <div className="schedule scheduled"><span className="schedule-icon">☾</span><span><small>100 % DE L’USAGE EN HC</small>{formatTime(activeOffPeakWindow.start)}–{formatTime(activeOffPeakWindow.end)}</span><i aria-hidden="true" /></div>
              <details className="appliance-assumptions">
                <summary>Hypothèses, flexibilité et source <b>{number.format(appliance.lowKwh)}–{number.format(appliance.highKwh)} kWh/an</b></summary>
                <div className="assumption-grid">
                  <label>Méthode<select value={appliance.calculationMode} onChange={(event) => updateCalculationMode(appliance.id, event.target.value as CalculationMode)}><option value="reference">Valeur de référence</option><option value="measured">Valeur mesurée</option><option value="detailed" disabled>Calcul détaillé — lot 4</option></select></label>
                  <label>Estimation basse<div className="compact-input"><NumericInput min={0} step={10} disabled={appliance.calculationMode === "measured"} value={Math.round(appliance.lowKwh)} onValueChange={(value) => updateAppliance(appliance.id, { lowKwh: clamp(value, 0, appliance.annualKwh) })} /><span>kWh</span></div></label>
                  <label>Estimation haute<div className="compact-input"><NumericInput min={appliance.annualKwh} step={10} disabled={appliance.calculationMode === "measured"} value={Math.round(appliance.highKwh)} onValueChange={(value) => updateAppliance(appliance.id, { highKwh: Math.max(appliance.annualKwh, value) })} /><span>kWh</span></div></label>
                </div>
                <p className="offpeak-assumption"><strong>Placement retenu :</strong> 100 % de cet usage opportuniste pendant les heures creuses.</p>
                {calibration && <p className={`calibration-status ${calibration.confidence}`}><strong>Fiabilité {confidenceLabel(calibration.confidence)}</strong>{calibration.sampleSize > 0 ? <>Échantillon : {calibration.sampleSize} logements · coefficient foyer {calibration.descriptiveExponent.toFixed(2)} (intervalle 95 % : {calibration.descriptiveExponentCi95[0].toFixed(2)}–{calibration.descriptiveExponentCi95[1].toFixed(2)}).</> : <>Aucune voiture électrique exploitable dans le fichier ouvert.</>} {!calibration.residentCalibrated && calibration.residentExponent > 0 && <em>La correction selon les habitants reste indicative.</em>}</p>}
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
          <h2>{verdictPositive ? "Les heures creuses prennent l’avantage" : verdictNeutral ? "Les deux options sont presque à égalité" : "Le tarif Base reste devant"}</h2>
          <div className={`saving ${verdictPositive ? "positive" : "negative"}`}><span>{verdictPositive ? "ÉCONOMIE ESTIMÉE" : verdictNeutral ? "ÉCART ESTIMÉ" : "SURCOÛT HP/HC ESTIMÉ"}</span><strong>{euros.format(Math.abs(results.delta))}<small>/ an</small></strong><p>soit {preciseEuros.format(Math.abs(results.delta) / 12)} par mois</p></div>
          <div className="cost-lines"><div><span>Option Base</span><strong>{euros.format(results.baseCost)}</strong></div><div className="highlight"><span>Option HP / HC</span><strong>{euros.format(results.hphcCost)}</strong></div></div>
          <div className="distribution"><div className="distribution-title"><span>Répartition HP / HC<small>Plage compteur : {formatTime(activeOffPeakWindow.start)}–{formatTime(activeOffPeakWindow.end)}</small></span><strong>{results.share.toFixed(0)} % en HC</strong></div><div className="bar"><span style={{ width: `${results.share}%` }} /></div><div className="bar-legend"><span>☀ HP · {number.format(results.hpKwh)} kWh</span><span>☾ HC · {number.format(results.hcKwh)} kWh</span></div><div className="energy-breakdown"><span>Usages listés<strong>{number.format(results.declaredApplianceKwh)} kWh</strong></span><span>Déplaçables<strong>{number.format(results.declaredShiftableKwh)} kWh</strong></span><span>Placés en HC<strong>{number.format(results.scheduledHc)} kWh</strong></span></div></div>
          <div className="threshold"><span className="threshold-icon">◎</span><p><strong>Votre point d’équilibre</strong><br />HP/HC devient intéressant à partir d’environ <b>{results.threshold.toFixed(0)} %</b> de consommation en heures creuses.</p></div>
          <p className="disclaimer">Estimation TTC, hors évolutions futures et services annexes. Comparez-la à une facture réelle avant toute décision contractuelle.</p>
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
              <label>Début<input aria-label={`Début de la plage ${index + 1}`} type="time" value={window.start} onChange={(event) => { if (validTime(event.target.value)) updateOffPeakWindow(window.id, { start: event.target.value }); }} /></label>
              <b>→</b>
              <label>Fin<input aria-label={`Fin de la plage ${index + 1}`} type="time" value={window.end} onChange={(event) => { if (validTime(event.target.value)) updateOffPeakWindow(window.id, { end: event.target.value }); }} /></label>
              <small className={offPeakDuration(window) === 480 ? "valid" : ""}>{formatDuration(offPeakDuration(window))}</small>
              <button className="remove-window" type="button" aria-label={`Supprimer la plage ${index + 1}`} disabled={offPeakWindows.length === 1} onClick={() => setOffPeakWindows((current) => current.filter((item) => item.id !== window.id))}>×</button>
            </div>)}
            <div className="hc-editor-actions"><button type="button" disabled={offPeakWindows.length >= 8} onClick={addOffPeakWindow}>＋ Ajouter une plage</button><button type="button" onClick={() => { setOffPeakWindows(DEFAULT_HC_WINDOWS); setActiveOffPeakWindowId(DEFAULT_HC_WINDOWS[0].id); }}>↺ Horaires EDF</button></div>
            <p>Une plage officielle dure 8 h. Les modifications mettent immédiatement à jour le graphique et restent enregistrées sur cet appareil.</p>
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

  useEffect(() => {
    if (!focused.current) setDraft(String(value));
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
      if (Number.isFinite(parsed)) onValueChange(parsed);
    }}
    onBlur={(event) => {
      focused.current = false;
      const parsed = Number(draft);
      if (draft.trim() !== "" && Number.isFinite(parsed)) onValueChange(parsed);
      setDraft(String(value));
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
