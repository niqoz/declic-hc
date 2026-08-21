import { HOUSEHOLD_REFERENCE_KWH } from "./calculate.js";
import type { Appliance } from "./types.js";

export const REFERENCE_RESIDENTS = 2;

export type HouseholdContext = {
  annualKwh: number;
  residents: number;
};

type ConsumptionCurve = {
  householdExponent: number;
  residentExponent: number;
};

// Les coefficients liés aux kWh sont volontairement atténués lorsque le nombre
// d'habitants est connu, afin de ne pas compter deux fois la taille du foyer.
const CONSUMPTION_CURVES: Record<string, ConsumptionCurve> = {
  "water-heater": { householdExponent: 0.29, residentExponent: 0.60 },
  "heat-pump-water-heater": { householdExponent: 0.29, residentExponent: 0.60 },
  "washing-machine": { householdExponent: 0.20, residentExponent: 0.45 },
  dishwasher: { householdExponent: 0.15, residentExponent: 0.40 },
  dryer: { householdExponent: 0.25, residentExponent: 0.50 },
};

const safeAnnualKwh = (value: number) => Math.max(1000, Number.isFinite(value) ? value : HOUSEHOLD_REFERENCE_KWH);
const safeResidents = (value: number) => Math.max(1, Number.isFinite(value) ? value : REFERENCE_RESIDENTS);

export function householdScaleFactor(type: string, from: HouseholdContext, to: HouseholdContext) {
  const curve = CONSUMPTION_CURVES[type];
  if (!curve) return 1;
  const annualFactor = Math.pow(safeAnnualKwh(to.annualKwh) / safeAnnualKwh(from.annualKwh), curve.householdExponent);
  const residentFactor = Math.pow(safeResidents(to.residents) / safeResidents(from.residents), curve.residentExponent);
  return annualFactor * residentFactor;
}

export function scaleApplianceForHousehold(appliance: Appliance, from: HouseholdContext, to: HouseholdContext): Appliance {
  const factor = appliance.calculationMode === "measured" ? 1 : householdScaleFactor(appliance.type, from, to);
  return {
    ...appliance,
    annualKwh: appliance.annualKwh * factor,
    lowKwh: appliance.lowKwh * factor,
    highKwh: appliance.highKwh * factor,
    shiftableShare: 100,
    offPeakShare: 100,
  };
}

export function scaleAppliancesForHousehold(appliances: Appliance[], from: HouseholdContext, to: HouseholdContext) {
  return appliances.map((appliance) => scaleApplianceForHousehold(appliance, from, to));
}
