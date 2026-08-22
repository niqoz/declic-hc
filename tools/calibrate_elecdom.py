#!/usr/bin/env python3
"""Calibre les courbes de consommation Déclic HC depuis l'open data ElecDom."""

from __future__ import annotations

import argparse
import collections
import json
import math
import random
import statistics
import urllib.request
from pathlib import Path

DATASET_URL = (
    "https://data.ademe.fr/data-fair/api/v1/datasets/"
    "elecdom-donnees-de-consommation-annuelle/lines?size=10000"
)
SOURCE_PAGE = "https://data.ademe.fr/datasets/elecdom-donnees-de-consommation-annuelle"
REFERENCE_KWH = 4500
YEARS = ("Consommation_annuelle__AN1", "Consommation_annuelle_AN2")
REQUIRED_FIELDS = {"ID_logement", "Appareil_suivi", "Type", *YEARS}

MODELS = {
    "water-heater": {
        "label": "Chauffe-eau électrique",
        "category": "Eau chaude sanitaire",
        "types": {"JOULE"},
        "resident_exponent": 0.60,
    },
    "heat-pump-water-heater": {
        "label": "Ballon thermodynamique",
        "category": "Eau chaude sanitaire",
        "types": {"CETI"},
        "resident_exponent": 0.60,
    },
    "washing-machine": {
        "label": "Lave-linge",
        "category": "Lave linge",
        "resident_exponent": 0.45,
    },
    "dishwasher": {
        "label": "Lave-vaisselle",
        "category": "Lave vaisselle",
        "resident_exponent": 0.40,
    },
    "dryer": {
        "label": "Sèche-linge",
        "category": "Sèche linge",
        "resident_exponent": 0.50,
    },
    "pool-pump": {
        "label": "Pompe de piscine",
        "category": "Piscines",
        "resident_exponent": 0.0,
    },
    "air-conditioning": {
        "label": "Climatisation fixe",
        "category": "Clim_fixe",
        "resident_exponent": 0.0,
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, help="Réponse JSON DataFair déjà téléchargée")
    parser.add_argument(
        "--typescript",
        type=Path,
        default=Path("app/simulation/calibration.generated.ts"),
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=Path("docs/elecdom-calibration.md"),
    )
    return parser.parse_args()


def load_rows(path: Path | None) -> list[dict]:
    if path:
        payload = json.loads(path.read_text(encoding="utf-8"))
    else:
        request = urllib.request.Request(DATASET_URL, headers={"User-Agent": "Declic-HC/0.4"})
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
    rows = payload.get("results")
    if not isinstance(rows, list) or not rows:
        raise ValueError("La réponse ElecDom ne contient aucune ligne")
    missing = REQUIRED_FIELDS - set().union(*(row.keys() for row in rows))
    if missing:
        raise ValueError(f"Colonnes ElecDom manquantes : {sorted(missing)}")
    return rows


def positive_number(value: object) -> float | None:
    if isinstance(value, (int, float)) and math.isfinite(value) and value > 0:
        return float(value)
    return None


def percentile(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * quantile
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def linear_fit(points: list[tuple[float, float]], residual_total: bool = False) -> dict:
    logs = []
    for total, appliance in points:
        predictor = total - appliance if residual_total else total
        if predictor > 0 and appliance > 0:
            logs.append((math.log(predictor), math.log(appliance)))
    mean_x = statistics.mean(x for x, _ in logs)
    mean_y = statistics.mean(y for _, y in logs)
    covariance = sum((x - mean_x) * (y - mean_y) for x, y in logs)
    variance_x = sum((x - mean_x) ** 2 for x, _ in logs)
    variance_y = sum((y - mean_y) ** 2 for _, y in logs)
    exponent = covariance / variance_x
    intercept = mean_y - exponent * mean_x
    r_squared = covariance**2 / (variance_x * variance_y) if variance_y else 0
    return {"exponent": exponent, "intercept": intercept, "r_squared": r_squared}


def bootstrap_ci(points: list[tuple[float, float]], residual_total: bool, seed: int) -> tuple[float, float]:
    randomizer = random.Random(seed)
    slopes = []
    for _ in range(3000):
        sample = [randomizer.choice(points) for _ in points]
        try:
            slopes.append(linear_fit(sample, residual_total)["exponent"])
        except (ZeroDivisionError, statistics.StatisticsError):
            continue
    return percentile(slopes, 0.025), percentile(slopes, 0.975)


def confidence(sample_size: int, r_squared: float, ci: tuple[float, float]) -> str:
    width = ci[1] - ci[0]
    if sample_size >= 50 and r_squared >= 0.15 and width <= 0.60:
        return "good"
    if sample_size >= 30 and width <= 1.10:
        return "medium"
    return "insufficient"


def calibrate(rows: list[dict]) -> tuple[dict, dict]:
    general: dict[tuple[str, str], float] = {}
    duplicate_general = 0
    for row in rows:
        if row.get("Appareil_suivi") != "Général":
            continue
        for year in YEARS:
            value = positive_number(row.get(year))
            if value is None:
                continue
            key = (str(row["ID_logement"]), year)
            if key in general:
                duplicate_general += 1
            general[key] = value

    calibrations = {}
    quality = {
        "rows": len(rows),
        "households": len({str(row["ID_logement"]) for row in rows}),
        "generalObservations": len(general),
        "duplicateGeneralObservations": duplicate_general,
        "models": {},
    }

    for index, (model_id, definition) in enumerate(MODELS.items()):
        by_household_year: dict[tuple[str, str], float] = collections.defaultdict(float)
        for row in rows:
            if row.get("Appareil_suivi") != definition["category"]:
                continue
            allowed_types = definition.get("types")
            if allowed_types and row.get("Type") not in allowed_types:
                continue
            for year in YEARS:
                value = positive_number(row.get(year))
                if value is not None:
                    by_household_year[(str(row["ID_logement"]), year)] += value

        matched: dict[str, list[tuple[float, float]]] = collections.defaultdict(list)
        excluded_above_total = 0
        for key, appliance in by_household_year.items():
            total = general.get(key)
            if total is None:
                continue
            if appliance > total:
                excluded_above_total += 1
                continue
            matched[key[0]].append((total, appliance))

        points = [
            (
                statistics.mean(total for total, _ in observations),
                statistics.mean(appliance for _, appliance in observations),
            )
            for observations in matched.values()
        ]
        if len(points) < 3:
            continue

        total_fit = linear_fit(points)
        residual_fit = linear_fit(points, residual_total=True)
        total_ci = bootstrap_ci(points, False, 7000 + index)
        residual_ci = bootstrap_ci(points, True, 9000 + index)
        normalized = [
            appliance * (REFERENCE_KWH / total) ** total_fit["exponent"]
            for total, appliance in points
        ]
        level = confidence(len(points), total_fit["r_squared"], total_ci)
        central = math.exp(
            total_fit["intercept"] + total_fit["exponent"] * math.log(REFERENCE_KWH)
        )
        calibrations[model_id] = {
            "label": definition["label"],
            "category": definition["category"],
            "sampleSize": len(points),
            "excludedObservations": excluded_above_total,
            "referenceHouseholdKwh": REFERENCE_KWH,
            "referenceAnnualKwh": round(central),
            "lowAnnualKwh": round(percentile(normalized, 0.10)),
            "highAnnualKwh": round(percentile(normalized, 0.90)),
            "descriptiveExponent": round(total_fit["exponent"], 3),
            "descriptiveExponentCi95": [round(total_ci[0], 3), round(total_ci[1], 3)],
            "householdExponent": round(max(0, residual_fit["exponent"]), 3),
            "householdExponentCi95": [round(residual_ci[0], 3), round(residual_ci[1], 3)],
            "residentExponent": definition["resident_exponent"],
            "residentCalibrated": False,
            "rSquared": round(total_fit["r_squared"], 3),
            "confidence": level,
            "sourceUrl": SOURCE_PAGE,
            "dataUpdated": "2022-03-04",
        }
        quality["models"][model_id] = {
            "sampleSize": len(points),
            "excludedAboveTotal": excluded_above_total,
            "confidence": level,
        }

    calibrations["electric-vehicle"] = {
        "label": "Véhicule électrique",
        "category": "Mobilité_électrique",
        "sampleSize": 0,
        "excludedObservations": 0,
        "referenceHouseholdKwh": REFERENCE_KWH,
        "referenceAnnualKwh": 2000,
        "lowAnnualKwh": 1000,
        "highAnnualKwh": 3000,
        "descriptiveExponent": 0,
        "descriptiveExponentCi95": [0, 0],
        "householdExponent": 0,
        "householdExponentCi95": [0, 0],
        "residentExponent": 0,
        "residentCalibrated": False,
        "rSquared": 0,
        "confidence": "insufficient",
        "sourceUrl": SOURCE_PAGE,
        "dataUpdated": "2022-03-04",
        "note": "Le fichier ouvert ne contient que vélos et trottinettes électriques, pas de voiture.",
    }
    return calibrations, quality


def render_typescript(calibrations: dict, quality: dict) -> str:
    payload = json.dumps(calibrations, ensure_ascii=False, indent=2)
    quality_payload = json.dumps(quality, ensure_ascii=False, indent=2)
    return (
        "// Fichier généré par tools/calibrate_elecdom.py — ne pas modifier à la main.\n"
        f"export const ELECDOM_CALIBRATIONS = {payload} as const;\n\n"
        f"export const ELECDOM_DATA_QUALITY = {quality_payload} as const;\n"
    )


def render_report(calibrations: dict, quality: dict) -> str:
    labels = {"good": "bon", "medium": "moyen", "insufficient": "insuffisant"}
    lines = [
        "# Calibration ElecDom de Déclic HC",
        "",
        f"Source : {SOURCE_PAGE}",
        "",
        f"- {quality['rows']} lignes contrôlées",
        f"- {quality['households']} identifiants de logements",
        f"- {quality['generalObservations']} observations annuelles générales",
        f"- {quality['duplicateGeneralObservations']} doublon au grain logement-année",
        "",
        "| Modèle | Logements | Référence | Exposant descriptif | R² | Confiance |",
        "|---|---:|---:|---:|---:|---|",
    ]
    for calibration in calibrations.values():
        lines.append(
            f"| {calibration['label']} | {calibration['sampleSize']} | "
            f"{calibration['referenceAnnualKwh']} kWh/an | "
            f"{calibration['descriptiveExponent']:.3f} | "
            f"{calibration['rSquared']:.3f} | {labels[calibration['confidence']]} |"
        )
    lines += [
        "",
        "## Méthode",
        "",
        "Les appareils sont additionnés au grain logement-année, appariés à la mesure « Général », "
        "puis moyennés par logement. La courbe est ajustée en log-log. Les observations où un poste "
        "dépasse le total du logement sont exclues. Les intervalles à 95 % reposent sur 3 000 "
        "rééchantillonnages bootstrap.",
        "",
        "Deux exposants sont publiés. Celui ajusté contre la consommation totale du logement reste descriptif. Celui ajusté contre le reste du foyer (`Général - appareil`), qui limite la corrélation mécanique, est celui qu’applique la PWA : il redimensionne la valeur de référence d’un appareil selon la consommation annuelle du foyer. Pour ne pas compter deux fois l’agrandissement du foyer, il s’applique à la consommation par habitant, la correction démographique traduisant à part le changement de taille. Ainsi, si consommation et habitants doublent ensemble, seule la correction démographique joue. Cette dernière reste une hypothèse pédagogique : le fichier ouvert ne fournit pas le nombre d’habitants par logement.",
        "",
        "## Règles de diffusion",
        "",
        "- Bon : coefficient affichable comme calibré avec sa fourchette.",
        "- Moyen : utilisable avec une réserve visible.",
        "- Insuffisant : valeur indicative ou saisie manuelle recommandée.",
    ]
    return "\n".join(lines) + "\n"


def main() -> None:
    args = parse_args()
    calibrations, quality = calibrate(load_rows(args.input))
    args.typescript.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.typescript.write_text(render_typescript(calibrations, quality), encoding="utf-8")
    args.report.write_text(render_report(calibrations, quality), encoding="utf-8")
    print(json.dumps(quality, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
