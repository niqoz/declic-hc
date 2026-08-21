import type { Appliance, AppliancePreset, ApplianceSource } from "./types.js";
import { confidenceLabel, getApplianceCalibration } from "./calibration.js";

export const INTERNAL_ESTIMATE_SOURCE: ApplianceSource = {
  kind: "internal",
  organization: "Déclic HC",
  label: "Estimation pédagogique modifiable — calibration insuffisante",
};

const source = (type: string): ApplianceSource => {
  const calibration = getApplianceCalibration(type);
  if (!calibration || calibration.confidence === "insufficient") {
    return {
      ...INTERNAL_ESTIMATE_SOURCE,
      ...(calibration ? {
        label: `Estimation indicative — seulement ${calibration.sampleSize} logement${calibration.sampleSize > 1 ? "s" : ""} exploitable${calibration.sampleSize > 1 ? "s" : ""}`,
        year: 2022,
        url: calibration.sourceUrl,
      } : {}),
    };
  }
  return {
    kind: "internal",
    organization: "ADEME / ElecDom + Déclic HC",
    label: `Calibration sur ${calibration.sampleSize} logements — confiance ${confidenceLabel(calibration.confidence)}`,
    year: 2022,
    url: calibration.sourceUrl,
  };
};

const values = (type: string, fallback: [number, number, number]) => {
  const calibration = getApplianceCalibration(type);
  if (!calibration || calibration.confidence === "insufficient") return fallback;
  return [calibration.referenceAnnualKwh, calibration.lowAnnualKwh, calibration.highAnnualKwh] as const;
};

const [waterHeater, waterHeaterLow, waterHeaterHigh] = values("water-heater", [1200, 900, 1600]);
const [washingMachine, washingMachineLow, washingMachineHigh] = values("washing-machine", [160, 85, 250]);
const [dishwasher, dishwasherLow, dishwasherHigh] = values("dishwasher", [220, 150, 300]);
const [dryer, dryerLow, dryerHigh] = values("dryer", [300, 180, 500]);

export const APPLIANCE_PRESETS: AppliancePreset[] = [
  { type: "water-heater", name: "Chauffe-eau", annualKwh: waterHeater, lowKwh: waterHeaterLow, highKwh: waterHeaterHigh, calculationMode: "reference", shiftableShare: 100, defaultOffPeakShare: 100, source: source("water-heater"), icon: "♨", detail: "Ballon électrique" },
  { type: "electric-vehicle", name: "Véhicule électrique", annualKwh: 2000, lowKwh: 1000, highKwh: 3000, calculationMode: "reference", shiftableShare: 100, defaultOffPeakShare: 100, source: source("electric-vehicle"), icon: "⚡", detail: "Recharge à domicile" },
  { type: "pool-pump", name: "Pompe de piscine", annualKwh: 900, lowKwh: 500, highKwh: 1500, calculationMode: "reference", shiftableShare: 100, defaultOffPeakShare: 100, source: source("pool-pump"), icon: "≈", detail: "Filtration programmable" },
  { type: "heat-pump-water-heater", name: "Ballon thermodynamique", annualKwh: 500, lowKwh: 350, highKwh: 800, calculationMode: "reference", shiftableShare: 100, defaultOffPeakShare: 100, source: source("heat-pump-water-heater"), icon: "◌", detail: "Eau chaude optimisée" },
  { type: "washing-machine", name: "Lave-linge", annualKwh: washingMachine, lowKwh: washingMachineLow, highKwh: washingMachineHigh, calculationMode: "reference", shiftableShare: 100, defaultOffPeakShare: 100, source: source("washing-machine"), icon: "◉", detail: "Cycles différés" },
  { type: "dishwasher", name: "Lave-vaisselle", annualKwh: dishwasher, lowKwh: dishwasherLow, highKwh: dishwasherHigh, calculationMode: "reference", shiftableShare: 100, defaultOffPeakShare: 100, source: source("dishwasher"), icon: "◇", detail: "Cycles différés" },
  { type: "dryer", name: "Sèche-linge", annualKwh: dryer, lowKwh: dryerLow, highKwh: dryerHigh, calculationMode: "reference", shiftableShare: 100, defaultOffPeakShare: 100, source: source("dryer"), icon: "◎", detail: "Cycles programmables" },
  { type: "air-conditioning", name: "Climatisation pilotée", annualKwh: 600, lowKwh: 100, highKwh: 800, calculationMode: "reference", shiftableShare: 100, defaultOffPeakShare: 100, source: source("air-conditioning"), icon: "❄", detail: "Préclimatisation" },
];

function applianceFromPreset(name: string, id: number, offPeakShare: number): Appliance {
  const preset = APPLIANCE_PRESETS.find((candidate) => candidate.name === name)!;
  return {
    id,
    type: preset.type,
    name: preset.name,
    annualKwh: preset.annualKwh,
    lowKwh: preset.lowKwh,
    highKwh: preset.highKwh,
    calculationMode: preset.calculationMode,
    shiftableShare: preset.shiftableShare,
    offPeakShare,
    source: { ...preset.source },
  };
}

export const DEFAULT_APPLIANCES: Appliance[] = [
  applianceFromPreset("Chauffe-eau", 1, 100),
  applianceFromPreset("Lave-linge", 2, 100),
  applianceFromPreset("Lave-vaisselle", 3, 100),
];
