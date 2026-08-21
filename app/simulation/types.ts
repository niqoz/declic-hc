export type Tariff = {
  power: number;
  baseSubscription: number;
  hphcSubscription: number;
  basePrice: number;
  hpPrice: number;
  hcPrice: number;
};

export type LegacyConsumptionMode = "proportional" | "fixed";
export type CalculationMode = "reference" | "detailed" | "measured";
export type SourceKind = "internal" | "official" | "user";

export type ApplianceSource = {
  kind: SourceKind;
  organization: string;
  label: string;
  year?: number;
  url?: string;
};

export type Appliance = {
  id: number;
  type: string;
  name: string;
  annualKwh: number;
  lowKwh: number;
  highKwh: number;
  calculationMode: CalculationMode;
  shiftableShare: number;
  offPeakShare: number;
  source: ApplianceSource;
};

export type AppliancePreset = Omit<Appliance, "id" | "offPeakShare"> & {
  icon: string;
  detail: string;
  defaultOffPeakShare: number;
};

export type LegacyAppliance = Partial<Appliance> & {
  kwh?: number;
  inOffPeak?: boolean;
  mode?: LegacyConsumptionMode;
  referenceKwh?: number;
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
  declaredApplianceKwh: number;
  applianceKwh: number;
  declaredShiftableKwh: number;
  shiftableKwh: number;
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

export type LegacySimulatorState = Omit<Partial<SimulatorState>, "appliances"> & {
  appliances?: unknown[];
  recipeReferenceKwh?: number;
  consumptionMode?: LegacyConsumptionMode;
};
