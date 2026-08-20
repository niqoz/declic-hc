"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";

type Tariff = {
  power: number;
  baseSubscription: number;
  hphcSubscription: number;
  basePrice: number;
  hpPrice: number;
  hcPrice: number;
};

type ConsumptionMode = "proportional" | "fixed";
type Appliance = { id: number; name: string; kwh: number; inOffPeak: boolean; mode: ConsumptionMode; referenceKwh: number };
type AppliancePreset = { name: string; kwh: number; icon: string; detail: string; mode: ConsumptionMode; referenceKwh: number };
type OffPeakWindow = { id: number; start: string; end: string };
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

const DEFAULT_APPLIANCES: Appliance[] = [
  { id: 1, name: "Chauffe-eau", kwh: 1200, inOffPeak: true, mode: "proportional", referenceKwh: 4500 },
  { id: 2, name: "Lave-linge", kwh: 160, inOffPeak: false, mode: "proportional", referenceKwh: 4500 },
  { id: 3, name: "Lave-vaisselle", kwh: 220, inOffPeak: false, mode: "proportional", referenceKwh: 4500 },
];

const APPLIANCE_PRESETS: AppliancePreset[] = [
  { name: "Chauffe-eau", kwh: 1200, icon: "♨", detail: "Ballon électrique", mode: "proportional", referenceKwh: 4500 },
  { name: "Véhicule électrique", kwh: 2000, icon: "⚡", detail: "Recharge à domicile", mode: "fixed", referenceKwh: 4500 },
  { name: "Pompe de piscine", kwh: 900, icon: "≈", detail: "Filtration programmable", mode: "fixed", referenceKwh: 4500 },
  { name: "Ballon thermodynamique", kwh: 500, icon: "◌", detail: "Eau chaude optimisée", mode: "proportional", referenceKwh: 4500 },
  { name: "Lave-linge", kwh: 160, icon: "◉", detail: "Cycles différés", mode: "proportional", referenceKwh: 4500 },
  { name: "Lave-vaisselle", kwh: 220, icon: "◇", detail: "Cycles différés", mode: "proportional", referenceKwh: 4500 },
  { name: "Sèche-linge", kwh: 300, icon: "◎", detail: "Cycles programmables", mode: "proportional", referenceKwh: 4500 },
  { name: "Climatisation pilotée", kwh: 600, icon: "❄", detail: "Préclimatisation", mode: "proportional", referenceKwh: 4500 },
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
const HOUSEHOLD_REFERENCE_KWH = 4500;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
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

export default function Home() {
  const [tariffs, setTariffs] = useState<Tariff[]>(DEFAULT_TARIFFS);
  const [power, setPower] = useState(6);
  const [annualKwh, setAnnualKwh] = useState(4500);
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

  useEffect(() => {
    try {
      const saved = localStorage.getItem("hphc-simulator-state");
      if (saved) {
        const state = JSON.parse(saved);
        if (Array.isArray(state.tariffs)) setTariffs(state.tariffs);
        if (Number.isFinite(state.power)) setPower(state.power);
        if (Number.isFinite(state.annualKwh)) setAnnualKwh(state.annualKwh);
        if (Number.isFinite(state.backgroundHcShare)) setBackgroundHcShare(state.backgroundHcShare);
        if (Array.isArray(state.appliances)) {
          const savedAnnualKwh = Number.isFinite(state.annualKwh) && state.annualKwh > 0 ? state.annualKwh : 4500;
          const legacyReferenceKwh = Number.isFinite(state.recipeReferenceKwh) && state.recipeReferenceKwh > 0 ? state.recipeReferenceKwh : savedAnnualKwh;
          const legacyScale = state.consumptionMode === "proportional" ? savedAnnualKwh / legacyReferenceKwh : 1;
          setAppliances(state.appliances.map((appliance: Partial<Appliance>, index: number) => {
            const hasIndividualMode = appliance.mode === "fixed" || appliance.mode === "proportional";
            const matchingPreset = APPLIANCE_PRESETS.find((preset) => preset.name === appliance.name);
            return {
              id: Number.isFinite(appliance.id) ? Number(appliance.id) : index + 1,
              name: typeof appliance.name === "string" ? appliance.name : `Usage ${index + 1}`,
              kwh: hasIndividualMode ? Math.max(0, Number(appliance.kwh) || 0) : matchingPreset?.kwh ?? Math.max(0, Number(appliance.kwh) || 0) * legacyScale,
              inOffPeak: Boolean(appliance.inOffPeak),
              mode: hasIndividualMode ? appliance.mode as ConsumptionMode : matchingPreset?.mode ?? "fixed",
              referenceKwh: Number.isFinite(appliance.referenceKwh) && Number(appliance.referenceKwh) > 0 ? Number(appliance.referenceKwh) : matchingPreset?.referenceKwh ?? savedAnnualKwh,
            };
          }));
        }
        if (Array.isArray(state.offPeakWindows)) {
          const savedWindows = state.offPeakWindows
            .filter((window: Partial<OffPeakWindow>) => validTime(window.start) && validTime(window.end))
            .map((window: OffPeakWindow, index: number) => ({ ...window, id: Number.isFinite(window.id) ? window.id : index + 1 }));
          if (savedWindows.length) setOffPeakWindows(savedWindows);
        }
        if (Number.isFinite(state.activeOffPeakWindowId)) setActiveOffPeakWindowId(state.activeOffPeakWindowId);
      }
    } catch { /* Les valeurs par défaut restent actives. */ }
    if ("serviceWorker" in navigator) {
      const serviceWorkerUrl = new URL("sw.js", document.baseURI);
      navigator.serviceWorker.register(serviceWorkerUrl.pathname).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
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
    localStorage.setItem("hphc-simulator-state", JSON.stringify({ tariffs, power, annualKwh, backgroundHcShare, appliances, offPeakWindows, activeOffPeakWindowId }));
  }, [tariffs, power, annualKwh, backgroundHcShare, appliances, offPeakWindows, activeOffPeakWindowId]);

  useEffect(() => {
    if (!offPeakWindows.some((window) => window.id === activeOffPeakWindowId)) setActiveOffPeakWindowId(offPeakWindows[0].id);
  }, [activeOffPeakWindowId, offPeakWindows]);

  const activeTariff = tariffs.find((tariff) => tariff.power === power) ?? tariffs[0];
  const activeOffPeakWindow = offPeakWindows.find((window) => window.id === activeOffPeakWindowId) ?? offPeakWindows[0];
  const effectiveAppliances = useMemo(() => {
    return appliances.map((appliance) => ({ ...appliance, kwh: appliance.kwh * (appliance.mode === "proportional" && appliance.referenceKwh > 0 ? annualKwh / appliance.referenceKwh : 1) }));
  }, [annualKwh, appliances]);

  const results = useMemo(() => {
    const declaredFlexible = effectiveAppliances.reduce((sum, appliance) => sum + Math.max(0, appliance.kwh), 0);
    const flexibleKwh = Math.min(annualKwh, declaredFlexible);
    const ratio = declaredFlexible > annualKwh && declaredFlexible > 0 ? annualKwh / declaredFlexible : 1;
    const backgroundKwh = Math.max(0, annualKwh - flexibleKwh);
    const backgroundHc = backgroundKwh * backgroundHcShare / 100;
    const scheduledHc = effectiveAppliances.filter((a) => a.inOffPeak).reduce((sum, a) => sum + a.kwh * ratio, 0);
    const hcKwh = Math.min(annualKwh, backgroundHc + scheduledHc);
    const hpKwh = annualKwh - hcKwh;
    const baseCost = activeTariff.baseSubscription + annualKwh * activeTariff.basePrice;
    const hphcCost = activeTariff.hphcSubscription + hpKwh * activeTariff.hpPrice + hcKwh * activeTariff.hcPrice;
    const delta = baseCost - hphcCost;
    const share = annualKwh > 0 ? hcKwh / annualKwh * 100 : 0;
    const denominator = activeTariff.hpPrice - activeTariff.hcPrice;
    const threshold = denominator > 0
      ? clamp(((activeTariff.hpPrice - activeTariff.basePrice) * annualKwh + activeTariff.hphcSubscription - activeTariff.baseSubscription) / (denominator * Math.max(1, annualKwh)) * 100, 0, 100)
      : 100;
    const minShare = annualKwh > 0 ? scheduledHc / annualKwh * 100 : 0;
    const maxShare = annualKwh > 0 ? (scheduledHc + backgroundKwh) / annualKwh * 100 : 0;
    return { flexibleKwh, backgroundKwh, scheduledHc, hcKwh, hpKwh, baseCost, hphcCost, delta, share, threshold, minShare, maxShare };
  }, [activeTariff, annualKwh, effectiveAppliances, backgroundHcShare]);

  function updateTariff(field: keyof Omit<Tariff, "power">, value: number) {
    setTariffs((current) => current.map((tariff) => tariff.power === power ? { ...tariff, [field]: Math.max(0, value) } : tariff));
  }

  function updateAppliance(id: number, patch: Partial<Appliance>) {
    setAppliances((current) => current.map((appliance) => appliance.id === id ? { ...appliance, ...patch } : appliance));
  }

  function updateApplianceKwh(id: number, displayedKwh: number) {
    const appliance = appliances.find((item) => item.id === id);
    if (!appliance) return;
    const storedKwh = appliance.mode === "proportional" && annualKwh > 0 ? displayedKwh * appliance.referenceKwh / annualKwh : displayedKwh;
    updateAppliance(id, { kwh: Math.max(0, storedKwh) });
  }

  function changeApplianceMode(id: number, nextMode: ConsumptionMode) {
    const displayed = effectiveAppliances.find((appliance) => appliance.id === id);
    if (!displayed || displayed.mode === nextMode) return;
    updateAppliance(id, {
      kwh: nextMode === "proportional" && annualKwh > 0 ? displayed.kwh * HOUSEHOLD_REFERENCE_KWH / annualKwh : displayed.kwh,
      mode: nextMode,
      referenceKwh: HOUSEHOLD_REFERENCE_KWH,
    });
  }

  function setAllApplianceModes(nextMode: ConsumptionMode) {
    setAppliances((current) => current.map((appliance) => {
      const displayed = effectiveAppliances.find((item) => item.id === appliance.id) ?? appliance;
      return {
        ...appliance,
        kwh: nextMode === "proportional" && annualKwh > 0 ? displayed.kwh * HOUSEHOLD_REFERENCE_KWH / annualKwh : displayed.kwh,
        mode: nextMode,
        referenceKwh: HOUSEHOLD_REFERENCE_KWH,
      };
    }));
  }

  function addAppliance(preset?: AppliancePreset) {
    const model = preset ?? { name: "Nouvel usage", kwh: 150, mode: "fixed" as ConsumptionMode, referenceKwh: Math.max(annualKwh, 1) };
    setAppliances((current) => [...current, {
      id: Date.now() + Math.random(),
      name: model.name,
      kwh: model.kwh,
      inOffPeak: true,
      mode: model.mode,
      referenceKwh: model.referenceKwh,
    }]);
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
        <a className="brand" href="#top" aria-label="Déclic HC, accueil"><span className="brand-mark">⌁</span><span>Déclic <strong>HC</strong></span></a>
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
              <label>Consommation annuelle<div className="input-wrap"><input type="number" min="0" step="100" value={annualKwh} onChange={(e) => setAnnualKwh(Math.max(0, Number(e.target.value)))} /><span>kWh/an</span></div></label>
              <label>Puissance du compteur<select value={power} onChange={(e) => setPower(Number(e.target.value))}>{tariffs.map((tariff) => <option key={tariff.power} value={tariff.power}>{tariff.power} kVA</option>)}</select></label>
            </div>
            <label className="annual-slider">
              <span>Ajuster la consommation <strong>{number.format(annualKwh)} kWh/an</strong></span>
              <input aria-label="Consommation annuelle en kilowattheures" type="range" min="0" max={annualSliderMax} step="100" value={annualKwh} onInput={(e) => setAnnualKwh(Number(e.currentTarget.value))} />
              <small><span>0 kWh</span><span>{number.format(annualSliderMax)} kWh</span></small>
            </label>
            <label className="range-label"><span>Répartition totale en heures creuses <strong>{results.share.toFixed(0)} %</strong></span><input type="range" min={results.minShare} max={results.maxShare} step="1" value={results.share} disabled={results.backgroundKwh <= 0} onInput={(e) => setTotalHcShare(Number(e.currentTarget.value))} /></label>
            <div className="range-scale"><span>Minimum {results.minShare.toFixed(0)} %</span><span>Maximum {results.maxShare.toFixed(0)} %</span></div>
            <p className="hint">Le curseur agit sur les usages non listés. Les appareils programmés fixent les limites atteignables.</p>
          </section>

          <section className="panel appliance-panel">
            <div className="step-heading"><span>02</span><div><p>USAGES FLEXIBLES</p><h2>À vous de les décaler</h2></div></div>
            <div className="behavior-guide"><span><strong>Références stables</strong>Les modèles proportionnels sont toujours calculés depuis un foyer de référence de 4 500 kWh/an, jamais depuis la position du curseur au moment de l’ajout.</span><div><button type="button" onClick={() => setAllApplianceModes("fixed")}>Tout fixer</button><button type="button" onClick={() => setAllApplianceModes("proportional")}>Tout proportionnel</button></div></div>
            <div className="appliance-list">{appliances.map((appliance, index) => <article className="appliance" key={appliance.id}>
              <button className="remove" aria-label={`Retirer ${appliance.name}`} onClick={() => setAppliances((current) => current.filter((item) => item.id !== appliance.id))}>×</button>
              <div className="appliance-identity"><input className="appliance-name" aria-label="Nom de l’usage" value={appliance.name} onChange={(e) => updateAppliance(appliance.id, { name: e.target.value })} /><button type="button" className={`behavior-toggle ${appliance.mode}`} onClick={() => changeApplianceMode(appliance.id, appliance.mode === "fixed" ? "proportional" : "fixed")}><i />{appliance.mode === "fixed" ? "Valeur fixe" : `Proportionnel · réf. ${number.format(appliance.referenceKwh)}`}</button></div>
              <div className="appliance-energy"><input aria-label={`Consommation annuelle de ${appliance.name}`} type="number" min="0" step="10" value={Math.round(effectiveAppliances[index].kwh)} onChange={(e) => updateApplianceKwh(appliance.id, Number(e.target.value))} /><span>kWh/an</span></div>
              <button className={`schedule ${appliance.inOffPeak ? "scheduled" : ""}`} onClick={() => updateAppliance(appliance.id, { inOffPeak: !appliance.inOffPeak })}><span className="schedule-icon">{appliance.inOffPeak ? "☾" : "☀"}</span><span><small>{appliance.inOffPeak ? "PROGRAMMÉ EN HC" : "CONSOMMÉ EN"}</small>{appliance.inOffPeak ? `${formatTime(activeOffPeakWindow.start)}–${formatTime(activeOffPeakWindow.end)}` : "Heures pleines"}</span><i /></button>
            </article>)}</div>
            <details className="preset-library">
              <summary>＋ Ajouter un consommateur préenregistré</summary>
              <div className="preset-heading"><strong>Modèles opportunistes</strong><span>Estimations indicatives, modifiables après ajout</span></div>
              <div className="preset-grid">
                {APPLIANCE_PRESETS.map((preset) => <button type="button" key={preset.name} onClick={() => addAppliance(preset)}>
                  <span className="preset-icon">{preset.icon}</span>
                  <span><strong>{preset.name}</strong><small>{preset.detail} · {number.format(preset.kwh)} kWh/an {preset.mode === "proportional" ? `à ${number.format(preset.referenceKwh)} kWh foyer` : "fixes"}</small></span>
                  <b>＋</b>
                </button>)}
              </div>
              <button type="button" className="custom-preset" onClick={() => addAppliance()}>＋ Créer un usage personnalisé</button>
            </details>
            {results.flexibleKwh >= annualKwh && annualKwh > 0 && <p className="warning">La somme des usages flexibles atteint la consommation totale du foyer.</p>}
          </section>
        </div>

        <aside className="result-card" id="result">
          <p className="step light">VOTRE SIMULATION · {power} KVA</p>
          <h2>{verdictPositive ? "Les heures creuses prennent l’avantage" : verdictNeutral ? "Les deux options sont presque à égalité" : "Le tarif Base reste devant"}</h2>
          <div className={`saving ${verdictPositive ? "positive" : "negative"}`}><span>{verdictPositive ? "ÉCONOMIE ESTIMÉE" : verdictNeutral ? "ÉCART ESTIMÉ" : "SURCOÛT HP/HC ESTIMÉ"}</span><strong>{euros.format(Math.abs(results.delta))}<small>/ an</small></strong><p>soit {preciseEuros.format(Math.abs(results.delta) / 12)} par mois</p></div>
          <div className="cost-lines"><div><span>Option Base</span><strong>{euros.format(results.baseCost)}</strong></div><div className="highlight"><span>Option HP / HC</span><strong>{euros.format(results.hphcCost)}</strong></div></div>
          <div className="distribution"><div className="distribution-title"><span>Répartition HP / HC<small>Plage compteur : {formatTime(activeOffPeakWindow.start)}–{formatTime(activeOffPeakWindow.end)}</small></span><strong>{results.share.toFixed(0)} % en HC</strong></div><div className="bar"><span style={{ width: `${results.share}%` }} /></div><div className="bar-legend"><span>☀ HP · {number.format(results.hpKwh)} kWh</span><span>☾ HC · {number.format(results.hcKwh)} kWh</span></div></div>
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
      <footer><span>Déclic HC · outil indépendant de sensibilisation</span><span>Données enregistrées uniquement sur cet appareil</span></footer>
    </main>
  );
}

function Field({ label, suffix, value, step = 0.01, onChange }: { label: string; suffix: string; value: number; step?: number; onChange: (value: number) => void }) {
  return <label>{label}<div className="input-wrap"><input type="number" min="0" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /><span>{suffix}</span></div></label>;
}
