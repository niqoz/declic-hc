import { isMinuteOffPeak } from "./heating.js";
import type { InsulationLevel, OccupancyProfile, OffPeakWindow } from "./types.js";

// Le besoin de froid dépend du logement comme le besoin de chaud, mais moins
// nettement : la climatisation n'équipe en général qu'une partie des pièces, et
// l'isolation limite les apports d'été moins qu'elle ne limite les déperditions
// d'hiver. Convention pédagogique interne, référence 80 m² en isolation standard.
export const REFERENCE_COOLED_SURFACE_M2 = 80;
const COOLING_SURFACE_EXPONENT = 0.5;
const COOLING_INSULATION_FACTOR = { good: 0.8, standard: 1, poor: 1.25 } as const;

export type CooledDwelling = { surfaceM2: number; insulation: InsulationLevel };

const REFERENCE_DWELLING: CooledDwelling = { surfaceM2: REFERENCE_COOLED_SURFACE_M2, insulation: "standard" };

export function coolingDwellingFactor({ surfaceM2, insulation }: CooledDwelling) {
  const surface = Number.isFinite(surfaceM2) ? Math.min(400, Math.max(10, surfaceM2)) : REFERENCE_COOLED_SURFACE_M2;
  return (surface / REFERENCE_COOLED_SURFACE_M2) ** COOLING_SURFACE_EXPONENT
    * (COOLING_INSULATION_FACTOR[insulation] ?? 1);
}

const COOLING_START_MINUTE = 12 * 60;
const COOLING_END_MINUTE = 22 * 60;
const WEEKDAY_RETURN_MINUTE = 17 * 60;

function isCoolingPeriod(profile: OccupancyProfile, weekday: number, minute: number) {
  if (minute < COOLING_START_MINUTE || minute >= COOLING_END_MINUTE) return false;
  const weekend = weekday >= 5;
  if (weekend || profile === "home") return true;
  if (profile === "mixed" && weekday < 2) return true;
  return minute >= WEEKDAY_RETURN_MINUTE;
}

export function estimateCoolingHcShare(profile: OccupancyProfile, window: OffPeakWindow) {
  return estimateCoolingProfile(profile, window).hcShare;
}

export function estimateCoolingProfile(
  profile: OccupancyProfile,
  window: OffPeakWindow,
  dwelling: CooledDwelling = REFERENCE_DWELLING,
) {
  let totalPeriods = 0;
  let offPeakPeriods = 0;
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let minute = 0; minute < 1440; minute += 10) {
      if (!isCoolingPeriod(profile, weekday, minute)) continue;
      totalPeriods++;
      if (isMinuteOffPeak(minute, window)) offPeakPeriods++;
    }
  }
  let mixedPeriods = 0;
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let minute = 0; minute < 1440; minute += 10) {
      if (isCoolingPeriod("mixed", weekday, minute)) mixedPeriods++;
    }
  }
  const occupancyFactor = mixedPeriods > 0 ? totalPeriods / mixedPeriods : 1;
  return {
    hcShare: totalPeriods > 0 ? offPeakPeriods / totalPeriods * 100 : 0,
    demandFactor: occupancyFactor * coolingDwellingFactor(dwelling),
  };
}
