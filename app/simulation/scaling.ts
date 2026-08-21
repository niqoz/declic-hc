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
  const fromResidents = safeResidents(from.residents);
  const toResidents = safeResidents(to.residents);
  // La consommation par habitant sépare l'effet de taille énergétique de
  // l'effet démographique et évite de compter deux fois la croissance du foyer.
  const fromKwhPerResident = safeAnnualKwh(from.annualKwh) / fromResidents;
  const toKwhPerResident = safeAnnualKwh(to.annualKwh) / toResidents;
  const annualFactor = Math.pow(toKwhPerResident / fromKwhPerResident, calibration.householdExponent);
  const residentFactor = Math.pow(toResidents / fromResidents, calibration.residentExponent);
  return annualFactor * residentFactor;
}

export function scaleApplianceForHousehold(appliance: Appliance, from: HouseholdContext, to: HouseholdContext): Appliance {
  const factor = appliance.calculationMode === "measured" ? 1 : householdScaleFactor(appliance.type, from, to);
  return {
    ...appliance,
    annualKwh: appliance.annualKwh * factor,
    lowKwh: appliance.lowKwh * factor,
    highKwh: appliance.highKwh * factor,
  };
}

export function scaleAppliancesForHousehold(appliances: Appliance[], from: HouseholdContext, to: HouseholdContext) {
  return appliances.map((appliance) => scaleApplianceForHousehold(appliance, from, to));
}
