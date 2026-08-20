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

type Appliance = { id: number; name: string; kwh: number; inOffPeak: boolean };
type ConsumptionMode = "proportional" | "fixed";
type AppliancePreset = { name: string; kwh: number; icon: string; detail: string };

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
  { id: 1, name: "Chauffe-eau", kwh: 1200, inOffPeak: true },
  { id: 2, name: "Lave-linge", kwh: 160, inOffPeak: false },
  { id: 3, name: "Lave-vaisselle", kwh: 220, inOffPeak: false },
];

const APPLIANCE_PRESETS: AppliancePreset[] = [
  { name: "Chauffe-eau", kwh: 1200, icon: "♨", detail: "Ballon électrique" },
  { name: "Véhicule électrique", kwh: 2000, icon: "⚡", detail: "Recharge à domicile" },
  { name: "Pompe de piscine", kwh: 900, icon: "≈", detail: "Filtration programmable" },
  { name: "Ballon thermodynamique", kwh: 500, icon: "◌", detail: "Eau chaude optimisée" },
  { name: "Lave-linge", kwh: 160, icon: "◉", detail: "Cycles différés" },
  { name: "Lave-vaisselle", kwh: 220, icon: "◇", detail: "Cycles différés" },
  { name: "Sèche-linge", kwh: 300, icon: "◎", detail: "Cycles programmables" },
  { name: "Climatisation pilotée", kwh: 600, icon: "❄", detail: "Préclimatisation" },
];

