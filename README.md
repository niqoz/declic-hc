# Déclic HC

PWA pédagogique pour comparer le Tarif Bleu Base et l’option Heures Pleines / Heures Creuses d’EDF Corse selon la consommation et les usages opportunistes d’un foyer.

La grille par défaut reprend le Tarif Bleu résidentiel TTC EDF Corse au 1er août 2026. En Corse l’abonnement annuel est identique dans les deux options : le point d’équilibre ne dépend donc que du prix du kWh, pas de la consommation. Au-delà de 6 kVA, l’option Base est en extinction et l’interface le signale.

## Développement

Prérequis : Node.js 22.13 ou plus récent.

```bash
npm install
npm run dev
npm test
npm run build:pages
```

## Calibration ElecDom — lot 3

Les modèles du chauffe-eau électrique, du lave-linge, du lave-vaisselle et du sèche-linge sont calibrés à partir du [jeu de données annuel ElecDom de l’ADEME](https://data.ademe.fr/datasets/elecdom-donnees-de-consommation-annuelle).

```bash
npm run calibrate:elecdom
```

Cette commande :

- télécharge les 2 263 observations ouvertes ;
- contrôle le grain logement-année et les incohérences ;
- agrège les appareils d’une même catégorie par logement ;
- ajuste une courbe log-log et calcule un intervalle à 95 % par bootstrap ;
- génère `app/simulation/calibration.generated.ts` utilisé par la PWA ;
- génère le rapport méthodologique `docs/elecdom-calibration.md`.

Les modèles reposant sur moins de 30 logements restent marqués « fiabilité insuffisante » et ne reçoivent pas de coefficient automatique. La correction selon le nombre d’habitants est volontairement signalée comme indicative, cette variable n’étant pas publiée par logement dans le fichier ouvert ; elle est sous-linéaire, avec un exposant propre à chaque usage.

La répartition HP/HC conserve par hypothèse 100 % des usages flexibles sélectionnés en heures creuses. La climatisation estivale constitue l’exception : elle suit un usage diurne dépendant de la présence du foyer. Le chauffage, qui ne dispose pas d’un réglage d’accumulation, n’est compté en HC que pour les besoins ayant naturellement lieu pendant la plage tarifaire de huit heures ; ces besoins sont pondérés par l’écart entre la consigne et une température extérieure journalière, ce qui donne aux heures nocturnes le poids que leur froideur leur confère. Les estimations basse et haute alimentent une fourchette de facture distincte du scénario central.

La méthode complète et ses dates de référence sont décrites dans [`docs/modele-foyer.md`](docs/modele-foyer.md).

## Publication

- `npm run build:pages` produit la version statique GitHub Pages dans `dist-pages`.
- Le workflow `.github/workflows/pages.yml` publie cette version sur GitHub Pages à chaque envoi sur `main`.
- Le dépôt GitHub est l’unique cible de publication du projet.
- Le numéro de version doit rester identique dans `app/version.ts`, `package.json`, le manifeste PWA et le cache du service worker ; un test vérifie ce contrat.
