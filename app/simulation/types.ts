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
  source: ApplianceSource;
};

export type AppliancePreset = Omit<Appliance, "id"> & {
  icon: string;
  detail: string;
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

export type HeatingSystem = "radiators" | "heat-pump";
export type DwellingType = "house" | "apartment";
export type InsulationLevel = "good" | "standard" | "poor";
export type AltitudeBand = "low" | "medium" | "high";
export type OccupancyProfile = "away" | "mixed" | "home";

export type HeatingSettings = {
  enabled: boolean;
  surfaceM2: number;
  system: HeatingSystem;
  dwellingType: DwellingType;
  insulation: InsulationLevel;
  altitude: AltitudeBand;
  occupancy: OccupancyProfile;
};

export type HeatingEstimate = {
  annualKwh: number;
  lowKwh: number;
  highKwh: number;
  hcShare: number;
};

export type SimulationInput = {
  annualKwh: number;
  backgroundHcShare: number;
  tariff: Tariff;
  appliances: Appliance[];
  heating?: HeatingEstimate;
};

export type SimulationWarning = {
  code: "APPLIANCES_EXCEED_TOTAL" | "INVALID_INPUT" | "UNUSUAL_TARIFF";
  message: string;
};

export type EnergyDistribution = {
  declaredApplianceKwh: number;
  applianceKwh: number;
  backgroundKwh: number;
  backgroundHc: number;
  scheduledHc: number;
  declaredHeatingKwh: number;
  heatingKwh: number;
  heatingHcKwh: number;
  heatingHcShare: number;
  hcKwh: number;
  hpKwh: number;
  share: number;
  minShare: number;
  maxShare: number;
  applianceScale: number;
};

export type SimulationResult = EnergyDistribution & {
  baseSubscriptionCost: number;
  baseEnergyCost: number;
  hphcSubscriptionCost: number;
  hpEnergyCost: number;
  hcEnergyCost: number;
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
  residents: number;
  backgroundHcShare: number;
  appliances: Appliance[];
  heating: HeatingSettings;
  offPeakWindows: OffPeakWindow[];
  activeOffPeakWindowId: number;
};

export type LegacySimulatorState = Omit<Partial<SimulatorState>, "appliances"> & {
  appliances?: unknown[];
  recipeReferenceKwh?: number;
  consumptionMode?: LegacyConsumptionMode;
};

export type SimulatorStateInput = Omit<SimulatorState, "version">;

export type SavedProfile = {
  id: string;
  name: string;
  state: SimulatorStateInput;
  createdAt: string;
  updatedAt: string;
};

export type ProfilesStore = {
  version: number;
  profiles: SavedProfile[];
  activeProfileId: string | null;
};
