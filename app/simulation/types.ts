export type Tariff = {
  power: number;
  baseSubscription: number;
  hphcSubscription: number;
  basePrice: number;
  hpPrice: number;
  hcPrice: number;
};

export type ConsumptionMode = "proportional" | "fixed";

export type Appliance = {
  id: number;
  name: string;
  kwh: number;
  inOffPeak: boolean;
  mode: ConsumptionMode;
  referenceKwh: number;
};

export type AppliancePreset = {
  name: string;
  kwh: number;
  icon: string;
  detail: string;
  mode: ConsumptionMode;
  referenceKwh: number;
};

export type EffectiveAppliance = Appliance & {
  storedKwh: number;
};

export type OffPeakWindow = {
  id: number;
  start: string;
  end: string;
};

export type SimulationInput = {
  annualKwh: number;
  backgroundHcShare: number;
  tariff: Tariff;
  appliances: Appliance[];
};

export type SimulationWarning = {
  code: "APPLIANCES_EXCEED_TOTAL" | "INVALID_INPUT" | "UNUSUAL_TARIFF";
  message: string;
};

export type EnergyDistribution = {
  declaredFlexibleKwh: number;
  flexibleKwh: number;
  backgroundKwh: number;
  backgroundHc: number;
  scheduledHc: number;
  hcKwh: number;
  hpKwh: number;
  share: number;
  minShare: number;
  maxShare: number;
  applianceScale: number;
};

export type SimulationResult = EnergyDistribution & {
  baseCost: number;
  hphcCost: number;
  delta: number;
  threshold: number;
  warnings: SimulationWarning[];
};

export type SimulatorState = {
  version: number;
  tariffs: Tariff[];
  power: number;
  annualKwh: number;
  backgroundHcShare: number;
  appliances: Appliance[];
  offPeakWindows: OffPeakWindow[];
  activeOffPeakWindowId: number;
};

export type LegacySimulatorState = Partial<SimulatorState> & {
  recipeReferenceKwh?: number;
  consumptionMode?: ConsumptionMode;
};
