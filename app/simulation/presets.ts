import type { Appliance, AppliancePreset, ApplianceSource } from "./types.js";

export const INTERNAL_ESTIMATE_SOURCE: ApplianceSource = {
  kind: "internal",
  organization: "ADEME / ElecDom + Déclic HC",
  label: "Ordre de grandeur ADEME, courbe foyer indicative",
  year: 2022,
  url: "https://data.ademe.fr/datasets/elecdom-donnees-de-consommation-annuelle",
};

const source = () => ({ ...INTERNAL_ESTIMATE_SOURCE });

export const APPLIANCE_PRESETS: AppliancePreset[] = [
  { type: "water-heater", name: "Chauffe-eau", annualKwh: 1200, lowKwh: 900, highKwh: 1600, calculationMode: "reference", shiftableShare: 100, defaultOffPeakShare: 100, source: source(), icon: "♨", detail: "Ballon électrique" },
  { type: "electric-vehicle", name: "Véhicule électrique", annualKwh: 2000, lowKwh: 1000, highKwh: 3000, calculationMode: "reference", shiftableShare: 100, defaultOffPeakShare: 100, source: source(), icon: "⚡", detail: "Recharge à domicile" },
  { type: "pool-pump", name: "Pompe de piscine", annualKwh: 900, lowKwh: 500, highKwh: 1500, calculationMode: "reference", shiftableShare: 100, defaultOffPeakShare: 100, source: source(), icon: "≈", detail: "Filtration programmable" },
  { type: "heat-pump-water-heater", name: "Ballon thermodynamique", annualKwh: 500, lowKwh: 350, highKwh: 800, calculationMode: "reference", shiftableShare: 100, defaultOffPeakShare: 100, source: source(), icon: "◌", detail: "Eau chaude optimisée" },
  { type: "washing-machine", name: "Lave-linge", annualKwh: 160, lowKwh: 85, highKwh: 250, calculationMode: "reference", shiftableShare: 100, defaultOffPeakShare: 100, source: source(), icon: "◉", detail: "Cycles différés" },
  { type: "dishwasher", name: "Lave-vaisselle", annualKwh: 220, lowKwh: 150, highKwh: 300, calculationMode: "reference", shiftableShare: 100, defaultOffPeakShare: 100, source: source(), icon: "◇", detail: "Cycles différés" },
  { type: "dryer", name: "Sèche-linge", annualKwh: 300, lowKwh: 180, highKwh: 500, calculationMode: "reference", shiftableShare: 100, defaultOffPeakShare: 100, source: source(), icon: "◎", detail: "Cycles programmables" },
  { type: "air-conditioning", name: "Climatisation pilotée", annualKwh: 600, lowKwh: 100, highKwh: 800, calculationMode: "reference", shiftableShare: 100, defaultOffPeakShare: 100, source: source(), icon: "❄", detail: "Préclimatisation" },
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
