import { getApplianceCalibration } from "./calibration.js";
import type { Appliance } from "./types.js";

export const REFERENCE_RESIDENTS = 2;
// Foyer de référence des préréglages calibrés : les valeurs publiées par
// ElecDom sont mesurées à cette consommation annuelle, pour ce nombre
// d'habitants.
export const REFERENCE_HOUSEHOLD_KWH = 4500;
// Un foyer qui consomme deux fois plus n'a pas deux fois plus d'eau chaude à
// produire : la dépendance est nettement sous-linéaire. Exposant retenu à
// défaut de calibration exploitable.
const DEFAULT_HOUSEHOLD_EXPONENT = 0.4;
// Plancher de mise à l'échelle : sans lui, ramener le curseur de consommation
// à zéro annulerait définitivement tous les usages.
const MIN_SCALING_KWH = 500;

export type HouseholdContext = { annualKwh: number; residents: number };

// Exposant retenu lorsque la calibration n'en publie pas : les besoins d'un
// foyer croissent moins vite que son nombre d'habitants, une part de la
// consommation (pertes du ballon, cycles incompressibles) étant fixe.
const DEFAULT_RESIDENT_EXPONENT = 0.6;

const OCCUPANT_DEPENDENT_TYPES = new Set([
  "water-heater",
  "heat-pump-water-heater",
  "washing-machine",
  "dryer",
  "dishwasher",
]);

const safeResidents = (value: number) => Math.min(12, Math.max(1, Math.round(Number.isFinite(value) ? value : REFERENCE_RESIDENTS)));

export function dependsOnResidents(type: string) {
  return OCCUPANT_DEPENDENT_TYPES.has(type);
}

export function residentExponent(type: string) {
  if (!dependsOnResidents(type)) return 0;
  const exponent = getApplianceCalibration(type)?.residentExponent;
  return Number.isFinite(exponent) && Number(exponent) > 0 ? Number(exponent) : DEFAULT_RESIDENT_EXPONENT;
}

export function householdExponent(type: string) {
  if (!dependsOnResidents(type)) return 0;
  const calibration = getApplianceCalibration(type);
  if (!calibration || calibration.confidence === "insufficient") return DEFAULT_HOUSEHOLD_EXPONENT;
  const exponent = calibration.householdExponent;
  return Number.isFinite(exponent) && Number(exponent) > 0 ? Number(exponent) : DEFAULT_HOUSEHOLD_EXPONENT;
}

const safeAnnualKwh = (value: number) => Math.max(MIN_SCALING_KWH, Number.isFinite(value) ? value : REFERENCE_HOUSEHOLD_KWH);

// L'exposant du logement s'applique à la consommation par habitant, et non à la
// consommation totale : sans cela, l'agrandissement du foyer serait compté deux
// fois, la correction démographique le traduisant déjà.
const perCapitaKwh = ({ annualKwh, residents }: HouseholdContext) => safeAnnualKwh(annualKwh) / safeResidents(residents);

export const REFERENCE_HOUSEHOLD: HouseholdContext = { annualKwh: REFERENCE_HOUSEHOLD_KWH, residents: REFERENCE_RESIDENTS };

export function householdScaleFactor(type: string, from: HouseholdContext, to: HouseholdContext) {
  const house = householdExponent(type);
  const people = residentExponent(type);
  const houseFactor = house > 0 ? (perCapitaKwh(to) / perCapitaKwh(from)) ** house : 1;
  const peopleFactor = people > 0 ? (safeResidents(to.residents) / safeResidents(from.residents)) ** people : 1;
  return houseFactor * peopleFactor;
}

export function scaleAppliancesForHousehold(appliances: Appliance[], from: HouseholdContext, to: HouseholdContext) {
  return appliances.map((appliance) => {
    if (appliance.calculationMode === "measured") return appliance;
    const factor = householdScaleFactor(appliance.type, from, to);
    if (factor === 1) return appliance;
    return {
      ...appliance,
      annualKwh: appliance.annualKwh * factor,
      lowKwh: appliance.lowKwh * factor,
      highKwh: appliance.highKwh * factor,
    };
  });
}

export function residentScaleFactor(type: string, fromResidents: number, toResidents: number) {
  const exponent = residentExponent(type);
  if (exponent <= 0) return 1;
  return (safeResidents(toResidents) / safeResidents(fromResidents)) ** exponent;
}

export function scaleAppliancesForResidents(appliances: Appliance[], fromResidents: number, toResidents: number) {
  return appliances.map((appliance) => {
    if (appliance.calculationMode === "measured") return appliance;
    const factor = residentScaleFactor(appliance.type, fromResidents, toResidents);
    if (factor === 1) return appliance;
    return {
      ...appliance,
      annualKwh: appliance.annualKwh * factor,
      lowKwh: appliance.lowKwh * factor,
      highKwh: appliance.highKwh * factor,
    };
  });
}

// Les états 9 et 10 stockaient une mise à l'échelle strictement proportionnelle
// au nombre d'habitants. On la remplace par l'exposant sans repasser par les
// valeurs de préréglage, que le foyer a pu ajuster entre-temps.
export function rescaleAppliancesToResidentExponent(appliances: Appliance[], residents: number) {
  const ratio = safeResidents(residents) / REFERENCE_RESIDENTS;
  if (ratio === 1) return appliances;
  return appliances.map((appliance) => {
    if (appliance.calculationMode === "measured") return appliance;
    const exponent = residentExponent(appliance.type);
    if (exponent <= 0) return appliance;
    const factor = ratio ** exponent / ratio;
    return {
      ...appliance,
      annualKwh: appliance.annualKwh * factor,
      lowKwh: appliance.lowKwh * factor,
      highKwh: appliance.highKwh * factor,
    };
  });
}
