# Modèle de foyer de Déclic HC

Date de référence de cette méthode : 21 août 2026 (version 0.8.0).

## Usages flexibles

Les appareils ajoutés par le foyer représentent volontairement des usages qu’il s’engage à programmer en heures creuses. Leur consommation centrale est donc placée à 100 % en HC. Les estimations basse et haute alimentent deux scénarios complémentaires de facture ; elles ne remplacent pas le scénario central.

Source : convention pédagogique interne Déclic HC, confirmée pour l’objectif comportemental du simulateur le 21 août 2026.

## Chauffage électrique

Le modèle ne propose actuellement ni radiateur à accumulation, ni ballon tampon, ni autre capacité explicite de stockage thermique. Il ne déplace donc pas artificiellement vers les HC un besoin de chauffage situé en HP. La part HC correspond uniquement au recouvrement naturel entre le profil hebdomadaire de chauffage et la plage tarifaire sélectionnée.

Les plages utilisées par le calcul durent exactement huit heures. Une plage invalide est neutralisée dans le calcul et réparée à partir des valeurs par défaut lors d’une migration de sauvegarde.

Source : règle conservatrice interne Déclic HC, adoptée le 21 août 2026. Les coefficients de besoin thermique H3 restent les hypothèses pédagogiques déjà signalées dans l’interface et doivent encore être recalibrés sur les DPE corses.

## Adaptation à la taille du foyer

Pour les appareils disposant d’une calibration suffisante, le facteur appliqué est :

`(kWh par habitant cible / kWh par habitant de départ) ^ exposant foyer × (habitants cibles / habitants de départ) ^ exposant habitants`.

Cette écriture évite de compter deux fois une hausse de consommation annuelle provenant uniquement d’un plus grand nombre d’habitants. Si consommation et population doublent simultanément, la consommation par habitant reste stable et seule la correction démographique intervient.

Source statistique : jeu ElecDom de l’ADEME, données mises à jour le 4 mars 2022. La transformation par habitant est une règle méthodologique interne adoptée le 21 août 2026. L’exposant démographique reste indicatif, car ElecDom ne publie pas cette variable au grain logement.

## Point d’équilibre

Le point d’équilibre est résolu sur la différence exacte entre les factures Base et HP/HC. Le résultat distingue un seuil classique, un seuil inversé lorsque le prix HC dépasse le prix HP, et les cas où HP/HC est toujours avantageux, jamais avantageux ou strictement équivalent.

Source : égalité algébrique des deux formules tarifaires, révisée le 21 août 2026.
