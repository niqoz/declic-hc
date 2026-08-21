import { HOUSEHOLD_REFERENCE_KWH } from "./calculate.js";
import { getApplianceCalibration } from "./calibration.js";
import type { Appliance } from "./types.js";

export const REFERENCE_RESIDENTS = 2;

export type HouseholdContext = {
  annualKwh: number;
  residents: number;
};

const safeAnnualKwh = (value: number) => Math.max(1000, Number.isFinite(value) ? value : HOUSEHOLD_REFERENCE_KWH);
const safeResidents = (value: number) => Math.max(1, Number.isFinite(value) ? value : REFERENCE_RESIDENTS);

export function householdScaleFactor(type: string, from: HouseholdContext, to: HouseholdContext) {
  const calibration = getApplianceCalibration(type);
  if (!calibration || calibration.confidence === "insufficient") return 1;
  const annualFactor = Math.pow(safeAnnualKwh(to.annualKwh) / safeAnnualKwh(from.annualKwh), calibration.householdExponent);
  const residentFactor = Math.pow(safeResidents(to.residents) / safeResidents(from.residents), calibration.residentExponent);
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