const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const preciseEuros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export default function Home() {
  const [tariffs, setTariffs] = useState<Tariff[]>(DEFAULT_TARIFFS);
  const [power, setPower] = useState(6);
  const [annualKwh, setAnnualKwh] = useState(4500);
  const [backgroundHcShare, setBackgroundHcShare] = useState(25);
  const [appliances, setAppliances] = useState<Appliance[]>(DEFAULT_APPLIANCES);
  const [consumptionMode, setConsumptionMode] = useState<ConsumptionMode>("proportional");
  const [recipeReferenceKwh, setRecipeReferenceKwh] = useState(4500);
  const [tariffsOpen, setTariffsOpen] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("hphc-simulator-state");
      if (saved) {
        const state = JSON.parse(saved);
        if (Array.isArray(state.tariffs)) setTariffs(state.tariffs);
        if (Number.isFinite(state.power)) setPower(state.power);
        if (Number.isFinite(state.annualKwh)) setAnnualKwh(state.annualKwh);
        if (Number.isFinite(state.backgroundHcShare)) setBackgroundHcShare(state.backgroundHcShare);
        if (Array.isArray(state.appliances)) setAppliances(state.appliances);
        if (state.consumptionMode === "fixed" || state.consumptionMode === "proportional") {
          setConsumptionMode(state.consumptionMode);
          if (Number.isFinite(state.recipeReferenceKwh) && state.recipeReferenceKwh > 0) setRecipeReferenceKwh(state.recipeReferenceKwh);
        } else if (Number.isFinite(state.annualKwh) && state.annualKwh > 0) {
          setRecipeReferenceKwh(state.annualKwh);
        }
      }
    } catch { /* Les valeurs par défaut restent actives. */ }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    localStorage.setItem("hphc-simulator-state", JSON.stringify({ tariffs, power, annualKwh, backgroundHcShare, appliances, consumptionMode, recipeReferenceKwh }));
  }, [tariffs, power, annualKwh, backgroundHcShare, appliances, consumptionMode, recipeReferenceKwh]);

  const activeTariff = tariffs.find((tariff) => tariff.power === power) ?? tariffs[0];
  const effectiveAppliances = useMemo(() => {
    const scale = consumptionMode === "proportional" && recipeReferenceKwh > 0 ? annualKwh / recipeReferenceKwh : 1;
    return appliances.map((appliance) => ({ ...appliance, kwh: appliance.kwh * scale }));
  }, [annualKwh, appliances, consumptionMode, recipeReferenceKwh]);

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
    const storedKwh = consumptionMode === "proportional" && annualKwh > 0
      ? displayedKwh * recipeReferenceKwh / annualKwh
      : displayedKwh;
    updateAppliance(id, { kwh: Math.max(0, storedKwh) });
  }

  function changeConsumptionMode(nextMode: ConsumptionMode) {
    if (nextMode === consumptionMode) return;
    if (nextMode === "fixed") {
      setAppliances(effectiveAppliances);
    } else {
      setRecipeReferenceKwh(Math.max(annualKwh, 1));
    }
    setConsumptionMode(nextMode);
  }

  function storedKwhFromDisplayed(displayedKwh: number) {
    return consumptionMode === "proportional" && annualKwh > 0 ? displayedKwh * recipeReferenceKwh / annualKwh : displayedKwh;
  }

  function addAppliance(preset?: AppliancePreset) {
    const model = preset ?? { name: "Nouvel usage", kwh: 150 };
    setAppliances((current) => [...current, {
      id: Date.now() + Math.random(),
      name: model.name,
      kwh: storedKwhFromDisplayed(model.kwh),
      inOffPeak: true,
    }]);
  }

  function setTotalHcShare(totalShare: number) {
    if (annualKwh <= 0 || results.backgroundKwh <= 0) return;
    const desiredHcKwh = annualKwh * totalShare / 100;
    const backgroundShare = (desiredHcKwh - results.scheduledHc) / results.backgroundKwh * 100;
    setBackgroundHcShare(clamp(backgroundShare, 0, 100));
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

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Déclic HC, accueil"><span className="brand-mark">⌁</span><span>Déclic <strong>HC</strong></span></a>
        <div className="top-actions"><span className="offline-badge"><i /> Fonctionne hors ligne</span><button className="button subtle" onClick={() => setTariffsOpen((open) => !open)}>⚙ Grille tarifaire</button></div>
      </header>

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
            <fieldset className="mode-selector">
              <legend>Comment faire évoluer les appareils ?</legend>
              <button type="button" className={consumptionMode === "proportional" ? "active" : ""} onClick={() => changeConsumptionMode("proportional")}>
                <span>Profil proportionnel <b>Recommandé</b></span>
                <small>La même recette : tous les usages suivent la consommation annuelle.</small>
              </button>
              <button type="button" className={consumptionMode === "fixed" ? "active" : ""} onClick={() => changeConsumptionMode("fixed")}>
                <span>Appareils fixes</span>
                <small>Leurs kWh restent identiques, même si le total du foyer change.</small>
              </button>
            </fieldset>
            <label className="range-label"><span>Répartition totale en heures creuses <strong>{results.share.toFixed(0)} %</strong></span><input type="range" min={results.minShare} max={results.maxShare} step="1" value={results.share} disabled={results.backgroundKwh <= 0} onInput={(e) => setTotalHcShare(Number(e.currentTarget.value))} /></label>
            <div className="range-scale"><span>Minimum {results.minShare.toFixed(0)} %</span><span>Maximum {results.maxShare.toFixed(0)} %</span></div>
            <p className="hint">Le curseur agit sur les usages non listés. Les appareils programmés fixent les limites atteignables.</p>
          </section>

          <section className="panel appliance-panel">
            <div className="step-heading"><span>02</span><div><p>USAGES FLEXIBLES</p><h2>À vous de les décaler</h2></div></div>
            <div className="appliance-list">{appliances.map((appliance, index) => <article className="appliance" key={appliance.id}>
              <button className="remove" aria-label={`Retirer ${appliance.name}`} onClick={() => setAppliances((current) => current.filter((item) => item.id !== appliance.id))}>×</button>
              <input className="appliance-name" aria-label="Nom de l’usage" value={appliance.name} onChange={(e) => updateAppliance(appliance.id, { name: e.target.value })} />
              <div className="appliance-energy"><input aria-label={`Consommation annuelle de ${appliance.name}`} type="number" min="0" step="10" value={Math.round(effectiveAppliances[index].kwh)} onChange={(e) => updateApplianceKwh(appliance.id, Number(e.target.value))} /><span>kWh/an</span></div>
              <button className={`schedule ${appliance.inOffPeak ? "scheduled" : ""}`} onClick={() => updateAppliance(appliance.id, { inOffPeak: !appliance.inOffPeak })}><span className="schedule-icon">{appliance.inOffPeak ? "☾" : "☀"}</span><span><small>{appliance.inOffPeak ? "PROGRAMMÉ EN" : "CONSOMMÉ EN"}</small>{appliance.inOffPeak ? "Heures creuses" : "Heures pleines"}</span><i /></button>
            </article>)}</div>
            <details className="preset-library">
              <summary>＋ Ajouter un consommateur préenregistré</summary>
              <div className="preset-heading"><strong>Modèles opportunistes</strong><span>Estimations indicatives, modifiables après ajout</span></div>
              <div className="preset-grid">
                {APPLIANCE_PRESETS.map((preset) => <button type="button" key={preset.name} onClick={() => addAppliance(preset)}>
                  <span className="preset-icon">{preset.icon}</span>
                  <span><strong>{preset.name}</strong><small>{preset.detail} · {number.format(preset.kwh)} kWh/an</small></span>
                  <b>＋</b>
                </button>)}
              </div>
              <button type="button" className="custom-preset" onClick={() => addAppliance()}>＋ Créer un usage personnalisé</button>
            </details>
            {results.flexibleKwh >= annualKwh && annualKwh > 0 && <p className="warning">La somme des usages flexibles atteint la consommation totale du foyer.</p>}
          </section>
        </div>

        <aside className="result-card">
          <p className="step light">VOTRE SIMULATION · {power} KVA</p>
          <h2>{verdictPositive ? "Les heures creuses prennent l’avantage" : verdictNeutral ? "Les deux options sont presque à égalité" : "Le tarif Base reste devant"}</h2>
          <div className={`saving ${verdictPositive ? "positive" : "negative"}`}><span>{verdictPositive ? "ÉCONOMIE ESTIMÉE" : verdictNeutral ? "ÉCART ESTIMÉ" : "SURCOÛT HP/HC ESTIMÉ"}</span><strong>{euros.format(Math.abs(results.delta))}<small>/ an</small></strong><p>soit {preciseEuros.format(Math.abs(results.delta) / 12)} par mois</p></div>
          <div className="cost-lines"><div><span>Option Base</span><strong>{euros.format(results.baseCost)}</strong></div><div className="highlight"><span>Option HP / HC</span><strong>{euros.format(results.hphcCost)}</strong></div></div>
          <div className="distribution"><div className="distribution-title"><span>Répartition HP / HC</span><strong>{results.share.toFixed(0)} % en HC</strong></div><div className="bar"><span style={{ width: `${results.share}%` }} /></div><div className="bar-legend"><span>☀ HP · {number.format(results.hpKwh)} kWh</span><span>☾ HC · {number.format(results.hcKwh)} kWh</span></div></div>
          <div className="threshold"><span className="threshold-icon">◎</span><p><strong>Votre point d’équilibre</strong><br />HP/HC devient intéressant à partir d’environ <b>{results.threshold.toFixed(0)} %</b> de consommation en heures creuses.</p></div>
          <p className="disclaimer">Estimation TTC, hors évolutions futures et services annexes. Comparez-la à une facture réelle avant toute décision contractuelle.</p>
        </aside>
      </section>

      <section className="timeline-section">
        <div className="timeline-copy"><p className="eyebrow">COMPRENDRE EN UN COUP D’ŒIL</p><h2>Une journée électrique en Corse</h2><p>Les créneaux dépendent du compteur. La réforme engagée vise à déplacer progressivement une partie des heures creuses vers la journée solaire.</p></div>
        <div className="timeline-card"><div className="timeline-hours"><span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>24h</span></div><div className="timeline-track"><span className="night-one" /><span className="daytime" /><span className="night-two" /></div><div className="timeline-labels"><span>☾ HC nocturnes</span><span>☀ HC diurnes visées<br /><small>au moins 3 heures</small></span><span>HP du soir</span></div><p className="timeline-note"><strong>Attention :</strong> 12 h–15 h illustre la plage méridienne visée, pas un horaire garanti. Seul le créneau communiqué par EDF pour votre compteur fait foi.</p></div>
      </section>
      <footer><span>Déclic HC · outil indépendant de sensibilisation</span><span>Données enregistrées uniquement sur cet appareil</span></footer>
    </main>
  );
}

function Field({ label, suffix, value, step = 0.01, onChange }: { label: string; suffix: string; value: number; step?: number; onChange: (value: number) => void }) {
  return <label>{label}<div className="input-wrap"><input type="number" min="0" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /><span>{suffix}</span></div></label>;
}
