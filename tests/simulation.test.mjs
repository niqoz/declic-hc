import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateBaseCost,
  calculateBreakEvenShare,
  calculateEffectiveAppliances,
  calculateHphcCost,
  calculateSimulation,
} from "../.test-dist/calculate.js";
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

const appliances = [
  { id: 1, name: "Chauffe-eau", kwh: 1200, inOffPeak: true, mode: "proportional", referenceKwh: 4500 },
  { id: 2, name: "Lave-linge", kwh: 160, inOffPeak: false, mode: "proportional", referenceKwh: 4500 },
  { id: 3, name: "Lave-vaisselle", kwh: 220, inOffPeak: false, mode: "proportional", referenceKwh: 4500 },
];

const presets = appliances.map((appliance) => ({ ...appliance, icon: "", detail: "" }));
const defaultState = {
  version: CURRENT_STATE_VERSION,
  tariffs: [tariff],
  power: 6,
  annualKwh: 4500,
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

test("reproduit le scénario de référence de l'interface", () => {
  const result = calculateSimulation({ annualKwh: 4500, backgroundHcShare: 25, tariff, appliances });

  closeTo(result.declaredFlexibleKwh, 1580);
  closeTo(result.backgroundKwh, 2920);
  closeTo(result.scheduledHc, 1200);
  closeTo(result.hcKwh, 1930);
  closeTo(result.hpKwh, 2570);
  closeTo(result.baseCost, 1000.86);
  closeTo(result.hphcCost, 961.509);
  closeTo(result.delta, 39.351);
  closeTo(result.threshold, 25.64102564102564);
  assert.deepEqual(result.warnings, []);
});

test("préserve toujours le bilan énergétique et plafonne les usages", () => {
  const oversized = [
    { id: 1, name: "Usage A", kwh: 3000, inOffPeak: true, mode: "fixed", referenceKwh: 4500 },
    { id: 2, name: "Usage B", kwh: 2000, inOffPeak: false, mode: "fixed", referenceKwh: 4500 },
  ];
  const result = calculateSimulation({ annualKwh: 4000, backgroundHcShare: 25, tariff, appliances: oversized });

  closeTo(result.applianceScale, 0.8);
  closeTo(result.flexibleKwh, 4000);
  closeTo(result.backgroundKwh, 0);
  closeTo(result.hpKwh + result.hcKwh, 4000);
  assert.ok(result.hpKwh >= 0 && result.hcKwh >= 0);
  assert.equal(result.warnings[0].code, "APPLIANCES_EXCEED_TOTAL");
});

test("le slider annuel est réversible", () => {
  const initial = calculateEffectiveAppliances(appliances, 4500).map((appliance) => appliance.kwh);
  const raised = calculateEffectiveAppliances(appliances, 10000).map((appliance) => appliance.kwh);
  const restored = calculateEffectiveAppliances(appliances, 4500).map((appliance) => appliance.kwh);

  assert.ok(raised.every((value, index) => value > initial[index]));
  assert.deepEqual(restored, initial);
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
  assert.deepEqual(loadSimulationState(storage, defaultState, presets), defaultState);
});

test("migre une sauvegarde historique et répare ses plages invalides", () => {
  const legacy = {
    annualKwh: 7200,
    power: 6,
    backgroundHcShare: 130,
    appliances: [{ id: 9, name: "Chauffe-eau", kwh: 999, inOffPeak: true }],
    offPeakWindows: [{ id: 7, start: "25:00", end: "06:00" }],
    activeOffPeakWindowId: 999,
  };
  const storage = { getItem: () => JSON.stringify(legacy) };
  const migrated = loadSimulationState(storage, defaultState, presets);

  assert.equal(migrated.version, CURRENT_STATE_VERSION);
  assert.equal(migrated.annualKwh, 7200);
  assert.equal(migrated.backgroundHcShare, 100);
  assert.equal(migrated.appliances[0].kwh, 1200);
  assert.equal(migrated.appliances[0].mode, "proportional");
  assert.deepEqual(migrated.offPeakWindows, defaultState.offPeakWindows);
  assert.equal(migrated.activeOffPeakWindowId, 1);
});

test("revient aux valeurs par défaut lorsque la sauvegarde est corrompue", () => {
  const state = loadSimulationState({ getItem: () => "{invalide" }, defaultState, presets);
  assert.deepEqual(state, defaultState);
  assert.notEqual(state.appliances, defaultState.appliances);
});
