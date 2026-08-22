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
