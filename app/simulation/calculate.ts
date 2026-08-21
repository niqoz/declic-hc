import type {
  Appliance,
  EnergyDistribution,
  SimulationInput,
  SimulationResult,
  SimulationWarning,
  Tariff,
} from "./types.js";

export const HOUSEHOLD_REFERENCE_KWH = 4500;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function nonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function calculateApplianceOffPeakKwh(appliance: Appliance) {
  return nonNegative(appliance.annualKwh);
}

export function calculateEnergyDistribution(
  annualKwh: number,
  backgroundHcShare: number,
  appliances: Appliance[],
  heating: { annualKwh: number; hcShare: number } = { annualKwh: 0, hcShare: 0 },
): EnergyDistribution {
  const safeAnnualKwh = nonNegative(annualKwh);
  const safeBackgroundHcShare = clamp(backgroundHcShare, 0, 100);
  const declaredApplianceKwh = appliances.reduce((sum, appliance) => sum + nonNegative(appliance.annualKwh), 0);
  const declaredHeatingKwh = nonNegative(heating.annualKwh);
  const declaredModeledKwh = declaredApplianceKwh + declaredHeatingKwh;
  const applianceScale = declaredModeledKwh > safeAnnualKwh && declaredModeledKwh > 0
    ? safeAnnualKwh / declaredModeledKwh
    : 1;
  const applianceKwh = declaredApplianceKwh * applianceScale;
  const heatingKwh = declaredHeatingKwh * applianceScale;
  const declaredShiftableKwh = declaredApplianceKwh;
  const shiftableKwh = declaredShiftableKwh * applianceScale;
  const backgroundKwh = Math.max(0, safeAnnualKwh - applianceKwh - heatingKwh);
  const backgroundHc = backgroundKwh * safeBackgroundHcShare / 100;
  const scheduledHc = appliances.reduce(
    (sum, appliance) => sum + calculateApplianceOffPeakKwh(appliance) * applianceScale,
    0,
  );
  const heatingHcShare = clamp(heating.hcShare, 0, 100);
  const heatingHcKwh = heatingKwh * heatingHcShare / 100;
  const fixedHcKwh = scheduledHc + heatingHcKwh;
  const hcKwh = Math.min(safeAnnualKwh, backgroundHc + fixedHcKwh);
  const hpKwh = Math.max(0, safeAnnualKwh - hcKwh);
  const share = safeAnnualKwh > 0 ? hcKwh / safeAnnualKwh * 100 : 0;
  const minShare = safeAnnualKwh > 0 ? fixedHcKwh / safeAnnualKwh * 100 : 0;
  const maxShare = safeAnnualKwh > 0 ? (fixedHcKwh + backgroundKwh) / safeAnnualKwh * 100 : 0;

  return {
    declaredApplianceKwh,
    applianceKwh,
    declaredShiftableKwh,
    shiftableKwh,
    backgroundKwh,
    backgroundHc,
    scheduledHc,
    declaredHeatingKwh,
    heatingKwh,
    heatingHcKwh,
    heatingHcShare,
    hcKwh,
    hpKwh,
    share,
    minShare,
    maxShare,
    applianceScale,
  };
}

export function calculateBaseCost(annualKwh: number, tariff: Tariff) {
  return nonNegative(tariff.baseSubscription) + nonNegative(annualKwh) * nonNegative(tariff.basePrice);
}

export function calculateHphcCost(hpKwh: number, hcKwh: number, tariff: Tariff) {
  return nonNegative(tariff.hphcSubscription)
    + nonNegative(hpKwh) * nonNegative(tariff.hpPrice)
    + nonNegative(hcKwh) * nonNegative(tariff.hcPrice);
}

export function calculateBreakEvenShare(annualKwh: number, tariff: Tariff) {
  const safeAnnualKwh = nonNegative(annualKwh);
  const denominator = nonNegative(tariff.hpPrice) - nonNegative(tariff.hcPrice);
  if (denominator <= 0) return 100;
  const threshold = (
    (nonNegative(tariff.hpPrice) - nonNegative(tariff.basePrice)) * safeAnnualKwh
    + nonNegative(tariff.hphcSubscription)
    - nonNegative(tariff.baseSubscription)
  ) / (denominator * Math.max(1, safeAnnualKwh)) * 100;
  return clamp(threshold, 0, 100);
}

export function validateSimulationInput(input: SimulationInput, declaredModeledKwh?: number): SimulationWarning[] {
  const warnings: SimulationWarning[] = [];
  const numericValues = [
    input.annualKwh,
    input.backgroundHcShare,
    input.tariff.baseSubscription,
    input.tariff.hphcSubscription,
    input.tariff.basePrice,
    input.tariff.hpPrice,
    input.tariff.hcPrice,
    input.heating?.annualKwh ?? 0,
    input.heating?.hcShare ?? 0,
    ...input.appliances.flatMap((appliance) => [
      appliance.annualKwh,
      appliance.lowKwh,
      appliance.highKwh,
      appliance.shiftableShare,
      appliance.offPeakShare,
    ]),
  ];

  if (numericValues.some((value) => !Number.isFinite(value) || value < 0)) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Certaines valeurs invalides ont été ramenées à zéro pour effectuer la simulation.",
    });
  }
  if (
    input.backgroundHcShare < 0
    || input.backgroundHcShare > 100
    || input.appliances.some((appliance) => appliance.shiftableShare > 100 || appliance.offPeakShare > 100)
  ) {
    if (!warnings.some((warning) => warning.code === "INVALID_INPUT")) {
      warnings.push({
        code: "INVALID_INPUT",
        message: "Les proportions doivent rester comprises entre 0 et 100 %.",
      });
    }
  }
  if (input.tariff.hcPrice > input.tariff.hpPrice) {
    warnings.push({
      code: "UNUSUAL_TARIFF",
      message: "Le prix HC est supérieur au prix HP dans la grille utilisée.",
    });
  }
  if ((declaredModeledKwh ?? 0) > nonNegative(input.annualKwh)) {
    warnings.push({
      code: "APPLIANCES_EXCEED_TOTAL",
      message: "Le chauffage et les usages déclarés dépassent la consommation du foyer et sont réduits proportionnellement pour le calcul.",
    });
  }
  return warnings;
}

export function calculateSimulation(input: SimulationInput): SimulationResult {
  const distribution = calculateEnergyDistribution(input.annualKwh, input.backgroundHcShare, input.appliances, input.heating);
  const baseSubscriptionCost = nonNegative(input.tariff.baseSubscription);
  const baseEnergyCost = nonNegative(input.annualKwh) * nonNegative(input.tariff.basePrice);
  const hphcSubscriptionCost = nonNegative(input.tariff.hphcSubscription);
  const hpEnergyCost = nonNegative(distribution.hpKwh) * nonNegative(input.tariff.hpPrice);
  const hcEnergyCost = nonNegative(distribution.hcKwh) * nonNegative(input.tariff.hcPrice);
  const baseCost = baseSubscriptionCost + baseEnergyCost;
  const hphcCost = hphcSubscriptionCost + hpEnergyCost + hcEnergyCost;
  const warnings = validateSimulationInput(input, distribution.declaredApplianceKwh + distribution.declaredHeatingKwh);

  return {
    ...distribution,
    baseSubscriptionCost,
    baseEnergyCost,
    hphcSubscriptionCost,
    hpEnergyCost,
    hcEnergyCost,
    baseCost,
    hphcCost,
    delta: baseCost - hphcCost,
    threshold: calculateBreakEvenShare(input.annualKwh, input.tariff),
    warnings,
  };
}
