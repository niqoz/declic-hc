import type {
  Appliance,
  BreakEvenResult,
  EnergyDistribution,
  HeatingEstimate,
  SimulationInput,
  SimulationEstimate,
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
  const backgroundKwh = Math.max(0, safeAnnualKwh - applianceKwh - heatingKwh);
  const backgroundHc = backgroundKwh * safeBackgroundHcShare / 100;
  const scheduledHc = appliances.reduce(
    (sum, appliance) => sum + nonNegative(appliance.annualKwh) * applianceScale,
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

export function calculateBreakEvenShare(annualKwh: number, tariff: Tariff): BreakEvenResult {
  const safeAnnualKwh = nonNegative(annualKwh);
  const baseCost = calculateBaseCost(safeAnnualKwh, tariff);
  const hphcAtZero = calculateHphcCost(safeAnnualKwh, 0, tariff);
  const deltaAtZero = baseCost - hphcAtZero;
  const slope = (nonNegative(tariff.hpPrice) - nonNegative(tariff.hcPrice)) * safeAnnualKwh;
  const epsilon = 1e-9;

  if (Math.abs(slope) <= epsilon) {
    if (Math.abs(deltaAtZero) <= epsilon) return { status: "equal", share: null };
    return { status: deltaAtZero > 0 ? "always" : "never", share: null };
  }

  const deltaAtFull = deltaAtZero + slope;
  if (slope > 0) {
    if (deltaAtZero > epsilon) return { status: "always", share: null };
    if (deltaAtFull < -epsilon) return { status: "never", share: null };
    return { status: "above", share: clamp(-deltaAtZero / slope * 100, 0, 100) };
  }

  if (deltaAtZero < -epsilon) return { status: "never", share: null };
  if (deltaAtFull > epsilon) return { status: "always", share: null };
  return { status: "below", share: clamp(-deltaAtZero / slope * 100, 0, 100) };
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
    ]),
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
        message: "Les proportions doivent rester comprises entre 0 et 100 %.",
      });
    }
  }
  if ((input.heating?.hcShare ?? 0) > 100
    || input.appliances.some((appliance) => appliance.lowKwh > appliance.annualKwh || appliance.highKwh < appliance.annualKwh)
    || (input.heating != null && (input.heating.lowKwh > input.heating.annualKwh || input.heating.highKwh < input.heating.annualKwh))) {
    if (!warnings.some((warning) => warning.code === "INVALID_INPUT")) {
      warnings.push({
        code: "INVALID_INPUT",
        message: "Les proportions et fourchettes invalides ont été bornées pour effectuer la simulation.",
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
  const estimate = (appliances: Appliance[], heating?: HeatingEstimate): SimulationEstimate => {
    const variant = calculateEnergyDistribution(input.annualKwh, input.backgroundHcShare, appliances, heating);
    const variantHphcCost = calculateHphcCost(variant.hpKwh, variant.hcKwh, input.tariff);
    return { ...variant, hphcCost: variantHphcCost, delta: baseCost - variantHphcCost };
  };
  const lowAppliances = input.appliances.map((appliance) => ({
    ...appliance,
    annualKwh: Math.min(nonNegative(appliance.annualKwh), nonNegative(appliance.lowKwh)),
  }));
  const highAppliances = input.appliances.map((appliance) => ({
    ...appliance,
    annualKwh: Math.max(nonNegative(appliance.annualKwh), nonNegative(appliance.highKwh)),
  }));
  const lowHeating = input.heating ? {
    ...input.heating,
    annualKwh: Math.min(nonNegative(input.heating.annualKwh), nonNegative(input.heating.lowKwh)),
  } : undefined;
  const highHeating = input.heating ? {
    ...input.heating,
    annualKwh: Math.max(nonNegative(input.heating.annualKwh), nonNegative(input.heating.highKwh)),
  } : undefined;

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
    breakEven: calculateBreakEvenShare(input.annualKwh, input.tariff),
    lowEstimate: estimate(lowAppliances, lowHeating),
    highEstimate: estimate(highAppliances, highHeating),
    warnings,
  };
}
