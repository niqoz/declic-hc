import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateApplianceOffPeakKwh,
  calculateBaseCost,
  calculateBreakEvenShare,
  calculateHphcCost,
  calculateSimulation,
} from "../.test-dist/calculate.js";
import { APPLIANCE_PRESETS, DEFAULT_APPLIANCES } from "../.test-dist/presets.js";
import { scaleAppliancesForHousehold } from "../.test-dist/scaling.js";
import {
  CURRENT_STATE_VERSION,
  loadSimulationState,
  saveSimulationState,
  STATE_STORAGE_KEY,
} from "../.test-dist/storage.js";

const tariff = {
  power: 6,
  baseSubscription: 175.56,
  hphcSubscription: 175.56,
  basePrice: 0.1834,
  hpPrice: 0.1964,
  hcPrice: 0.1457,
};

const appliances = DEFAULT_APPLIANCES.map((appliance) => ({ ...appliance, source: { ...appliance.source } }));
const defaultState = {
  version: CURRENT_STATE_VERSION,
  tariffs: [tariff],
  power: 6,
  annualKwh: 4500,
  residents: 2,
  backgroundHcShare: 25,
  appliances,
  offPeakWindows: [{ id: 1, start: "21:40", end: "05:40" }],
  activeOffPeakWindowId: 1,
};

