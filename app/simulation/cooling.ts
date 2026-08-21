import { isMinuteOffPeak } from "./heating.js";
import type { OccupancyProfile, OffPeakWindow } from "./types.js";

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
  let totalPeriods = 0;
  let offPeakPeriods = 0;
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let minute = 0; minute < 1440; minute += 10) {
      if (!isCoolingPeriod(profile, weekday, minute)) continue;
      totalPeriods++;
      if (isMinuteOffPeak(minute, window)) offPeakPeriods++;
    }
  }
  return totalPeriods > 0 ? offPeakPeriods / totalPeriods * 100 : 0;
}
