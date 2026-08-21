import { ELECDOM_CALIBRATIONS, ELECDOM_DATA_QUALITY } from "./calibration.generated.js";

export type CalibrationConfidence = "good" | "medium" | "insufficient";

export type ApplianceCalibration = {
  label: string;
  category: string;
  sampleSize: number;
  excludedObservations: number;
  referenceHouseholdKwh: number;
  referenceAnnualKwh: number;
  lowAnnualKwh: number;
  highAnnualKwh: number;
  descriptiveExponent: number;
  descriptiveExponentCi95: readonly [number, number];
  householdExponent: number;
  householdExponentCi95: readonly [number, number];
  residentExponent: number;
  residentCalibrated: boolean;
  rSquared: number;
  confidence: CalibrationConfidence;
  sourceUrl: string;
  dataUpdated: string;
  note?: string;
};

const CALIBRATIONS = ELECDOM_CALIBRATIONS as Record<string, ApplianceCalibration>;

export function getApplianceCalibration(type: string) {
  return CALIBRATIONS[type];
}

export function confidenceLabel(confidence: CalibrationConfidence) {
  if (confidence === "good") return "bonne";
  if (confidence === "medium") return "moyenne";
  return "insuffisante";
}

export { ELECDOM_DATA_QUALITY };
