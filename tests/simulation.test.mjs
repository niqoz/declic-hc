import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateBaseCost,
  calculateBreakEvenShare,
  calculateHphcCost,
  calculateSimulation,
  summarizeDelta,
} from "../.test-dist/calculate.js";
import { APPLIANCE_PRESETS, DEFAULT_APPLIANCES } from "../.test-dist/presets.js";
import { ELECDOM_DATA_QUALITY, getApplianceCalibration } from "../.test-dist/calibration.js";
import { coolingDwellingFactor, estimateCoolingHcShare, estimateCoolingProfile } from "../.test-dist/cooling.js";
import {
  estimateHeating,
  HEATING_HIGH_RATIO,
  HEATING_LOW_RATIO,
  isValidOffPeakWindow,
  offPeakDurationMinutes,
  updateOffPeakWindowTime,
} from "../.test-dist/heating.js";
import { rescaleAppliancesToResidentExponent, residentExponent, scaleAppliancesForResidents } from "../.test-dist/occupants.js";
import { baseOptionAvailability, baseOptionNotice, tariffGridFreshness, tariffGridNotice } from "../.test-dist/tariff.js";
import {
  CURRENT_STATE_VERSION,
  isDefaultSimulation,
  loadSimulationState,
  saveSimulationState,
  STATE_STORAGE_KEY,
} from "../.test-dist/storage.js";
import {
  addProfile,
  buildExportEnvelope,
  createSavedProfile,
  getActiveProfile,
  loadProfilesStore,
  migrateFromLegacyState,
  parseProfileJson,
  PROFILES_STORAGE_KEY,
  PROFILES_STORE_VERSION,
  removeProfile,
  renameProfile,
  saveProfilesStore,
  setActiveProfile,
  upsertProfile,
} from "../.test-dist/profiles.js";

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
  knownHeatingKwh: 0,
  residents: 2,
  backgroundHcShare: 25,
  appliances,
  heating: {
    enabled: false,
    surfaceM2: 80,
    system: "radiators",
    dwellingType: "apartment",
    insulation: "standard",
    altitude: "low",
    occupancy: "away",
  },
  offPeakWindows: [{ id: 1, start: "21:40", end: "05:40" }],
  activeOffPeakWindowId: 1,
};

const defaultStateInput = { ...defaultState };
delete defaultStateInput.version;

