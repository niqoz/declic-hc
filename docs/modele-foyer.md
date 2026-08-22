# Modèle de foyer de Déclic HC

Date de référence de cette méthode : 22 août 2026 (version 0.10.0).

## Facture connue

Le simulateur conserve la consommation annuelle connue. Les appareils et une quantité annuelle de chauffage saisie décomposent ce total entre usages, HP et HC. Le chauffage retenu remplace une partie du « reste du foyer » et sa part HC provient du recouvrement naturel avec la plage tarifaire. Les paramètres techniques fournissent une estimation que l’utilisateur peut reprendre, mais leur modification ne remplace jamais automatiquement la quantité de chauffage confirmée dans la facture.

Les appareils ne sont jamais réduits. Si le chauffage dépasse le solde disponible, lui seul est plafonné avec un avertissement. Si les appareils dépassent déjà le total saisi, le total calculé est relevé afin de préserver le bilan énergétique.

## Usages flexibles

Les appareils ajoutés par le foyer représentent volontairement des usages qu’il s’engage à programmer en heures creuses. Leur consommation centrale est donc placée à 100 % en HC, sauf la climatisation estivale. Les estimations basse et haute alimentent deux scénarios complémentaires de facture ; elles ne remplacent pas le scénario central.

La climatisation estivale suit un profil diurne de 12 h à 22 h. Elle fonctionne toute cette période le week-end et lorsque le foyer est présent. Pour le profil absent, elle fonctionne de 17 h à 22 h en semaine ; le profil mixte ajoute deux journées complètes de télétravail. Seul le recouvrement réel de ces périodes avec la plage tarifaire est compté en HC. Le chauffage assuré par une climatisation réversible reste représenté séparément par le système « pompe à chaleur » du modèle de chauffage.

La valeur annuelle de climatisation est exprimée pour le profil mixte. Elle est modulée par la durée d’usage : le profil absent consomme moins, le profil présent davantage. Une valeur déclarée comme mesurée n’est pas redimensionnée.

Source : convention pédagogique interne Déclic HC, confirmée pour l’objectif comportemental du simulateur le 21 août 2026. Exception estivale et profils de présence précisés le même jour, puis correction de la demande annuelle dans la version 0.9.0.

## Chauffage électrique

Le modèle ne propose actuellement ni radiateur à accumulation, ni ballon tampon, ni autre capacité explicite de stockage thermique. Il ne déplace donc pas artificiellement vers les HC un besoin de chauffage situé en HP. La part HC correspond uniquement au recouvrement naturel entre le profil hebdomadaire de chauffage et la plage tarifaire sélectionnée.

Les plages utilisées par le calcul durent exactement huit heures. Une plage invalide est neutralisée dans le calcul et réparée à partir des valeurs par défaut lors d’une migration de sauvegarde.

Source : règle conservatrice interne Déclic HC, adoptée le 21 août 2026. Les coefficients de besoin thermique H3 restent les hypothèses pédagogiques déjà signalées dans l’interface et doivent encore être recalibrés sur les DPE corses.

## Valeurs des appareils

Les valeurs centrales et les fourchettes proviennent des préréglages documentés ou de la saisie du foyer. La surface conditionne uniquement l’estimation du chauffage. Le nombre d’habitants conditionne uniquement les besoins d’eau chaude sanitaire et les cycles de lave-linge, sèche-linge et lave-vaisselle, proportionnellement à une référence de deux personnes. Les valeurs mesurées et les autres usages ne sont jamais redimensionnés.

Ce coefficient par occupant est une convention pédagogique explicite demandée pour le modèle du foyer le 22 août 2026 ; il ne provient pas de la calibration ElecDom, qui ne publie pas le nombre d’habitants au grain logement.

Source statistique des préréglages calibrés : jeu ElecDom de l’ADEME, données mises à jour le 4 mars 2022.

## Point d’équilibre

Le point d’équilibre est résolu sur la différence exacte entre les factures Base et HP/HC. Le résultat distingue un seuil classique, un seuil inversé lorsque le prix HC dépasse le prix HP, et les cas où HP/HC est toujours avantageux, jamais avantageux ou strictement équivalent.

Source : égalité algébrique des deux formules tarifaires, révisée le 21 août 2026.
