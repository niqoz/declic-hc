import { getApplianceCalibration } from "./calibration.js";
import type { Appliance } from "./types.js";

export const REFERENCE_RESIDENTS = 2;

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
