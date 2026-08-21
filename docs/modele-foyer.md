# Modèle de foyer de Déclic HC

Date de référence de cette méthode : 21 août 2026 (version 0.9.0).

## Deux usages du simulateur

Le mode « facture connue » conserve la consommation annuelle saisie. Les appareils servent à décomposer ce total entre usages, HP et HC. Les paramètres techniques du chauffage y restent informatifs et ne modifient pas la facture : un changement d’isolation ne peut donc pas être interprété comme une économie de travaux. Les appareils ne sont jamais réduits ; s’ils dépassent le total saisi, le total calculé est relevé et un avertissement est affiché.

Le mode « projection énergétique » additionne explicitement la consommation de fond, les appareils et le chauffage. Dans ce mode, une meilleure isolation, une pompe à chaleur ou une surface plus faible réduisent bien le total et les deux factures. Les scénarios bas et haut font eux aussi varier le total projeté.

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

Les valeurs centrales et les fourchettes proviennent des préréglages documentés ou de la saisie du foyer. Elles sont indépendantes : modifier le total, le chauffage, l’isolation ou la surface ne change jamais la consommation d’un appareil. L’ancien ajustement automatique selon le nombre d’habitants a été retiré, car ElecDom ne publie pas cette variable au grain logement et ne permet pas de justifier ce recalcul.

Source statistique des préréglages calibrés : jeu ElecDom de l’ADEME, données mises à jour le 4 mars 2022.

## Point d’équilibre

Le point d’équilibre est résolu sur la différence exacte entre les factures Base et HP/HC. Le résultat distingue un seuil classique, un seuil inversé lorsque le prix HC dépasse le prix HP, et les cas où HP/HC est toujours avantageux, jamais avantageux ou strictement équivalent.

Source : égalité algébrique des deux formules tarifaires, révisée le 21 août 2026.
