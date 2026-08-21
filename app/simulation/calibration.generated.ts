// Fichier généré par tools/calibrate_elecdom.py — ne pas modifier à la main.
export const ELECDOM_CALIBRATIONS = {
  "water-heater": {
    "label": "Chauffe-eau électrique",
    "category": "Eau chaude sanitaire",
    "sampleSize": 55,
    "excludedObservations": 0,
    "referenceHouseholdKwh": 4500,
    "referenceAnnualKwh": 1294,
    "lowAnnualKwh": 699,
    "highAnnualKwh": 2250,
    "descriptiveExponent": 0.572,
    "descriptiveExponentCi95": [
      0.358,
      0.807
    ],
    "householdExponent": 0.297,
    "householdExponentCi95": [
      0.122,
      0.488
    ],
    "residentExponent": 0.6,
    "residentCalibrated": false,
    "rSquared": 0.362,
    "confidence": "good",
    "sourceUrl": "https://data.ademe.fr/datasets/elecdom-donnees-de-consommation-annuelle",
    "dataUpdated": "2022-03-04"
  },
  "heat-pump-water-heater": {
    "label": "Ballon thermodynamique",
    "category": "Eau chaude sanitaire",
    "sampleSize": 6,
    "excludedObservations": 0,
    "referenceHouseholdKwh": 4500,
    "referenceAnnualKwh": 658,
    "lowAnnualKwh": 538,
    "highAnnualKwh": 851,
    "descriptiveExponent": 0.568,
    "descriptiveExponentCi95": [
      0.096,
      1.101
    ],
    "householdExponent": 0.503,
    "householdExponentCi95": [
      0.03,
      1.134
    ],
    "residentExponent": 0.6,
    "residentCalibrated": false,
    "rSquared": 0.645,
    "confidence": "insufficient",
    "sourceUrl": "https://data.ademe.fr/datasets/elecdom-donnees-de-consommation-annuelle",
    "dataUpdated": "2022-03-04"
  },
  "washing-machine": {
    "label": "Lave-linge",
    "category": "Lave linge",
    "sampleSize": 119,
    "excludedObservations": 0,
    "referenceHouseholdKwh": 4500,
    "referenceAnnualKwh": 85,
    "lowAnnualKwh": 35,
    "highAnnualKwh": 198,
    "descriptiveExponent": 0.472,
    "descriptiveExponentCi95": [
      0.302,
      0.638
    ],
    "householdExponent": 0.443,
    "householdExponentCi95": [
      0.273,
      0.612
    ],
    "residentExponent": 0.45,
    "residentCalibrated": false,
    "rSquared": 0.209,
    "confidence": "good",
    "sourceUrl": "https://data.ademe.fr/datasets/elecdom-donnees-de-consommation-annuelle",
    "dataUpdated": "2022-03-04"
  },
  "dishwasher": {
    "label": "Lave-vaisselle",
    "category": "Lave vaisselle",
    "sampleSize": 89,
    "excludedObservations": 0,
    "referenceHouseholdKwh": 4500,
    "referenceAnnualKwh": 134,
    "lowAnnualKwh": 63,
    "highAnnualKwh": 281,
    "descriptiveExponent": 0.391,
    "descriptiveExponentCi95": [
      0.212,
      0.596
    ],
    "householdExponent": 0.352,
    "householdExponentCi95": [
      0.179,
      0.535
    ],
    "residentExponent": 0.4,
    "residentCalibrated": false,
    "rSquared": 0.158,
    "confidence": "good",
    "sourceUrl": "https://data.ademe.fr/datasets/elecdom-donnees-de-consommation-annuelle",
    "dataUpdated": "2022-03-04"
  },
  "dryer": {
    "label": "Sèche-linge",
    "category": "Sèche linge",
    "sampleSize": 33,
    "excludedObservations": 0,
    "referenceHouseholdKwh": 4500,
    "referenceAnnualKwh": 174,
    "lowAnnualKwh": 50,
    "highAnnualKwh": 436,
    "descriptiveExponent": 0.637,
    "descriptiveExponentCi95": [
      0.214,
      1.052
    ],
    "householdExponent": 0.561,
    "householdExponentCi95": [
      0.118,
      0.948
    ],
    "residentExponent": 0.5,
    "residentCalibrated": false,
    "rSquared": 0.168,
    "confidence": "medium",
    "sourceUrl": "https://data.ademe.fr/datasets/elecdom-donnees-de-consommation-annuelle",
    "dataUpdated": "2022-03-04"
  },
  "pool-pump": {
    "label": "Pompe de piscine",
    "category": "Piscines",
    "sampleSize": 11,
    "excludedObservations": 1,
    "referenceHouseholdKwh": 4500,
    "referenceAnnualKwh": 220,
    "lowAnnualKwh": 82,
    "highAnnualKwh": 899,
    "descriptiveExponent": 1.685,
    "descriptiveExponentCi95": [
      -0.23,
      3.213
    ],
    "householdExponent": 0.564,
    "householdExponentCi95": [
      -0.923,
      3.149
    ],
    "residentExponent": 0.0,
    "residentCalibrated": false,
    "rSquared": 0.282,
    "confidence": "insufficient",
    "sourceUrl": "https://data.ademe.fr/datasets/elecdom-donnees-de-consommation-annuelle",
    "dataUpdated": "2022-03-04"
  },
  "air-conditioning": {
    "label": "Climatisation fixe",
    "category": "Clim_fixe",
    "sampleSize": 8,
    "excludedObservations": 0,
    "referenceHouseholdKwh": 4500,
    "referenceAnnualKwh": 153,
    "lowAnnualKwh": 105,
    "highAnnualKwh": 239,
    "descriptiveExponent": 1.486,
    "descriptiveExponentCi95": [
      0.76,
      2.317
    ],
    "householdExponent": 1.484,
    "householdExponentCi95": [
      0.723,
      2.502
    ],
    "residentExponent": 0.0,
    "residentCalibrated": false,
    "rSquared": 0.78,
    "confidence": "insufficient",
    "sourceUrl": "https://data.ademe.fr/datasets/elecdom-donnees-de-consommation-annuelle",
    "dataUpdated": "2022-03-04"
  },
  "electric-vehicle": {
    "label": "Véhicule électrique",
    "category": "Mobilité_électrique",
    "sampleSize": 0,
    "excludedObservations": 0,
    "referenceHouseholdKwh": 4500,
    "referenceAnnualKwh": 2000,
    "lowAnnualKwh": 1000,
    "highAnnualKwh": 3000,
    "descriptiveExponent": 0,
    "descriptiveExponentCi95": [
      0,
      0
    ],
    "householdExponent": 0,
    "householdExponentCi95": [
      0,
      0
    ],
    "residentExponent": 0,
    "residentCalibrated": false,
    "rSquared": 0,
    "confidence": "insufficient",
    "sourceUrl": "https://data.ademe.fr/datasets/elecdom-donnees-de-consommation-annuelle",
    "dataUpdated": "2022-03-04",
    "note": "Le fichier ouvert ne contient que vélos et trottinettes électriques, pas de voiture."
  }
} as const;

export const ELECDOM_DATA_QUALITY = {
  "rows": 2263,
  "households": 120,
  "generalObservations": 201,
  "duplicateGeneralObservations": 0,
  "models": {
    "water-heater": {
      "sampleSize": 55,
      "excludedAboveTotal": 0,
      "confidence": "good"
    },
    "heat-pump-water-heater": {
      "sampleSize": 6,
      "excludedAboveTotal": 0,
      "confidence": "insufficient"
    },
    "washing-machine": {
      "sampleSize": 119,
      "excludedAboveTotal": 0,
      "confidence": "good"
    },
    "dishwasher": {
      "sampleSize": 89,
      "excludedAboveTotal": 0,
      "confidence": "good"
    },
    "dryer": {
      "sampleSize": 33,
      "excludedAboveTotal": 0,
      "confidence": "medium"
    },
    "pool-pump": {
      "sampleSize": 11,
      "excludedAboveTotal": 1,
      "confidence": "insufficient"
    },
    "air-conditioning": {
      "sampleSize": 8,
      "excludedAboveTotal": 0,
      "confidence": "insufficient"
    }
  }
} as const;