const closeTo = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} devrait être proche de ${expected}`);
};

test("calcule séparément les coûts Base et HP/HC", () => {
  closeTo(calculateBaseCost(4500, tariff), 1000.86);
  closeTo(calculateHphcCost(2570, 1930, tariff), 961.509);
});

test("reproduit le scénario central de l'interface", () => {
  const result = calculateSimulation({ annualKwh: 4500, backgroundHcShare: 25, tariff, appliances });

  closeTo(result.declaredApplianceKwh, 1580);
  closeTo(result.declaredShiftableKwh, 1580);
  closeTo(result.backgroundKwh, 2920);
  closeTo(result.scheduledHc, 1580);
  closeTo(result.hcKwh, 2310);
  closeTo(result.hpKwh, 2190);
  closeTo(result.baseCost, 1000.86);
  closeTo(result.hphcCost, 942.243);
  closeTo(result.delta, 58.617);
  closeTo(result.threshold, 25.64102564102564);
  assert.deepEqual(result.warnings, []);
});

test("place toujours 100 % des consommateurs opportunistes en HC", () => {
  const appliance = { ...appliances[0], shiftableShare: 80, offPeakShare: 50 };
  closeTo(calculateApplianceOffPeakKwh(appliance), 1200);
});

test("préserve toujours le bilan énergétique et plafonne les usages", () => {
  const oversized = [
    { ...appliances[0], id: 10, name: "Usage A", annualKwh: 3000, lowKwh: 2500, highKwh: 3500, offPeakShare: 100 },
    { ...appliances[1], id: 11, name: "Usage B", annualKwh: 2000, lowKwh: 1500, highKwh: 2500, offPeakShare: 0 },
  ];
  const result = calculateSimulation({ annualKwh: 4000, backgroundHcShare: 25, tariff, appliances: oversized });

  closeTo(result.applianceScale, 0.8);
  closeTo(result.applianceKwh, 4000);
  closeTo(result.backgroundKwh, 0);
  closeTo(result.hpKwh + result.hcKwh, 4000);
  assert.ok(result.hpKwh >= 0 && result.hcKwh >= 0);
  assert.equal(result.warnings[0].code, "APPLIANCES_EXCEED_TOTAL");
});

test("fait évoluer les usages liés au foyer avec les kWh et les habitants", () => {
  const raised = scaleAppliancesForHousehold(
    appliances,
    { annualKwh: 4500, residents: 2 },
    { annualKwh: 10000, residents: 4 },
  );

  assert.ok(raised[0].annualKwh > appliances[0].annualKwh);
  assert.ok(raised[1].annualKwh > appliances[1].annualKwh);
  assert.ok(raised[2].annualKwh > appliances[2].annualKwh);
  assert.ok(raised.every((appliance) => appliance.offPeakShare === 100 && appliance.shiftableShare === 100));

  const measured = scaleAppliancesForHousehold(
    [{ ...appliances[0], calculationMode: "measured", annualKwh: 1350 }],
    { annualKwh: 4500, residents: 2 },
    { annualKwh: 10000, residents: 4 },
  );
  assert.equal(measured[0].annualKwh, 1350);
});

test("gère une consommation nulle sans produire de valeur invalide", () => {
  const result = calculateSimulation({ annualKwh: 0, backgroundHcShare: 25, tariff, appliances: [] });

  assert.equal(result.hpKwh, 0);
  assert.equal(result.hcKwh, 0);
  assert.equal(result.share, 0);
  assert.equal(result.baseCost, tariff.baseSubscription);
  assert.equal(result.hphcCost, tariff.hphcSubscription);
  assert.ok(Object.values(result).filter((value) => typeof value === "number").every(Number.isFinite));
});

test("le point d'équilibre égalise les deux tarifs", () => {
  const threshold = calculateBreakEvenShare(4500, tariff);
  const result = calculateSimulation({ annualKwh: 4500, backgroundHcShare: threshold, tariff, appliances: [] });
  closeTo(result.baseCost, result.hphcCost, 1e-9);
});

test("sauvegarde une version explicite et recharge le même état", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  saveSimulationState(storage, defaultState);
  const serialized = JSON.parse(values.get(STATE_STORAGE_KEY));
  assert.equal(serialized.version, CURRENT_STATE_VERSION);
  assert.deepEqual(loadSimulationState(storage, defaultState, APPLIANCE_PRESETS), defaultState);
});

test("fige à sa valeur affichée un ancien appareil proportionnel", () => {
  const legacy = {
    version: 2,
    annualKwh: 7200,
    power: 6,
    backgroundHcShare: 25,
    appliances: [{ id: 9, name: "Chauffe-eau", kwh: 1200, inOffPeak: true, mode: "proportional", referenceKwh: 4500 }],
    offPeakWindows: defaultState.offPeakWindows,
    activeOffPeakWindowId: 1,
  };
  const migrated = loadSimulationState({ getItem: () => JSON.stringify(legacy) }, defaultState, APPLIANCE_PRESETS);

  assert.equal(migrated.version, CURRENT_STATE_VERSION);
  assert.equal(migrated.appliances[0].annualKwh, 1920);
  assert.equal(migrated.appliances[0].lowKwh, 1440);
  assert.equal(migrated.appliances[0].highKwh, 2560);
  assert.equal(migrated.appliances[0].offPeakShare, 100);
  assert.equal(migrated.residents, 2);

  const afterHouseholdChange = calculateSimulation({ annualKwh: 10000, backgroundHcShare: 25, tariff, appliances: migrated.appliances });
  assert.equal(afterHouseholdChange.declaredApplianceKwh, 1920);
});

test("migre une sauvegarde plus ancienne et répare ses plages invalides", () => {
  const legacy = {
    annualKwh: 7200,
    power: 6,
    backgroundHcShare: 130,
    appliances: [{ id: 9, name: "Chauffe-eau", kwh: 999, inOffPeak: true }],
    offPeakWindows: [{ id: 7, start: "25:00", end: "06:00" }],
    activeOffPeakWindowId: 999,
  };
  const migrated = loadSimulationState({ getItem: () => JSON.stringify(legacy) }, defaultState, APPLIANCE_PRESETS);

  assert.equal(migrated.version, CURRENT_STATE_VERSION);
  assert.equal(migrated.annualKwh, 7200);
  assert.equal(migrated.backgroundHcShare, 100);
  assert.equal(migrated.appliances[0].annualKwh, 1200);
  assert.equal(migrated.appliances[0].calculationMode, "reference");
  assert.deepEqual(migrated.offPeakWindows, defaultState.offPeakWindows);
  assert.equal(migrated.activeOffPeakWindowId, 1);
});

test("revient aux valeurs par défaut lorsque la sauvegarde est corrompue", () => {
  const state = loadSimulationState({ getItem: () => "{invalide" }, defaultState, APPLIANCE_PRESETS);
  assert.deepEqual(state, defaultState);
  assert.notEqual(state.appliances, defaultState.appliances);
  assert.notEqual(state.appliances[0].source, defaultState.appliances[0].source);
});

test("utilise le même numéro de version dans la PWA, le cache et le paquet", async () => {
  const [versionSource, pageSource, manifestSource, serviceWorkerSource, packageSource, lockSource] = await Promise.all([
    readFile(new URL("../app/version.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
  ]);
  const version = versionSource.match(/APP_VERSION = "([^"]+)"/)?.[1];

  assert.equal(version, "0.3.0");
  assert.match(pageSource, /v\{APP_VERSION\}/);
  assert.equal(JSON.parse(manifestSource).version, version);
  assert.match(serviceWorkerSource, new RegExp(`declic-hc-v${version?.replaceAll(".", "\\.")}`));
  assert.equal(JSON.parse(packageSource).version, version);
  assert.equal(JSON.parse(lockSource).version, version);
  assert.equal(JSON.parse(lockSource).packages[""].version, version);
});
