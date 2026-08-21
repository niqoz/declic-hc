# Déclic HC

PWA pédagogique pour comparer le Tarif Bleu Base et l’option Heures Pleines / Heures Creuses d’EDF Corse selon la consommation et les usages opportunistes d’un foyer.

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

Les modèles reposant sur moins de 30 logements restent marqués « fiabilité insuffisante » et ne reçoivent pas de coefficient automatique. La correction selon le nombre d’habitants est volontairement signalée comme indicative, cette variable n’étant pas publiée par logement dans le fichier ouvert.

## Publication

- `npm run build:pages` produit la version statique GitHub Pages dans `dist-pages`.
- `npm run build` produit la version Vinext destinée à l’hébergement Sites.
- Le numéro de version doit rester identique dans `app/version.ts`, `package.json`, le manifeste PWA et le cache du service worker ; un test vérifie ce contrat.
