import type { Appliance, BreakEvenResult, DeltaSummary, EnergyDistribution, EnergyMode, HeatingEstimate, SimulationInput, SimulationEstimate, SimulationResult, SimulationWarning, Tariff } from "./types.js";

export const HOUSEHOLD_REFERENCE_KWH = 4500;
const NEUTRAL_DELTA_TOLERANCE = 1;

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function nonNegative(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

export function calculateEnergyDistribution(
  annualKwh: number,
  backgroundHcShare: number,
  appliances: Appliance[],
  heating: { annualKwh: number; hcShare: number } = { annualKwh: 0, hcShare: 0 },
  energyMode: EnergyMode = "known-total",
  projectedBackgroundKwh = 0,
): EnergyDistribution {
  const safeAnnualKwh = nonNegative(annualKwh);
  const safeBackgroundHcShare = clamp(backgroundHcShare, 0, 100);
  const declaredApplianceKwh = appliances.reduce((sum, appliance) => sum + nonNegative(appliance.annualKwh), 0);
  const declaredHeatingKwh = nonNegative(heating.annualKwh);
  const applianceKwh = declaredApplianceKwh;
  const totalKwh = energyMode === "projected"
    ? nonNegative(projectedBackgroundKwh) + applianceKwh + declaredHeatingKwh
    : Math.max(safeAnnualKwh, applianceKwh);
  const heatingKwh = energyMode === "projected"
    ? declaredHeatingKwh
    : Math.min(declaredHeatingKwh, Math.max(0, totalKwh - applianceKwh));
  const backgroundKwh = energyMode === "projected"
    ? nonNegative(projectedBackgroundKwh)
    : Math.max(0, totalKwh - applianceKwh - heatingKwh);
  const backgroundHc = backgroundKwh * safeBackgroundHcShare / 100;
  const scheduledHc = appliances.reduce(
    (sum, appliance) => sum + nonNegative(appliance.annualKwh) * clamp(appliance.hcShare ?? 100, 0, 100) / 100,
    0,
  );
  const heatingHcShare = clamp(heating.hcShare, 0, 100);
  const heatingHcKwh = heatingKwh * heatingHcShare / 100;
  const fixedHcKwh = scheduledHc + heatingHcKwh;
  const hcKwh = Math.min(totalKwh, backgroundHc + fixedHcKwh);
  const hpKwh = Math.max(0, totalKwh - hcKwh);
  const share = totalKwh > 0 ? hcKwh / totalKwh * 100 : 0;
  const minShare = totalKwh > 0 ? fixedHcKwh / totalKwh * 100 : 0;
  const maxShare = totalKwh > 0 ? (fixedHcKwh + backgroundKwh) / totalKwh * 100 : 0;
  return { totalKwh, declaredApplianceKwh, applianceKwh, backgroundKwh, backgroundHc, scheduledHc,
    declaredHeatingKwh, heatingKwh, heatingHcKwh, heatingHcShare, hcKwh, hpKwh, share, minShare, maxShare };
}

export function calculateBaseCost(annualKwh: number, tariff: Tariff) {
  return nonNegative(tariff.baseSubscription) + nonNegative(annualKwh) * nonNegative(tariff.basePrice);
}

export function calculateHphcCost(hpKwh: number, hcKwh: number, tariff: Tariff) {
  return nonNegative(tariff.hphcSubscription) + nonNegative(hpKwh) * nonNegative(tariff.hpPrice) + nonNegative(hcKwh) * nonNegative(tariff.hcPrice);
}

export function calculateBreakEvenShare(annualKwh: number, tariff: Tariff): BreakEvenResult {
  const safeAnnualKwh = nonNegative(annualKwh);
  const baseCost = calculateBaseCost(safeAnnualKwh, tariff);
  const deltaAtZero = baseCost - calculateHphcCost(safeAnnualKwh, 0, tariff);
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

export function validateSimulationInput(input: SimulationInput, distribution?: EnergyDistribution): SimulationWarning[] {
  const warnings: SimulationWarning[] = [];
  const values = [input.annualKwh, input.projectedBackgroundKwh ?? 0, input.backgroundHcShare,
    input.tariff.baseSubscription, input.tariff.hphcSubscription, input.tariff.basePrice, input.tariff.hpPrice, input.tariff.hcPrice,
    input.heating?.annualKwh ?? 0, input.heating?.hcShare ?? 0,
    ...input.appliances.flatMap((appliance) => [appliance.annualKwh, appliance.lowKwh, appliance.highKwh, appliance.hcShare ?? 100])];
  if (values.some((value) => !Number.isFinite(value) || value < 0)
    || input.backgroundHcShare > 100 || (input.heating?.hcShare ?? 0) > 100
    || input.appliances.some((appliance) => (appliance.hcShare ?? 0) > 100)
    || input.appliances.some((appliance) => appliance.lowKwh > appliance.annualKwh || appliance.highKwh < appliance.annualKwh)
    || (input.heating != null && (input.heating.lowKwh > input.heating.annualKwh || input.heating.highKwh < input.heating.annualKwh))) {
    warnings.push({ code: "INVALID_INPUT", message: "Certaines valeurs ou fourchettes invalides ont été bornées pour effectuer la simulation." });
  }
  if (input.tariff.hcPrice > input.tariff.hpPrice) warnings.push({ code: "UNUSUAL_TARIFF", message: "Le prix HC est supérieur au prix HP dans la grille utilisée." });
  if ((input.energyMode ?? "known-total") === "known-total" && distribution) {
    if (distribution.declaredApplianceKwh > nonNegative(input.annualKwh)) {
      warnings.push({ code: "APPLIANCES_EXCEED_TOTAL", message: "Les usages listés dépassent le total saisi : ils sont conservés et le total calculé est relevé pour éviter toute réduction artificielle." });
    } else if (distribution.heatingKwh < distribution.declaredHeatingKwh) {
      warnings.push({ code: "HEATING_CAPPED", message: "La consommation de chauffage dépasse le solde disponible dans la facture connue : elle est plafonnée sans modifier les autres usages." });
    }
  }
  return warnings;
}

// L'écart central n'a de sens qu'encadré : les scénarios bas et haut donnent
// ses bornes. Le verdict ne tranche que si la fourchette entière reste du même
// côté de zéro, un seuil fixe en euros n'ayant aucun rapport avec l'incertitude
// réelle du modèle.
export function summarizeDelta(result: {
  delta: number;
  lowEstimate: { delta: number };
  highEstimate: { delta: number };
}): DeltaSummary {
  const bounds = [result.delta, result.lowEstimate.delta, result.highEstimate.delta].filter(Number.isFinite);
  const low = Math.min(...bounds);
  const high = Math.max(...bounds);
  // Sans usage listé ni chauffage, la fourchette est vide : un écart inférieur
  // à un euro par an ne mérite alors pas davantage de verdict.
  const status = low > NEUTRAL_DELTA_TOLERANCE ? "positive" : high < -NEUTRAL_DELTA_TOLERANCE ? "negative" : "uncertain";
  return { status, delta: result.delta, low, high, spread: high - low };
}

export function calculateSimulation(input: SimulationInput): SimulationResult {
  const mode = input.energyMode ?? "known-total";
  const projectedBackgroundKwh = input.projectedBackgroundKwh ?? 0;
  const distribution = calculateEnergyDistribution(input.annualKwh, input.backgroundHcShare, input.appliances, input.heating, mode, projectedBackgroundKwh);
  const baseSubscriptionCost = nonNegative(input.tariff.baseSubscription);
  const baseEnergyCost = distribution.totalKwh * nonNegative(input.tariff.basePrice);
  const hphcSubscriptionCost = nonNegative(input.tariff.hphcSubscription);
  const hpEnergyCost = distribution.hpKwh * nonNegative(input.tariff.hpPrice);
  const hcEnergyCost = distribution.hcKwh * nonNegative(input.tariff.hcPrice);
  const baseCost = baseSubscriptionCost + baseEnergyCost;
  const hphcCost = hphcSubscriptionCost + hpEnergyCost + hcEnergyCost;
  const estimate = (variantAppliances: Appliance[], variantHeating?: HeatingEstimate): SimulationEstimate => {
    const variant = calculateEnergyDistribution(input.annualKwh, input.backgroundHcShare, variantAppliances, variantHeating, mode, projectedBackgroundKwh);
    const variantBaseCost = calculateBaseCost(variant.totalKwh, input.tariff);
    const variantHphcCost = calculateHphcCost(variant.hpKwh, variant.hcKwh, input.tariff);
    return { ...variant, baseCost: variantBaseCost, hphcCost: variantHphcCost, delta: variantBaseCost - variantHphcCost };
  };
  const lowAppliances = input.appliances.map((appliance) => ({ ...appliance, annualKwh: Math.min(nonNegative(appliance.annualKwh), nonNegative(appliance.lowKwh)) }));
  const highAppliances = input.appliances.map((appliance) => ({ ...appliance, annualKwh: Math.max(nonNegative(appliance.annualKwh), nonNegative(appliance.highKwh)) }));
  const lowHeating = input.heating ? { ...input.heating, annualKwh: Math.min(nonNegative(input.heating.annualKwh), nonNegative(input.heating.lowKwh)) } : undefined;
  const highHeating = input.heating ? { ...input.heating, annualKwh: Math.max(nonNegative(input.heating.annualKwh), nonNegative(input.heating.highKwh)) } : undefined;
  return { ...distribution, baseSubscriptionCost, baseEnergyCost, hphcSubscriptionCost, hpEnergyCost, hcEnergyCost,
    baseCost, hphcCost, delta: baseCost - hphcCost, breakEven: calculateBreakEvenShare(distribution.totalKwh, input.tariff),
    lowEstimate: estimate(lowAppliances, lowHeating), highEstimate: estimate(highAppliances, highHeating), warnings: validateSimulationInput(input, distribution) };
}
