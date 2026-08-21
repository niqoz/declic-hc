import { clamp } from "./calculate.js";
import type { HeatingEstimate, HeatingSettings, OccupancyProfile, OffPeakWindow } from "./types.js";

// Hypothèses pédagogiques H3 à recalibrer sur les DPE corses : besoin électrique
// direct central par m², avant correction logement, altitude et présence.
const DIRECT_HEATING_KWH_M2 = { good: 35, standard: 60, poor: 95 } as const;
const DWELLING_FACTOR = { apartment: 0.82, house: 1.12 } as const;
const ALTITUDE_FACTOR = { low: 1, medium: 1.22, high: 1.48 } as const;
const HEAT_PUMP_SCOP = 2.9;
const ECO_DEMAND_RATIO = 7 / 9; // 17 °C au lieu de 19 °C pour 10 °C extérieurs.

const timeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

const isOffPeak = (minute: number, window: OffPeakWindow) => {
  const start = timeToMinutes(window.start);
  const end = timeToMinutes(window.end);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
};

const isComfortPeriod = (profile: OccupancyProfile, weekday: number, minute: number) => {
  const daytime = minute >= 6 * 60 && minute < 23 * 60;
  if (!daytime) return false;
  const weekend = weekday >= 5;
  if (weekend || profile === "home") return true;
  if (profile === "mixed" && weekday < 2) return true;
  return (minute >= 6 * 60 && minute < 8 * 60) || (minute >= 17 * 60 && minute < 23 * 60);
};

function computeHeatingDemand(profile: OccupancyProfile, window: OffPeakWindow) {
  const shiftableFraction: Record<OccupancyProfile, number> = {
    away: 0.80,
    mixed: 0.55,
    home: 0.35,
  };
  const shift = shiftableFraction[profile];
  let comfortPeak = 0;
  let comfortOffPeak = 0;
  let ecoOffPeak = 0;
  let ecoPeak = 0;
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let minute = 0; minute < 1440; minute += 10) {
      const comfort = isComfortPeriod(profile, weekday, minute);
      const offPeak = isOffPeak(minute, window);
      if (comfort) {
        if (offPeak) comfortOffPeak++;
        else comfortPeak++;
      } else if (offPeak) ecoOffPeak += ECO_DEMAND_RATIO;
      else ecoPeak += ECO_DEMAND_RATIO;
    }
  }
  const total = comfortPeak + comfortOffPeak + ecoPeak + ecoOffPeak;
  const offPeak = comfortOffPeak + comfortPeak * shift + ecoOffPeak;
  return { total, offPeak };
}

export function estimateHeating(settings: HeatingSettings, window: OffPeakWindow): HeatingEstimate {
  if (!settings.enabled) return { annualKwh: 0, lowKwh: 0, highKwh: 0, hcShare: 0 };
  const surface = clamp(settings.surfaceM2, 10, 400);
  const profileDemand = computeHeatingDemand(settings.occupancy, window);
  const referenceDemand = computeHeatingDemand("mixed", window).total;
  const occupancyFactor = profileDemand.total / referenceDemand;
  const systemEfficiency = settings.system === "heat-pump" ? HEAT_PUMP_SCOP : 1;
  const annualKwh = surface
    * DIRECT_HEATING_KWH_M2[settings.insulation]
    * DWELLING_FACTOR[settings.dwellingType]
    * ALTITUDE_FACTOR[settings.altitude]
    * occupancyFactor
    / systemEfficiency;
  const hcShare = profileDemand.total > 0 ? profileDemand.offPeak / profileDemand.total * 100 : 0;
  return {
    annualKwh,
    lowKwh: annualKwh * 0.65,
    highKwh: annualKwh * 1.45,
    hcShare,
  };
}
