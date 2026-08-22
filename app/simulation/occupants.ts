import type { Appliance } from "./types.js";

export const REFERENCE_RESIDENTS = 2;

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

export function scaleAppliancesForResidents(appliances: Appliance[], fromResidents: number, toResidents: number) {
  const factor = safeResidents(toResidents) / safeResidents(fromResidents);
  return appliances.map((appliance) => {
    if (appliance.calculationMode === "measured" || !dependsOnResidents(appliance.type)) return appliance;
    return {
      ...appliance,
      annualKwh: appliance.annualKwh * factor,
      lowKwh: appliance.lowKwh * factor,
      highKwh: appliance.highKwh * factor,
    };
  });
}