const closeTo = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} devrait être proche de ${expected}`);
};

test("calcule séparément les coûts Base et HP/HC", () => {
  closeTo(calculateBaseCost(4500, tariff), 1000.86);
  closeTo(calculateHphcCost(2570, 1930, tariff), 961.509);
});

test("reproduit le scénario central de l'interface", () => {
  const result = calculateSimulation({ annualKwh: 4500, backgroundHcShare: 25, tariff, appliances });

  closeTo(result.declaredApplianceKwh, 1513);
  closeTo(result.backgroundKwh, 2987);
  closeTo(result.scheduledHc, 1513);
  closeTo(result.hcKwh, 2259.75);
  closeTo(result.hpKwh, 2240.25);
  closeTo(result.baseCost, 1000.86);
  closeTo(result.hphcCost, 944.790675);
  closeTo(result.baseSubscriptionCost, 175.56);
  closeTo(result.baseEnergyCost, 825.3);
  closeTo(result.hphcSubscriptionCost, 175.56);
  closeTo(result.hpEnergyCost, 439.9851);
  closeTo(result.hcEnergyCost, 329.245575);
  closeTo(result.delta, 56.069325);
  assert.equal(result.breakEven.status, "above");
  closeTo(result.breakEven.share, 25.64102564102564);
  assert.deepEqual(result.warnings, []);
});

test("estime séparément le chauffage selon la surface, le système et l'occupation", () => {
  const window = { id: 1, start: "21:40", end: "05:40" };
  const standard = { ...defaultState.heating, enabled: true, occupancy: "mixed" };
  const radiators = estimateHeating(standard, window);
  const heatPump = estimateHeating({ ...standard, system: "heat-pump" }, window);
  const away = estimateHeating({ ...standard, occupancy: "away" }, window);
  const home = estimateHeating({ ...standard, occupancy: "home" }, window);

  closeTo(radiators.annualKwh / heatPump.annualKwh, 3.6);
  assert.ok(radiators.lowKwh < radiators.annualKwh && radiators.highKwh > radiators.annualKwh);
  assert.ok(away.annualKwh < home.annualKwh);
  assert.ok(away.hcShare > home.hcShare);
  assert.ok(radiators.hcShare > 0 && radiators.hcShare < 100);
});

test("ne place en HC que le chauffage ayant naturellement lieu dans la plage", () => {
  const window = { id: 1, start: "21:40", end: "05:40" };
  const base = { ...defaultState.heating, enabled: true, surfaceM2: 80, system: "radiators", dwellingType: "apartment", insulation: "standard", altitude: "low" };
  const away = estimateHeating({ ...base, occupancy: "away" }, window);
  const mixed = estimateHeating({ ...base, occupancy: "mixed" }, window);
  const home = estimateHeating({ ...base, occupancy: "home" }, window);

  closeTo(away.hcShare, 41.1748, 0.01);
  closeTo(mixed.hcShare, 39.5068, 0.01);
  closeTo(home.hcShare, 37.2437, 0.01);
  assert.ok(away.hcShare > mixed.hcShare && mixed.hcShare > home.hcShare);
  // La correction porte sur la répartition, pas sur l'ampleur déjà calibrée.
  closeTo(away.annualKwh, 3776.55, 0.01);
  closeTo(home.annualKwh, 4175.17, 0.01);
  // Un réduit d'absence plus profond que le réduit de nuit écarte les profils.
  assert.ok(home.annualKwh / away.annualKwh > 1.1);

  // Les nuits sont les heures les plus froides : leur besoin pèse davantage que
  // leur seule durée dans la journée, sans quoi le modèle défavorise les HC.
  const mechanicalShare = 8 / 24 * 100;
  for (const estimate of [away, mixed, home]) assert.ok(estimate.hcShare > mechanicalShare);

  // Plus il fait froid, moins l'écart jour/nuit pèse dans le besoin total.
  const cold = estimateHeating({ ...base, occupancy: "away", altitude: "high" }, window);
  assert.ok(cold.hcShare < away.hcShare && cold.hcShare > mechanicalShare);
});

test("respecte la causalité des paramètres de chauffage en projection", () => {
  const window = { id: 1, start: "22:10", end: "06:10" };
  const simulate = (heatingPatch) => {
    const settings = { ...defaultState.heating, enabled: true, surfaceM2: 80, system: "radiators", ...heatingPatch };
    return calculateSimulation({
      annualKwh: 0,
      energyMode: "projected",
      projectedBackgroundKwh: 2600,
      backgroundHcShare: 20,
      tariff,
      appliances,
      heating: estimateHeating(settings, window),
    });
  };
  const good = simulate({ insulation: "good" });
  const standard = simulate({ insulation: "standard" });
  const poor = simulate({ insulation: "poor" });
  assert.ok(good.totalKwh < standard.totalKwh && standard.totalKwh < poor.totalKwh);
  assert.ok(good.baseCost < standard.baseCost && standard.baseCost < poor.baseCost);
  assert.ok(good.hphcCost < standard.hphcCost && standard.hphcCost < poor.hphcCost);

  const heatPump = simulate({ system: "heat-pump" });
  const radiators = simulate({ system: "radiators" });
  assert.ok(heatPump.totalKwh < radiators.totalKwh);
  assert.ok(heatPump.baseCost < radiators.baseCost);
  assert.ok(heatPump.hphcCost < radiators.hphcCost);

  const small = simulate({ surfaceM2: 40 });
  const large = simulate({ surfaceM2: 120 });
  assert.ok(small.totalKwh < large.totalKwh);
  assert.ok(small.hphcCost < large.hphcCost);
  closeTo(good.applianceKwh, poor.applianceKwh);
});

test("les choix de travaux ne changent pas une facture connue", () => {
  const window = { id: 1, start: "22:10", end: "06:10" };
  const simulate = (patch) => {
    const estimate = estimateHeating({ ...defaultState.heating, enabled: true, ...patch }, window);
    return calculateSimulation({
      annualKwh: 4500,
      energyMode: "known-total",
      backgroundHcShare: 25,
      tariff,
      appliances,
      heating: { annualKwh: 1000, lowKwh: 1000, highKwh: 1000, hcShare: estimate.hcShare },
    });
  };
  const good = simulate({ insulation: "good", system: "heat-pump" });
  const poor = simulate({ insulation: "poor", system: "radiators" });
  closeTo(good.totalKwh, poor.totalKwh);
  closeTo(good.baseCost, poor.baseCost);
  closeTo(good.hphcCost, poor.hphcCost);
  closeTo(good.heatingKwh, 1000);
});

test("conserve un bilan énergétique fini sur toute la grille de chauffage", () => {
  const window = { id: 1, start: "21:40", end: "05:40" };
  for (const system of ["radiators", "heat-pump"])
    for (const dwellingType of ["house", "apartment"])
      for (const insulation of ["good", "standard", "poor"])
        for (const altitude of ["low", "medium", "high"])
          for (const occupancy of ["away", "mixed", "home"]) {
            const heating = estimateHeating({ ...defaultState.heating, enabled: true, system, dwellingType, insulation, altitude, occupancy }, window);
            const result = calculateSimulation({ annualKwh: 0, energyMode: "projected", projectedBackgroundKwh: 2500, backgroundHcShare: 25, tariff, appliances, heating });
            closeTo(result.hpKwh + result.hcKwh, result.totalKwh, 1e-6);
            assert.ok([result.totalKwh, result.hpKwh, result.hcKwh, result.baseCost, result.hphcCost].every(Number.isFinite));
            assert.ok(result.hpKwh >= 0 && result.hcKwh >= 0);
          }
});

test("retire le chauffage du reste du foyer et conserve le bilan énergétique", () => {
  const result = calculateSimulation({
    annualKwh: 4500,
    energyMode: "projected",
    projectedBackgroundKwh: 3500,
    backgroundHcShare: 25,
    tariff,
    appliances: [],
    heating: { annualKwh: 1000, lowKwh: 650, highKwh: 1450, hcShare: 33.33333333333333 },
  });

  closeTo(result.heatingKwh, 1000);
  closeTo(result.backgroundKwh, 3500);
  closeTo(result.heatingHcKwh, 1000 / 3);
  closeTo(result.hpKwh + result.hcKwh, 4500);
});

test("préserve les usages même s'ils dépassent le total connu", () => {
  const oversized = [
    { ...appliances[0], id: 10, name: "Usage A", annualKwh: 3000, lowKwh: 2500, highKwh: 3500 },
    { ...appliances[1], id: 11, name: "Usage B", annualKwh: 2000, lowKwh: 1500, highKwh: 2500 },
  ];
  const result = calculateSimulation({ annualKwh: 4000, backgroundHcShare: 25, tariff, appliances: oversized });

  closeTo(result.applianceKwh, 5000);
  closeTo(result.totalKwh, 5000);
  closeTo(result.backgroundKwh, 0);
  closeTo(result.hpKwh + result.hcKwh, 5000);
  assert.ok(result.hpKwh >= 0 && result.hcKwh >= 0);
  assert.equal(result.warnings[0].code, "APPLIANCES_EXCEED_TOTAL");
});

test("ne redimensionne jamais un appareil à cause du chauffage ou du total", () => {
  const withoutHeating = calculateSimulation({ annualKwh: 4500, backgroundHcShare: 25, tariff, appliances });
  const withHeating = calculateSimulation({
    annualKwh: 4500,
    backgroundHcShare: 25,
    tariff,
    appliances,
    heating: { annualKwh: 9000, lowKwh: 7000, highKwh: 11000, hcShare: 30 },
  });
  closeTo(withoutHeating.applianceKwh, withHeating.applianceKwh);
  closeTo(withHeating.heatingKwh, 4500 - withHeating.applianceKwh);
  closeTo(withHeating.totalKwh, 4500);
  assert.equal(withHeating.warnings[0].code, "HEATING_CAPPED");
});

test("les habitants ne redimensionnent que l'ECS et les appareils de cycle", () => {
  const pool = { ...APPLIANCE_PRESETS.find((preset) => preset.type === "pool-pump"), id: 20 };
  const vehicle = { ...APPLIANCE_PRESETS.find((preset) => preset.type === "electric-vehicle"), id: 21 };
  const cooling = { ...APPLIANCE_PRESETS.find((preset) => preset.type === "air-conditioning"), id: 22 };
  const measuredWaterHeater = { ...appliances[0], id: 23, calculationMode: "measured", annualKwh: 1000, lowKwh: 1000, highKwh: 1000 };
  const source = [...appliances, pool, vehicle, cooling, measuredWaterHeater];
  const scaled = scaleAppliancesForResidents(source, 2, 4);

  for (const type of ["water-heater", "washing-machine", "dishwasher"]) {
    const before = source.find((appliance) => appliance.type === type);
    const after = scaled.find((appliance) => appliance.id === before.id);
    closeTo(after.annualKwh, before.annualKwh * 2 ** residentExponent(type));
    assert.ok(after.annualKwh < before.annualKwh * 2, "la croissance doit rester sous-linéaire");
    closeTo(after.lowKwh / before.lowKwh, after.annualKwh / before.annualKwh);
    closeTo(after.highKwh / before.highKwh, after.annualKwh / before.annualKwh);
  }
  for (const id of [pool.id, vehicle.id, cooling.id, measuredWaterHeater.id]) {
    closeTo(scaled.find((appliance) => appliance.id === id).annualKwh, source.find((appliance) => appliance.id === id).annualKwh);
  }
  const restored = scaleAppliancesForResidents(scaled, 4, 2);
  source.forEach((appliance, index) => closeTo(restored[index].annualKwh, appliance.annualKwh));
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
  const breakEven = calculateBreakEvenShare(4500, tariff);
  assert.equal(breakEven.status, "above");
  const result = calculateSimulation({ annualKwh: 4500, backgroundHcShare: breakEven.share, tariff, appliances: [] });
  closeTo(result.baseCost, result.hphcCost, 1e-9);
});

test("décrit correctement les grilles sans point d'équilibre atteignable", () => {
  const always = calculateBreakEvenShare(1000, {
    ...tariff,
    baseSubscription: 200,
    hphcSubscription: 100,
    basePrice: 0.30,
    hpPrice: 0.10,
    hcPrice: 0.10,
  });
  const never = calculateBreakEvenShare(1000, {
    ...tariff,
    baseSubscription: 100,
    hphcSubscription: 500,
    basePrice: 0.20,
    hpPrice: 0.25,
    hcPrice: 0.15,
  });
  const below = calculateBreakEvenShare(1000, {
    ...tariff,
    baseSubscription: 100,
    hphcSubscription: 100,
    basePrice: 0.20,
    hpPrice: 0.15,
    hcPrice: 0.25,
  });

  assert.deepEqual(always, { status: "always", share: null });
  assert.deepEqual(never, { status: "never", share: null });
  assert.equal(below.status, "below");
  closeTo(below.share, 50);
});

test("répercute les fourchettes sur la consommation et les coûts projetés", () => {
  const result = calculateSimulation({
    annualKwh: 4500,
    energyMode: "projected",
    projectedBackgroundKwh: 3000,
    backgroundHcShare: 25,
    tariff,
    appliances: [{ ...appliances[0], annualKwh: 1000, lowKwh: 200, highKwh: 2000 }],
  });

  assert.ok(result.lowEstimate.hcKwh < result.hcKwh);
  assert.ok(result.highEstimate.hcKwh > result.hcKwh);
  assert.ok(result.lowEstimate.totalKwh < result.totalKwh);
  assert.ok(result.highEstimate.totalKwh > result.totalKwh);
  assert.ok(result.lowEstimate.baseCost < result.baseCost);
  assert.ok(result.highEstimate.baseCost > result.baseCost);
  assert.ok(result.lowEstimate.hphcCost < result.hphcCost);
  assert.ok(result.highEstimate.hphcCost > result.hphcCost);
});

test("maintient des plages HC de huit heures et neutralise les plages invalides", () => {
  const window = { id: 1, start: "21:40", end: "05:40" };
  const movedStart = updateOffPeakWindowTime(window, "start", "23:15");
  const movedEnd = updateOffPeakWindowTime(window, "end", "04:30");

  assert.deepEqual(movedStart, { id: 1, start: "23:15", end: "07:15" });
  assert.deepEqual(movedEnd, { id: 1, start: "20:30", end: "04:30" });
  assert.equal(offPeakDurationMinutes(movedStart), 480);
  assert.equal(offPeakDurationMinutes(movedEnd), 480);
  assert.equal(isValidOffPeakWindow({ id: 2, start: "22:00", end: "22:00" }), false);
  assert.equal(estimateHeating({ ...defaultState.heating, enabled: true }, { id: 2, start: "22:00", end: "22:00" }).hcShare, 0);
});

test("répartit la climatisation estivale selon la présence diurne", () => {
  const window = { id: 1, start: "21:40", end: "05:40" };
  const away = estimateCoolingHcShare("away", window);
  const mixed = estimateCoolingHcShare("mixed", window);
  const home = estimateCoolingHcShare("home", window);
  const awayProfile = estimateCoolingProfile("away", window);
  const mixedProfile = estimateCoolingProfile("mixed", window);
  const homeProfile = estimateCoolingProfile("home", window);

  closeTo(away, 5.1852, 0.001);
  closeTo(mixed, 4.2424, 0.001);
  closeTo(home, 3.3333, 0.001);
  assert.ok(away > mixed && mixed > home);
  assert.ok(awayProfile.demandFactor < mixedProfile.demandFactor && mixedProfile.demandFactor < homeProfile.demandFactor);
  assert.equal(estimateCoolingHcShare("home", { id: 2, start: "23:45", end: "07:45" }), 0);

  const cooling = { ...APPLIANCE_PRESETS.find((preset) => preset.type === "air-conditioning"), id: 99, hcShare: away };
  const result = calculateSimulation({ annualKwh: 1000, backgroundHcShare: 0, tariff, appliances: [cooling] });
  closeTo(result.scheduledHc, cooling.annualKwh * away / 100);
  assert.ok(result.scheduledHc < cooling.annualKwh, "la climatisation ne doit plus être placée à 100 % en HC");
});

test("la présence augmente bien la consommation estivale projetée", () => {
  const window = { id: 1, start: "22:10", end: "06:10" };
  const preset = APPLIANCE_PRESETS.find((candidate) => candidate.type === "air-conditioning");
  const simulate = (occupancy) => {
    const profile = estimateCoolingProfile(occupancy, window);
    const cooling = {
      ...preset,
      id: 99,
      annualKwh: preset.annualKwh * profile.demandFactor,
      lowKwh: preset.lowKwh * profile.demandFactor,
      highKwh: preset.highKwh * profile.demandFactor,
      hcShare: profile.hcShare,
    };
    return calculateSimulation({ annualKwh: 0, energyMode: "projected", projectedBackgroundKwh: 2500, backgroundHcShare: 20, tariff, appliances: [cooling] });
  };
  const away = simulate("away");
  const mixed = simulate("mixed");
  const home = simulate("home");
  assert.ok(away.totalKwh < mixed.totalKwh && mixed.totalKwh < home.totalKwh);
  assert.ok(away.baseCost < mixed.baseCost && mixed.baseCost < home.baseCost);
  assert.ok(away.hphcCost < mixed.hphcCost && mixed.hphcCost < home.hphcCost);
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

test("préserve la valeur proportionnelle explicite d'un ancien appareil", () => {
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
  closeTo(migrated.appliances[0].annualKwh, 1200 * 7200 / 4500);
  assert.equal(migrated.residents, 2);

  const afterHouseholdChange = calculateSimulation({ annualKwh: 10000, backgroundHcShare: 25, tariff, appliances: migrated.appliances });
  closeTo(afterHouseholdChange.declaredApplianceKwh, 1200 * 7200 / 4500);
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
  const preset = APPLIANCE_PRESETS.find((candidate) => candidate.type === "water-heater");
  closeTo(migrated.appliances[0].annualKwh, preset.annualKwh);
  assert.equal(migrated.energyMode, undefined, "le mode d'énergie n'est plus un champ persisté");
  assert.equal(migrated.projectedBackgroundKwh, undefined);
  assert.equal(migrated.appliances[0].calculationMode, "reference");
  assert.deepEqual(migrated.offPeakWindows, defaultState.offPeakWindows);
  assert.equal(migrated.activeOffPeakWindowId, 1);
});

test("active une seule fois la dépendance aux habitants pour un état 0.9", () => {
  const previous = { ...defaultState, version: 8, residents: 1 };
  const migrated = loadSimulationState({ getItem: () => JSON.stringify(previous) }, defaultState, APPLIANCE_PRESETS);
  closeTo(migrated.appliances[0].annualKwh, appliances[0].annualKwh * 0.5 ** residentExponent(appliances[0].type));
  closeTo(migrated.appliances[1].annualKwh, appliances[1].annualKwh * 0.5 ** residentExponent(appliances[1].type));
  const reloaded = loadSimulationState({ getItem: () => JSON.stringify(migrated) }, defaultState, APPLIANCE_PRESETS);
  closeTo(reloaded.appliances[0].annualKwh, migrated.appliances[0].annualKwh);
});

test("revient aux valeurs par défaut lorsque la sauvegarde est corrompue", () => {
  const state = loadSimulationState({ getItem: () => "{invalide" }, defaultState, APPLIANCE_PRESETS);
  assert.deepEqual(state, defaultState);
  assert.notEqual(state.appliances, defaultState.appliances);
  assert.notEqual(state.appliances[0].source, defaultState.appliances[0].source);
});

test("embarque une calibration ElecDom documentée et contrôlée", () => {
  const waterHeater = getApplianceCalibration("water-heater");
  const washingMachine = getApplianceCalibration("washing-machine");
  const pool = getApplianceCalibration("pool-pump");

  assert.equal(ELECDOM_DATA_QUALITY.rows, 2263);
  assert.equal(ELECDOM_DATA_QUALITY.duplicateGeneralObservations, 0);
  assert.equal(waterHeater.sampleSize, 55);
  assert.equal(waterHeater.confidence, "good");
  assert.equal(washingMachine.referenceAnnualKwh, 85);
  assert.equal(pool.confidence, "insufficient");
  assert.equal(pool.excludedObservations, 1);
});

test("migre l'ancienne sauvegarde vers un profil nommé", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  saveSimulationState(storage, defaultState);
  assert.ok(values.has(STATE_STORAGE_KEY));

  const store = migrateFromLegacyState(storage, defaultState, APPLIANCE_PRESETS);
  assert.equal(store.profiles.length, 1);
  assert.equal(store.profiles[0].name, "Ma simulation");
  assert.equal(store.activeProfileId, store.profiles[0].id);
  assert.equal(store.profiles[0].state.annualKwh, defaultState.annualKwh);
  assert.equal(store.profiles[0].state.power, defaultState.power);
  assert.ok(!values.has(STATE_STORAGE_KEY));
});

test("crée un profil persistant au premier lancement", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const store = migrateFromLegacyState(storage, defaultState, APPLIANCE_PRESETS);
  assert.equal(store.profiles.length, 1);
  assert.equal(store.profiles[0].name, "Ma simulation");
  assert.equal(store.activeProfileId, store.profiles[0].id);
  assert.equal(loadProfilesStore(storage).profiles.length, 1);
});

test("met à niveau le magasin de profils sans recréer le profil existant", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  saveSimulationState(storage, defaultState);
  const existing = createSavedProfile("Déjà là", { ...defaultState, annualKwh: 9999 });
  const preStore = { version: 1, profiles: [existing], activeProfileId: existing.id };
  saveProfilesStore(storage, preStore);

  const store = migrateFromLegacyState(storage, defaultState, APPLIANCE_PRESETS);
  assert.equal(store.version, PROFILES_STORE_VERSION);
  assert.equal(store.profiles.length, 1);
  assert.equal(store.profiles[0].name, "Déjà là");
  assert.equal(store.profiles[0].state.annualKwh, 9999);
});

test("ajoute, renomme et supprime des profils", () => {
  const stateInput = defaultStateInput;
  const empty = { version: PROFILES_STORE_VERSION, profiles: [], activeProfileId: null };

  const { store: withFirst, profile: first } = addProfile(empty, "Profil A", stateInput);
  assert.equal(withFirst.profiles.length, 1);
  assert.equal(withFirst.activeProfileId, first.id);

  const { store: withTwo, profile: second } = addProfile(withFirst, "Profil B", { ...stateInput, annualKwh: 8000 });
  assert.equal(withTwo.profiles.length, 2);
  assert.equal(withTwo.activeProfileId, second.id);

  const renamed = renameProfile(withTwo, first.id, "Profil A renommé");
  assert.equal(renamed.profiles.find((p) => p.id === first.id).name, "Profil A renommé");

  const afterDelete = removeProfile(renamed, second.id);
  assert.equal(afterDelete.profiles.length, 1);
  assert.equal(afterDelete.activeProfileId, first.id);
});

test("bascule le profil actif et met à jour l'état", () => {
  const stateInput = defaultStateInput;
  const empty = { version: PROFILES_STORE_VERSION, profiles: [], activeProfileId: null };
  const { store: withTwo, profile: second } = addProfile(
    addProfile(empty, "A", stateInput).store,
    "B",
    { ...stateInput, annualKwh: 7000 },
  );

  const switched = setActiveProfile(withTwo, second.id);
  assert.equal(switched.activeProfileId, second.id);
  const active = getActiveProfile(switched);
  assert.equal(active.state.annualKwh, 7000);
});

test("exporte et réimporte un profil sans perte", () => {
  const stateInput = defaultStateInput;
  const profile = createSavedProfile("Test export", stateInput);
  const envelope = buildExportEnvelope(profile, "0.7.0");
  const json = JSON.stringify(envelope);

  const imported = parseProfileJson(json);
  assert.equal(imported.name, "Test export");
  assert.equal(imported.state.annualKwh, defaultState.annualKwh);
  assert.equal(imported.state.power, defaultState.power);
  assert.notEqual(imported.id, profile.id);
  assert.equal(imported.importedAppVersion, "0.7.0");
});

test("rejette un fichier JSON invalide à l'import", () => {
  assert.throws(() => parseProfileJson("{}"), /Format de profil invalide/);
  assert.throws(() => parseProfileJson('{"profile":{"name":"x"}}'), /Format de profil invalide/);
  assert.throws(() => parseProfileJson("not json"));
});

test("met à jour l'état d'un profil existant via upsert", () => {
  const stateInput = defaultStateInput;
  const { store, profile } = addProfile({ version: PROFILES_STORE_VERSION, profiles: [], activeProfileId: null }, "Up", stateInput);
  const updated = upsertProfile(store, profile.id, { ...stateInput, annualKwh: 12345 });
  assert.equal(updated.profiles[0].state.annualKwh, 12345);
  assert.equal(updated.profiles[0].name, profile.name);
});

test("sauvegarde et recharge un store de profils", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: () => {},
  };
  const stateInput = defaultStateInput;
  const { store } = addProfile({ version: PROFILES_STORE_VERSION, profiles: [], activeProfileId: null }, "Persist", stateInput);
  saveProfilesStore(storage, store);

  const reloaded = loadProfilesStore(storage);
  assert.equal(reloaded.profiles.length, 1);
  assert.equal(reloaded.profiles[0].name, "Persist");
  assert.equal(reloaded.activeProfileId, reloaded.profiles[0].id);
});

test("remplace la mise à l'échelle linéaire des états 9 et 10 par l'exposant", () => {
  const residents = 5;
  const ratio = residents / 2;
  // Un état 0.11 stockait les usages redimensionnés proportionnellement.
  const linear = appliances.map((appliance) => ({
    ...appliance,
    annualKwh: appliance.annualKwh * ratio,
    lowKwh: appliance.lowKwh * ratio,
    highKwh: appliance.highKwh * ratio,
  }));
  const previous = { ...defaultState, version: 10, residents, appliances: linear };
  const migrated = loadSimulationState({ getItem: () => JSON.stringify(previous) }, defaultState, APPLIANCE_PRESETS);

  migrated.appliances.forEach((appliance, index) => {
    closeTo(appliance.annualKwh, appliances[index].annualKwh * ratio ** residentExponent(appliance.type));
    assert.ok(appliance.annualKwh < linear[index].annualKwh, "la correction doit réduire les grands foyers");
  });
  // La migration ne doit jouer qu'une fois.
  const reloaded = loadSimulationState({ getItem: () => JSON.stringify(migrated) }, defaultState, APPLIANCE_PRESETS);
  migrated.appliances.forEach((appliance, index) => closeTo(reloaded.appliances[index].annualKwh, appliance.annualKwh));
});

test("laisse intactes les valeurs mesurées et les usages indépendants du foyer", () => {
  const measured = { ...appliances[0], id: 40, calculationMode: "measured", annualKwh: 1000, lowKwh: 1000, highKwh: 1000 };
  const pool = { ...APPLIANCE_PRESETS.find((preset) => preset.type === "pool-pump"), id: 41 };
  const rescaled = rescaleAppliancesToResidentExponent([measured, pool], 6);

  closeTo(rescaled[0].annualKwh, measured.annualKwh);
  closeTo(rescaled[1].annualKwh, pool.annualKwh);
  closeTo(rescaleAppliancesToResidentExponent(appliances, 2)[0].annualKwh, appliances[0].annualKwh);
});

test("signale l'extinction de l'option Base au-delà de 6 kVA", () => {
  assert.deepEqual(baseOptionAvailability(3), { status: "available" });
  assert.deepEqual(baseOptionAvailability(6), { status: "available" });
  assert.equal(baseOptionAvailability(9).status, "closed");
  assert.equal(baseOptionAvailability(15).status, "closed");
  assert.equal(baseOptionAvailability(18).status, "removed");
  assert.equal(baseOptionAvailability(36).status, "removed");
  // Une grille importée hors du Tarif Bleu résidentiel ne doit rien affirmer.
  assert.deepEqual(baseOptionAvailability(45), { status: "available" });
  assert.deepEqual(baseOptionAvailability(Number.NaN), { status: "available" });

  assert.equal(baseOptionNotice(6), null);
  assert.match(baseOptionNotice(9), /9 kVA/);
  assert.match(baseOptionNotice(9), /1er février 2026/);
  assert.match(baseOptionNotice(24), /1er février 2027/);
});

test("encadre l'écart par les scénarios bas et haut", () => {
  const result = calculateSimulation({ annualKwh: 4500, backgroundHcShare: 25, tariff, appliances });
  const summary = summarizeDelta(result);

  assert.equal(summary.status, "positive");
  closeTo(summary.delta, result.delta);
  // Le scénario central reste toujours à l'intérieur de la fourchette affichée.
  assert.ok(summary.low <= summary.delta && summary.delta <= summary.high);
  assert.ok(summary.low > 0, "les trois scénarios doivent rester favorables aux HC");
  closeTo(summary.spread, summary.high - summary.low);
  assert.ok(summary.spread > 40, "l'incertitude des usages doit être visible");
});

test("ne tranche pas quand la fourchette traverse zéro", () => {
  const straddling = {
    delta: 12,
    lowEstimate: { delta: -30 },
    highEstimate: { delta: 55 },
  };
  assert.equal(summarizeDelta(straddling).status, "uncertain");
  assert.equal(summarizeDelta({ delta: 40, lowEstimate: { delta: 5 }, highEstimate: { delta: 90 } }).status, "positive");
  assert.equal(summarizeDelta({ delta: -40, lowEstimate: { delta: -90 }, highEstimate: { delta: -5 } }).status, "negative");

  // Sans usage listé ni chauffage la fourchette est vide : en dessous d'un euro
  // par an, aucun verdict n'est prononcé.
  const flat = calculateSimulation({ annualKwh: 4500, backgroundHcShare: 25.64, tariff, appliances: [] });
  const summary = summarizeDelta(flat);
  closeTo(summary.spread, 0);
  assert.equal(summary.status, "uncertain");
  assert.equal(summarizeDelta({ delta: -0.4, lowEstimate: { delta: -0.4 }, highEstimate: { delta: -0.4 } }).status, "uncertain");
});

test("le chauffage retenu contribue enfin à la fourchette de facture", () => {
  const window = { id: 1, start: "21:40", end: "05:40" };
  const estimate = estimateHeating({ ...defaultState.heating, enabled: true, surfaceM2: 100 }, window);
  const retained = 5000;
  // L'interface applique la marge relative du poste à la quantité retenue.
  const heating = {
    ...estimate,
    annualKwh: retained,
    lowKwh: retained * HEATING_LOW_RATIO,
    highKwh: retained * HEATING_HIGH_RATIO,
  };
  const simulate = (heatingInput) => calculateSimulation({
    annualKwh: 11000, backgroundHcShare: 25, tariff, appliances, heating: heatingInput,
  });
  const withRange = summarizeDelta(simulate(heating));
  const withoutRange = summarizeDelta(simulate({ ...heating, lowKwh: retained, highKwh: retained }));

  assert.ok(withRange.spread > withoutRange.spread, "le poste le plus incertain doit élargir la fourchette");
  closeTo(withRange.delta, withoutRange.delta, 1e-9);
  closeTo(estimate.lowKwh / estimate.annualKwh, HEATING_LOW_RATIO);
  closeTo(estimate.highKwh / estimate.annualKwh, HEATING_HIGH_RATIO);
});

test("signale une grille de référence dépassée par une révision tarifaire", () => {
  const at = (iso) => tariffGridFreshness(new Date(`${iso}T12:00:00`));
  // Les tarifs réglementés sont révisés au 1er février et au 1er août.
  assert.deepEqual(at("2026-08-22"), { status: "current", months: 0 });
  assert.deepEqual(at("2027-01-15"), { status: "current", months: 5 });
  assert.equal(at("2027-03-01").status, "stale");
  assert.equal(at("2027-03-01").months, 7);

  assert.equal(tariffGridNotice(new Date("2026-12-01T12:00:00")), null);
  assert.match(tariffGridNotice(new Date("2027-03-01T12:00:00")), /1er août 2026/);
  assert.match(tariffGridNotice(new Date("2027-03-01T12:00:00")), /7 mois/);
});

test("dimensionne la climatisation sur le logement comme le chauffage", () => {
  const window = { id: 1, start: "21:40", end: "05:40" };
  closeTo(coolingDwellingFactor({ surfaceM2: 80, insulation: "standard" }), 1);
  // La référence du profil mixte doit rester neutre, la calibration du
  // préréglage étant exprimée pour ce logement.
  closeTo(estimateCoolingProfile("mixed", window).demandFactor, 1);

  const small = coolingDwellingFactor({ surfaceM2: 40, insulation: "standard" });
  const large = coolingDwellingFactor({ surfaceM2: 160, insulation: "standard" });
  assert.ok(small < 1 && large > 1);
  // Sous-linéaire : la climatisation n'équipe qu'une partie des pièces.
  assert.ok(large < 2);

  const good = coolingDwellingFactor({ surfaceM2: 100, insulation: "good" });
  const poor = coolingDwellingFactor({ surfaceM2: 100, insulation: "poor" });
  assert.ok(good < poor);
  // La présence et le logement se combinent sans se remplacer.
  const dwelling = { surfaceM2: 160, insulation: "poor" };
  closeTo(
    estimateCoolingProfile("home", window, dwelling).demandFactor,
    estimateCoolingProfile("home", window).demandFactor * coolingDwellingFactor(dwelling),
  );
  closeTo(estimateCoolingProfile("home", window, dwelling).hcShare, estimateCoolingProfile("home", window).hcShare);
});

test("distingue le résultat d'exemple d'une simulation renseignée", () => {
  const example = { ...defaultStateInput };
  assert.equal(isDefaultSimulation(example, defaultState), true);
  assert.equal(isDefaultSimulation({ ...example, annualKwh: 5200 }, defaultState), false);
  assert.equal(isDefaultSimulation({ ...example, residents: 4 }, defaultState), false);
  assert.equal(isDefaultSimulation({ ...example, heating: { ...example.heating, enabled: true } }, defaultState), false);
  assert.equal(isDefaultSimulation({ ...example, appliances: example.appliances.slice(1) }, defaultState), false);
  // La plage tarifaire retenue ne rend pas la simulation personnelle.
  assert.equal(isDefaultSimulation({ ...example, activeOffPeakWindowId: 4 }, defaultState), true);
});

test("n'attribue pas à ElecDom une valeur de repli interne", () => {
  const pool = APPLIANCE_PRESETS.find((preset) => preset.type === "pool-pump");
  const vehicle = APPLIANCE_PRESETS.find((preset) => preset.type === "electric-vehicle");
  const waterHeater = APPLIANCE_PRESETS.find((preset) => preset.type === "water-heater");

  for (const preset of [pool, vehicle]) {
    assert.equal(preset.source.kind, "internal");
    assert.equal(preset.source.organization, "Déclic HC");
    assert.equal(preset.source.year, undefined, "une valeur interne ne porte pas l'année d'ElecDom");
    assert.equal(preset.source.url, undefined, "ni son lien");
  }
  // L'échantillon insuffisant est nommé comme la raison du repli.
  assert.match(pool.source.label, /11 logements/);
  assert.match(pool.source.label, /220 kWh\/an/);
  assert.match(vehicle.source.label, /aucune observation/i);

  assert.equal(waterHeater.source.year, 2022);
  assert.ok(waterHeater.source.url);
  assert.match(waterHeater.source.organization, /ElecDom/);
});

test("migre les profils depuis la version d'état que le magasin a réellement écrite", () => {
  const residents = 5;
  const ratio = residents / 2;
  const linear = appliances.map((appliance) => ({
    ...appliance,
    annualKwh: appliance.annualKwh * ratio,
    lowKwh: appliance.lowKwh * ratio,
    highKwh: appliance.highKwh * ratio,
  }));
  const profile = createSavedProfile("Ancien", { ...defaultStateInput, residents, appliances: linear });
  // Un magasin de version 5 n'enregistrait pas la version d'état : elle est
  // déduite de la table, et vaut 10.
  const stored = { version: 5, profiles: [profile], activeProfileId: profile.id };
  const loaded = loadProfilesStore({ getItem: () => JSON.stringify(stored) });
  assert.equal(loaded.stateVersion, 10);

  const saved = {};
  const store = migrateFromLegacyState(
    { getItem: () => JSON.stringify(stored), setItem: (key, value) => { saved[key] = value; }, removeItem: () => {} },
    defaultState,
    APPLIANCE_PRESETS,
  );
  assert.equal(store.version, PROFILES_STORE_VERSION);
  assert.equal(store.stateVersion, CURRENT_STATE_VERSION);
  store.profiles[0].state.appliances.forEach((appliance, index) => {
    closeTo(appliance.annualKwh, appliances[index].annualKwh * ratio ** residentExponent(appliance.type));
  });
  // La version d'état écrite est relue telle quelle, sans repli sur la table.
  assert.equal(loadProfilesStore({ getItem: () => saved[PROFILES_STORAGE_KEY] }).stateVersion, CURRENT_STATE_VERSION);
});

test("utilise le même numéro de version dans la PWA, le cache et le paquet", async () => {
  const [versionSource, pageSource, cssSource, manifestSource, serviceWorkerSource, packageSource, lockSource] = await Promise.all([
    readFile(new URL("../app/version.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
  ]);
  const version = versionSource.match(/APP_VERSION = "([^"]+)"/)?.[1];

  assert.equal(version, "0.14.0");
  assert.match(pageSource, /function ThumbOnlyRange/);
  assert.match(pageSource, /Math\.abs\(event\.clientX - center\) > hitRadius/);
  assert.match(pageSource, /event\.preventDefault\(\)/);
  assert.match(pageSource, /suppressNativeInput\.current/);
  assert.match(pageSource, /setPointerCapture\(event\.pointerId\)/);
  assert.match(pageSource, /TOUJOURS PROGRAMMÉ EN HC/);
  assert.doesNotMatch(pageSource, /schedule scheduled[^>]*>.*<i aria-hidden="true"/);
  assert.match(pageSource, /<strong>Ajuster le modèle<\/strong>/);
  assert.match(pageSource, /FACTURE EDF ANNUELLE ESTIMÉE · TTC/);
  assert.match(pageSource, /results\.baseSubscriptionCost/);
  assert.match(pageSource, /results\.hcEnergyCost/);
  assert.doesNotMatch(pageSource, /<label>Consommation annuelle<div className="input-wrap">/);
  assert.match(pageSource, /aria-label="Nombre d’habitants"/);
  assert.match(pageSource, /Consommation annuelle connue/);
  assert.doesNotMatch(pageSource, /Projection énergétique/);
  assert.match(pageSource, /Consommation annuelle de chauffage dans la facture/);
  assert.match(cssSource, /grid-template-columns: minmax\(0, 1fr\) repeat\(5, 40px\)/);
  assert.match(cssSource, /\.icon-sm \{ width: 40px; height: 40px;/);
  assert.match(pageSource, /aria-label="Puissance du compteur" min=\{0\}/);
  assert.match(pageSource, /♨ Chauffage électrique/);
  assert.match(pageSource, /Absent en journée/);
  assert.match(pageSource, /Télétravail \/ présent/);
  assert.match(pageSource, /results\.heatingHcKwh/);
  assert.match(pageSource, /Total en heures creuses<strong>\{number\.format\(results\.hcKwh\)\} kWh<\/strong>/);
  assert.match(pageSource, /v\{APP_VERSION\}/);
  assert.equal(JSON.parse(manifestSource).version, version);
  assert.match(serviceWorkerSource, new RegExp(`declic-hc-v${version?.replaceAll(".", "\\.")}`));
  assert.equal(JSON.parse(packageSource).version, version);
  assert.equal(JSON.parse(lockSource).version, version);
  assert.equal(JSON.parse(lockSource).packages[""].version, version);
});
