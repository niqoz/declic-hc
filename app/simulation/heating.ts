import { clamp } from "./calculate.js";
import type { AltitudeBand, HeatingEstimate, HeatingSettings, OccupancyProfile, OffPeakWindow } from "./types.js";

// Hypothèses pédagogiques H3 à recalibrer sur les DPE corses : besoin électrique
// direct central par m², avant correction logement, altitude et présence.
const DIRECT_HEATING_KWH_M2 = { good: 35, standard: 60, poor: 95 } as const;
const DWELLING_FACTOR = { apartment: 0.82, house: 1.12 } as const;
const ALTITUDE_FACTOR = { low: 1, medium: 1.22, high: 1.48 } as const;
// SCOP d'une pompe à chaleur ou d'une climatisation réversible récente en zone
// H3, où la température extérieure de la saison de chauffe reste douce.
export const HEAT_PUMP_SCOP = 3.6;

// Incertitude du poste de chauffage, appliquée aussi bien à l'estimation du
// modèle qu'à la quantité retenue dans la facture : personne ne connaît sa
// consommation de chauffage à mieux que cet ordre de grandeur.
export const HEATING_LOW_RATIO = 0.65;
export const HEATING_HIGH_RATIO = 1.45;

// Profil standardisé : 19 °C en confort, 17 °C la nuit et 16 °C pendant les
// absences de journée. Le réduit de nuit reste modéré, la remise en confort du
// matin devant rester courte ; une absence de journée autorise un réduit plus
// profond, ce que fait tout programmateur d'ambiance.
const COMFORT_SETPOINT_C = 19;
const NIGHT_SETBACK_C = 17;
const ABSENCE_SETBACK_C = 16;
// Journée type de la saison de chauffe, en °C : sinusoïde de moyenne dépendante
// de l'altitude, minimale à 5 h et maximale à 17 h. Le besoin instantané est
// proportionnel à l'écart entre la consigne et cette température extérieure, ce
// qui rend aux heures nocturnes le poids que leur froideur leur donne.
const WINTER_MEAN_OUTDOOR_C = { low: 10, medium: 7, high: 4 } as const;
const WINTER_DAILY_SWING_C = 4;
const COLDEST_MINUTE = 5 * 60;

const timeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

const minutesToTime = (value: number) => {
  const normalized = (value % 1440 + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
};

export const offPeakDurationMinutes = ({ start, end }: OffPeakWindow) => (
  timeToMinutes(end) - timeToMinutes(start) + 1440
) % 1440;

export const isValidOffPeakWindow = (window: OffPeakWindow) => offPeakDurationMinutes(window) === 8 * 60;

export function updateOffPeakWindowTime(window: OffPeakWindow, field: "start" | "end", value: string): OffPeakWindow {
  const minute = timeToMinutes(value);
  return field === "start"
    ? { ...window, start: value, end: minutesToTime(minute + 8 * 60) }
    : { ...window, start: minutesToTime(minute - 8 * 60), end: value };
}

export const isMinuteOffPeak = (minute: number, window: OffPeakWindow) => {
  if (!isValidOffPeakWindow(window)) return false;
  const start = timeToMinutes(window.start);
  const end = timeToMinutes(window.end);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
};

const setpointAt = (profile: OccupancyProfile, weekday: number, minute: number) => {
  const daytime = minute >= 6 * 60 && minute < 23 * 60;
  if (!daytime) return NIGHT_SETBACK_C;
  const weekend = weekday >= 5;
  if (weekend || profile === "home") return COMFORT_SETPOINT_C;
  if (profile === "mixed" && weekday < 2) return COMFORT_SETPOINT_C;
  const present = (minute >= 6 * 60 && minute < 8 * 60) || (minute >= 17 * 60 && minute < 23 * 60);
  return present ? COMFORT_SETPOINT_C : ABSENCE_SETBACK_C;
};

export const outdoorTemperature = (minute: number, altitude: AltitudeBand) => (
  WINTER_MEAN_OUTDOOR_C[altitude] - WINTER_DAILY_SWING_C * Math.cos(2 * Math.PI * (minute - COLDEST_MINUTE) / 1440)
);

function computeHeatingDemand(profile: OccupancyProfile, window: OffPeakWindow, altitude: AltitudeBand) {
  let total = 0;
  let offPeak = 0;
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let minute = 0; minute < 1440; minute += 10) {
      const demand = Math.max(0, setpointAt(profile, weekday, minute) - outdoorTemperature(minute, altitude));
      total += demand;
      // Sans équipement d'accumulation déclaré, le chauffage n'est compté en HC
      // que lorsqu'il fonctionne naturellement pendant la plage tarifaire.
      if (isMinuteOffPeak(minute, window)) offPeak += demand;
    }
  }
  return { total, offPeak };
}

export function estimateHeating(settings: HeatingSettings, window: OffPeakWindow): HeatingEstimate {
  if (!settings.enabled) return { annualKwh: 0, lowKwh: 0, highKwh: 0, hcShare: 0 };
  const surface = clamp(settings.surfaceM2, 10, 400);
  const profileDemand = computeHeatingDemand(settings.occupancy, window, settings.altitude);
  // L'altitude se simplifie dans ce rapport : elle ne pèse sur l'ampleur du
  // besoin qu'une seule fois, par ALTITUDE_FACTOR.
  const referenceDemand = computeHeatingDemand("mixed", window, settings.altitude).total;
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
    lowKwh: annualKwh * HEATING_LOW_RATIO,
    highKwh: annualKwh * HEATING_HIGH_RATIO,
    hcShare,
  };
}
