import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateBaseCost,
  calculateBreakEvenShare,
  calculateHphcCost,
  calculateSimulation,
} from "../.test-dist/calculate.js";
import { APPLIANCE_PRESETS, DEFAULT_APPLIANCES } from "../.test-dist/presets.js";
import { ELECDOM_DATA_QUALITY, getApplianceCalibration } from "../.test-dist/calibration.js";
import { estimateCoolingHcShare, estimateCoolingProfile } from "../.test-dist/cooling.js";
import {
  estimateHeating,
  isValidOffPeakWindow,
  offPeakDurationMinutes,
  updateOffPeakWindowTime,
} from "../.test-dist/heating.js";
import { scaleAppliancesForResidents } from "../.test-dist/occupants.js";
import {
  CURRENT_STATE_VERSION,
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
  energyMode: "known-total",
  projectedBackgroundKwh: 2987,
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

  closeTo(radiators.annualKwh / heatPump.annualKwh, 2.9);
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

  closeTo(away.hcShare, 31.0171, 0.01);
  closeTo(mixed.hcShare, 30.1961, 0.01);
  closeTo(home.hcShare, 29.0429, 0.01);
  assert.ok(away.hcShare > home.hcShare);
  closeTo(away.annualKwh, 3831.81, 0.1);
  closeTo(home.annualKwh, 4092.28, 0.1);
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
  const simulate = (patch) => calculateSimulation({
    annualKwh: 4500,
    energyMode: "known-total",
    backgroundHcShare: 25,
    tariff,
    appliances,
    heating: estimateHeating({ ...defaultState.heating, enabled: true, ...patch }, window),
  });
  const good = simulate({ insulation: "good", system: "heat-pump" });
  const poor = simulate({ insulation: "poor", system: "radiators" });
  closeTo(good.totalKwh, poor.totalKwh);
  closeTo(good.baseCost, poor.baseCost);
  closeTo(good.hphcCost, poor.hphcCost);
  closeTo(good.heatingKwh, 0);
  assert.ok(good.declaredHeatingKwh < poor.declaredHeatingKwh);
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
  closeTo(withHeating.heatingKwh, 0);
  closeTo(withHeating.totalKwh, 4500);
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
    closeTo(after.annualKwh, before.annualKwh * 2);
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
  assert.equal(migrated.energyMode, "known-total");
  closeTo(migrated.projectedBackgroundKwh, 7200 - preset.annualKwh);
  assert.equal(migrated.appliances[0].calculationMode, "reference");
  assert.deepEqual(migrated.offPeakWindows, defaultState.offPeakWindows);
  assert.equal(migrated.activeOffPeakWindowId, 1);
});

test("active une seule fois la dépendance aux habitants pour un état 0.9", () => {
  const previous = { ...defaultState, version: 8, residents: 1 };
  const migrated = loadSimulationState({ getItem: () => JSON.stringify(previous) }, defaultState, APPLIANCE_PRESETS);
  closeTo(migrated.appliances[0].annualKwh, appliances[0].annualKwh / 2);
  closeTo(migrated.appliances[1].annualKwh, appliances[1].annualKwh / 2);
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

  assert.equal(version, "0.9.1");
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
  assert.match(pageSource, /Facture connue/);
  assert.match(pageSource, /Projection énergétique/);
  assert.match(cssSource, /grid-template-columns: minmax\(0, 1fr\) repeat\(5, 40px\)/);
  assert.match(cssSource, /\.icon-sm \{ width: 40px; height: 40px;/);
  assert.match(pageSource, /aria-label="Puissance du compteur" min=\{0\}/);
  assert.match(pageSource, /♨ Chauffage électrique/);
  assert.match(pageSource, /Absent en journée/);
  assert.match(pageSource, /Télétravail \/ présent/);
  assert.match(pageSource, /results\.heatingHcKwh/);
  assert.match(pageSource, /v\{APP_VERSION\}/);
  assert.equal(JSON.parse(manifestSource).version, version);
  assert.match(serviceWorkerSource, new RegExp(`declic-hc-v${version?.replaceAll(".", "\\.")}`));
  assert.equal(JSON.parse(packageSource).version, version);
  assert.equal(JSON.parse(lockSource).version, version);
  assert.equal(JSON.parse(lockSource).packages[""].version, version);
});
