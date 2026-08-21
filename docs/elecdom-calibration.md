# Calibration ElecDom de Déclic HC

Source : https://data.ademe.fr/datasets/elecdom-donnees-de-consommation-annuelle

- 2263 lignes contrôlées
- 120 identifiants de logements
- 201 observations annuelles générales
- 0 doublon au grain logement-année

| Modèle | Logements | Référence | Exposant descriptif | R² | Confiance |
|---|---:|---:|---:|---:|---|
| Chauffe-eau électrique | 55 | 1294 kWh/an | 0.572 | 0.362 | bon |
| Ballon thermodynamique | 6 | 658 kWh/an | 0.568 | 0.645 | insuffisant |
| Lave-linge | 119 | 85 kWh/an | 0.472 | 0.209 | bon |
| Lave-vaisselle | 89 | 134 kWh/an | 0.391 | 0.158 | bon |
| Sèche-linge | 33 | 174 kWh/an | 0.637 | 0.168 | moyen |
| Pompe de piscine | 11 | 220 kWh/an | 1.685 | 0.282 | insuffisant |
| Climatisation fixe | 8 | 153 kWh/an | 1.486 | 0.780 | insuffisant |
| Véhicule électrique | 0 | 2000 kWh/an | 0.000 | 0.000 | insuffisant |

## Méthode

Les appareils sont additionnés au grain logement-année, appariés à la mesure « Général », puis moyennés par logement. La courbe est ajustée en log-log. Les observations où un poste dépasse le total du logement sont exclues. Les intervalles à 95 % reposent sur 3 000 rééchantillonnages bootstrap.

L’exposant utilisé dans la PWA est aussi calculé contre le reste du foyer (`Général - appareil`) afin de limiter la corrélation mécanique. La correction selon le nombre d’habitants reste une hypothèse pédagogique : le fichier ouvert ne fournit pas cette variable par logement.

## Règles de diffusion

- Bon : coefficient affichable comme calibré avec sa fourchette.
- Moyen : utilisable avec une réserve visible.
- Insuffisant : valeur indicative ou saisie manuelle recommandée.
