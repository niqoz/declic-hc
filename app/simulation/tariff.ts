export type BaseOptionAvailability =
  | { status: "available" }
  | { status: "closed"; since: string }
  | { status: "removed"; on: string };

const CLOSED_SINCE = "1er février 2026";
const REMOVED_ON = "1er février 2027";
// Grille EDF Corse du 1er août 2026 : l'option Base est en extinction au-delà de
// 6 kVA. Fermée à la souscription depuis le 1er février 2026 pour 9 à 15 kVA,
// supprimée le 1er février 2027 pour 18 à 36 kVA. L'option HP/HC reste ouverte
// sur toute la grille. Hors de cette grille, aucune extinction n'est connue.
const HIGHEST_RESIDENTIAL_POWER = 36;

export function baseOptionAvailability(power: number): BaseOptionAvailability {
  if (!Number.isFinite(power) || power <= 6 || power > HIGHEST_RESIDENTIAL_POWER) return { status: "available" };
  if (power <= 15) return { status: "closed", since: CLOSED_SINCE };
  return { status: "removed", on: REMOVED_ON };
}

export function baseOptionNotice(power: number): string | null {
  const availability = baseOptionAvailability(power);
  if (availability.status === "available") return null;
  if (availability.status === "closed") {
    return `À ${power} kVA, l’option Base n’est plus souscriptible depuis le ${availability.since}. La comparaison ci-dessous ne vaut que si vous en bénéficiez déjà.`;
  }
  return `À ${power} kVA, l’option Base est en extinction et disparaît le ${availability.on}. Elle n’est plus souscriptible et ne pourra pas être conservée au-delà.`;
}

export const TARIFF_GRID_REFERENCE_ISO = "2026-08-01";
export const TARIFF_GRID_LABEL = "1er août 2026";
// Les tarifs réglementés sont révisés au 1er février et au 1er août. Une grille
// est donc normalement remplacée au bout de six mois ; on laisse un mois de
// battement avant de la signaler comme dépassée.
const STALE_AFTER_MONTHS = 7;

export type TariffGridFreshness = { status: "current" | "stale"; months: number };

export function tariffGridAgeMonths(now: Date, referenceIso: string = TARIFF_GRID_REFERENCE_ISO) {
  const [year, month, day] = referenceIso.split("-").map(Number);
  const months = (now.getFullYear() - year) * 12 + (now.getMonth() - (month - 1));
  return Math.max(0, now.getDate() < day ? months - 1 : months);
}

export function tariffGridFreshness(now: Date, referenceIso: string = TARIFF_GRID_REFERENCE_ISO): TariffGridFreshness {
  const months = tariffGridAgeMonths(now, referenceIso);
  return { status: months >= STALE_AFTER_MONTHS ? "stale" : "current", months };
}

export function tariffGridNotice(now: Date, referenceIso: string = TARIFF_GRID_REFERENCE_ISO): string | null {
  const { status, months } = tariffGridFreshness(now, referenceIso);
  if (status === "current") return null;
  return `La grille de référence date du ${TARIFF_GRID_LABEL}, il y a ${months} mois. Les tarifs réglementés sont révisés au 1er février et au 1er août : comparez les prix à votre facture avant de décider.`;
}
