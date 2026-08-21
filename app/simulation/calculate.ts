import type {
  Appliance,
  EffectiveAppliance,
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

export function calculateEffectiveApplianceKwh(appliance: Appliance, annualKwh: number) {
  const storedKwh = nonNegative(appliance.kwh);
  if (appliance.mode !== "proportional") return storedKwh;
  const referenceKwh = nonNegative(appliance.referenceKwh);
  return referenceKwh > 0 ? storedKwh * nonNegative(annualKwh) / referenceKwh : storedKwh;
}

export function calculateEffectiveAppliances(appliances: Appliance[], annualKwh: number): EffectiveAppliance[] {
  return appliances.map((appliance) => ({
    ...appliance,
    storedKwh: appliance.kwh,
    kwh: calculateEffectiveApplianceKwh(appliance, annualKwh),
  }));
}

export function calculateEnergyDistribution(
  annualKwh: number,
  backgroundHcShare: number,
  effectiveAppliances: EffectiveAppliance[],
): EnergyDistribution {
  const safeAnnualKwh = nonNegative(annualKwh);
  const safeBackgroundHcShare = clamp(backgroundHcShare, 0, 100);
  const declaredFlexibleKwh = effectiveAppliances.reduce((sum, appliance) => sum + nonNegative(appliance.kwh), 0);
  const flexibleKwh = Math.min(safeAnnualKwh, declaredFlexibleKwh);
  const applianceScale = declaredFlexibleKwh > safeAnnualKwh && declaredFlexibleKwh > 0
    ? safeAnnualKwh / declaredFlexibleKwh
    : 1;
  const backgroundKwh = Math.max(0, safeAnnualKwh - flexibleKwh);
  const backgroundHc = backgroundKwh * safeBackgroundHcShare / 100;
  const scheduledHc = effectiveAppliances
    .filter((appliance) => appliance.inOffPeak)
    .reduce((sum, appliance) => sum + nonNegative(appliance.kwh) * applianceScale, 0);
  const hcKwh = Math.min(safeAnnualKwh, backgroundHc + scheduledHc);
  const hpKwh = Math.max(0, safeAnnualKwh - hcKwh);
  const share = safeAnnualKwh > 0 ? hcKwh / safeAnnualKwh * 100 : 0;
  const minShare = safeAnnualKwh > 0 ? scheduledHc / safeAnnualKwh * 100 : 0;
  const maxShare = safeAnnualKwh > 0 ? (scheduledHc + backgroundKwh) / safeAnnualKwh * 100 : 0;

  return {
    declaredFlexibleKwh,
    flexibleKwh,
    backgroundKwh,
    backgroundHc,
    scheduledHc,
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

export function validateSimulationInput(input: SimulationInput, declaredFlexibleKwh?: number): SimulationWarning[] {
  const warnings: SimulationWarning[] = [];
  const numericValues = [
    input.annualKwh,
    input.backgroundHcShare,
    input.tariff.baseSubscription,
    input.tariff.hphcSubscription,
    input.tariff.basePrice,
    input.tariff.hpPrice,
    input.tariff.hcPrice,
    ...input.appliances.flatMap((appliance) => [appliance.kwh, appliance.referenceKwh]),
  ];

  if (numericValues.some((value) => !Number.isFinite(value) || value < 0)) {
    warnings.push({
      code: "INVALID_INPUT",
      message: "Certaines valeurs invalides ont été ramenées à zéro pour effectuer la simulation.",
    });
  }
  if (input.backgroundHcShare < 0 || input.backgroundHcShare > 100) {
    if (!warnings.some((warning) => warning.code === "INVALID_INPUT")) {
      warnings.push({
        code: "INVALID_INPUT",
        message: "La part d’heures creuses doit rester comprise entre 0 et 100 %.",
      });
    }
  }
  if (input.tariff.hcPrice > input.tariff.hpPrice) {
    warnings.push({
      code: "UNUSUAL_TARIFF",
      message: "Le prix HC est supérieur au prix HP dans la grille utilisée.",
    });
  }
  if ((declaredFlexibleKwh ?? 0) > nonNegative(input.annualKwh)) {
    warnings.push({
      code: "APPLIANCES_EXCEED_TOTAL",
      message: "Les usages déclarés dépassent la consommation du foyer et sont réduits proportionnellement pour le calcul.",
    });
  }
  return warnings;
}

export function calculateSimulation(input: SimulationInput): SimulationResult {
  const effectiveAppliances = calculateEffectiveAppliances(input.appliances, input.annualKwh);
  const distribution = calculateEnergyDistribution(input.annualKwh, input.backgroundHcShare, effectiveAppliances);
  const baseCost = calculateBaseCost(input.annualKwh, input.tariff);
  const hphcCost = calculateHphcCost(distribution.hpKwh, distribution.hcKwh, input.tariff);
  const warnings = validateSimulationInput(input, distribution.declaredFlexibleKwh);

  return {
    ...distribution,
    baseCost,
    hphcCost,
    delta: baseCost - hphcCost,
    threshold: calculateBreakEvenShare(input.annualKwh, input.tariff),
    warnings,
  };
}
