# AGENTS.md

Ce fichier fournit les consignes de travail aux agents qui interviennent sur ce dépôt.
Elles s'appliquent à l'ensemble du projet.

## Projet

Déclic HC est une PWA pédagogique en français qui compare le Tarif Bleu Base et
l'option Heures Pleines / Heures Creuses d'EDF Corse. L'interface est écrite en
React/TypeScript. La version publiée est une application statique construite par
Vite et hébergée sur GitHub Pages.

## Environnement et commandes

- Utiliser Node.js 22.13.0 ou une version plus récente de Node.js 22.
- Sur une nouvelle machine, installer les dépendances avec `npm ci`.
- Lancer le développement avec `npm run dev`.
- Lancer les tests avec `npm test`.
- Lancer le lint avec `npm run lint`.
- Vérifier la version publiée avec `npm run build:pages`.
- `npm run build` est un alias de `npm run build:pages`.
- La calibration ElecDom nécessite Python 3 et un accès réseau ; ne lancer
  `npm run calibrate:elecdom` que lorsqu'une régénération des données est voulue.

Avant de terminer une modification de code, exécuter au minimum `npm test` et
`npm run lint`. Exécuter aussi `npm run build:pages` pour toute modification qui
peut affecter l'interface, les ressources publiques ou la publication.

## Organisation du code

- `app/page.tsx` contient l'interface principale et l'état React.
- `app/simulation/` contient les types, calculs, préréglages, estimations,
  changements d'échelle et migrations du stockage local.
- `tests/simulation.test.mjs` couvre la logique métier, les migrations et le
  contrat de version.
- `github-pages/` est le point d'entrée de la version statique.
- `public/` contient le manifeste, le service worker et les icônes PWA.
- `app/fonts/` contient IBM Plex Sans Condensed et IBM Plex Mono (sous-ensemble
  latin, licence OFL) embarqués par Vite : la typographie du panneau reste
  disponible hors ligne, sans dépendance réseau.
- `tools/calibrate_elecdom.py` produit les données de calibration et le rapport
  méthodologique.
- `app/simulation/calibration.generated.ts` est généré : ne pas le modifier à la
  main. Modifier le générateur puis relancer `npm run calibrate:elecdom`.
- `dist-pages/`, `.test-dist/`, `.next/` et `node_modules/` sont des sorties ou
  dépendances générées et ne doivent pas être éditées manuellement.

## Règles de modification

- Conserver l'interface et les textes destinés à l'utilisateur en français.
- Garder la logique métier testable dans `app/simulation/` plutôt que de
  l'enfouir dans les composants React.
- Préserver le bilan énergétique : les kWh HP et HC doivent rester finis,
  positifs ou nuls, et leur somme doit correspondre à la consommation annuelle.
- Lors d'une évolution du format sauvegardé dans `localStorage`, incrémenter la
  version d'état, conserver une migration des anciennes données et ajouter les
  tests correspondants.
- Toute correction de calcul doit être accompagnée d'un test de non-régression.
- Ne pas modifier les tarifs, hypothèses ou données calibrées sans documenter la
  source et la date de référence.
- Le site GitHub Pages est servi sous `/declic-hc/` : conserver des URL de
  ressources compatibles avec ce chemin de base et avec le mode PWA.
- **Toujours bumper la version** (semver) dans les cinq fichiers synchronisés
  (`package.json`, `package-lock.json`, `app/version.ts`,
  `public/manifest.webmanifest`, `public/sw.js`) et dans le test de version
  (`tests/simulation.test.mjs`) lors de toute modification visible du code,
  du thème ou de l'interface. Mettre aussi à jour `background_color` et
  `theme_color` du manifeste si la palette change.

## Versions et publication

Lors d'un changement de version, garder exactement la même valeur dans :

- `package.json` ;
- `app/version.ts` ;
- `public/manifest.webmanifest` ;
- le nom du cache dans `public/sw.js`.

Le dépôt GitHub et GitHub Pages, via le workflow
`.github/workflows/pages.yml`, constituent les seules cibles autorisées. Ne
jamais publier ou déployer ce projet sur un hébergement privé, un site ChatGPT,
un service tiers ou toute autre plateforme. Ne pas créer de publication de
prévisualisation externe. Toute publication doit passer par GitHub.

## Discipline Git

- Respecter les modifications déjà présentes dans l'arbre de travail et ne pas
  annuler des changements sans rapport avec la tâche.
- Ne pas valider dans Git les répertoires de build ou les dépendances générées.
- Garder les changements ciblés et signaler les vérifications réellement
  exécutées dans le compte rendu final.
