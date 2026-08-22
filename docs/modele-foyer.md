# Modèle de foyer de Déclic HC

Date de référence de cette méthode : 22 août 2026 (version 0.12.0).

## Facture connue

Le simulateur conserve la consommation annuelle connue. Les appareils et une quantité annuelle de chauffage saisie décomposent ce total entre usages, HP et HC. Le chauffage retenu remplace une partie du « reste du foyer » et sa part HC provient du recouvrement naturel avec la plage tarifaire. Les paramètres techniques fournissent une estimation que l’utilisateur peut reprendre, mais leur modification ne remplace jamais automatiquement la quantité de chauffage confirmée dans la facture.

Les appareils ne sont jamais réduits. Si le chauffage dépasse le solde disponible, lui seul est plafonné avec un avertissement. Si les appareils dépassent déjà le total saisi, le total calculé est relevé afin de préserver le bilan énergétique.

## Usages flexibles

Les appareils ajoutés par le foyer représentent volontairement des usages qu’il s’engage à programmer en heures creuses. Leur consommation centrale est donc placée à 100 % en HC, sauf la climatisation estivale. Les estimations basse et haute alimentent deux scénarios complémentaires de facture ; elles ne remplacent pas le scénario central.

La climatisation estivale suit un profil diurne de 12 h à 22 h. Elle fonctionne toute cette période le week-end et lorsque le foyer est présent. Pour le profil absent, elle fonctionne de 17 h à 22 h en semaine ; le profil mixte ajoute deux journées complètes de télétravail. Seul le recouvrement réel de ces périodes avec la plage tarifaire est compté en HC. Le chauffage assuré par une climatisation réversible reste représenté séparément par le système « pompe à chaleur / clim réversible » du modèle de chauffage.

La valeur annuelle de climatisation est exprimée pour le profil mixte. Elle est modulée par la durée d’usage : le profil absent consomme moins, le profil présent davantage. Une valeur déclarée comme mesurée n’est pas redimensionnée.

Source : convention pédagogique interne Déclic HC, confirmée pour l’objectif comportemental du simulateur le 21 août 2026. Exception estivale et profils de présence précisés le même jour, puis correction de la demande annuelle dans la version 0.9.0.

## Chauffage électrique

Le modèle ne propose actuellement ni radiateur à accumulation, ni ballon tampon, ni autre capacité explicite de stockage thermique. Il ne déplace donc pas artificiellement vers les HC un besoin de chauffage situé en HP. La part HC correspond uniquement au recouvrement naturel entre le profil hebdomadaire de chauffage et la plage tarifaire sélectionnée.

Ce recouvrement est pondéré par le besoin thermique et non par la seule durée. Le besoin instantané est pris proportionnel à l’écart entre la consigne — 19 °C en confort, 17 °C la nuit et pendant les absences — et une température extérieure de saison de chauffe décrite par une sinusoïde journalière, minimale à 5 h et maximale à 17 h, d’amplitude 4 °C autour d’une moyenne de 10 °C en dessous de 400 m, 7 °C entre 400 et 800 m et 4 °C au-dessus. Les heures nocturnes, les plus froides, pèsent ainsi davantage que leur seule durée : la part HC du chauffage dépasse la proportion mécanique de 33 % d’une plage de huit heures, et décroît quand l’altitude réduit l’écart relatif entre le jour et la nuit. La version 0.11.0 et les précédentes appliquaient un abattement uniforme de 7/9 à toutes les heures hors confort, y compris nocturnes, ce qui sous-estimait la part HC du poste le plus lourd de la facture.

L’altitude se simplifie dans le rapport qui donne le facteur de présence : elle ne pèse sur l’ampleur du besoin qu’une seule fois, par le coefficient d’altitude.

Le rendement retenu pour une pompe à chaleur ou une climatisation réversible est un SCOP de 3,6, représentatif d’un matériel récent en zone H3 où la température extérieure de la saison de chauffe reste douce. La valeur de 2,9 utilisée jusqu’à la version 0.11.0 correspondait à un matériel plus ancien en climat continental et surestimait la consommation de 20 à 40 %.

Les plages utilisées par le calcul durent exactement huit heures. Une plage invalide est neutralisée dans le calcul et réparée à partir des valeurs par défaut lors d’une migration de sauvegarde.

Source : règle conservatrice interne Déclic HC, adoptée le 21 août 2026, pondération par degrés-heures et SCOP H3 adoptés le 22 août 2026. Les coefficients de besoin thermique H3 restent les hypothèses pédagogiques déjà signalées dans l’interface et doivent encore être recalibrés sur les DPE corses, de même que le profil de température journalier.

## Valeurs des appareils

Les valeurs centrales et les fourchettes proviennent des préréglages documentés ou de la saisie du foyer. La surface conditionne uniquement l’estimation du chauffage. Le nombre d’habitants conditionne uniquement les besoins d’eau chaude sanitaire et les cycles de lave-linge, sèche-linge et lave-vaisselle, par rapport à une référence de deux personnes. Les valeurs mesurées et les autres usages ne sont jamais redimensionnés.

Cette correction est sous-linéaire : la consommation est multipliée par le rapport des effectifs élevé à un exposant propre à chaque usage — 0,6 pour l’eau chaude sanitaire, 0,5 pour le sèche-linge, 0,45 pour le lave-linge et 0,4 pour le lave-vaisselle. Une part de ces postes est en effet indépendante du nombre d’habitants : pertes du ballon, cycles incompressibles. Un chauffe-eau de 1 294 kWh/an pour deux personnes passe ainsi à 2 242 kWh/an pour cinq, et non à 3 235 kWh/an comme le donnait la proportionnalité stricte des versions 0.10.0 et 0.11.0.

Ces exposants sont une convention pédagogique explicite demandée pour le modèle du foyer le 22 août 2026 ; ils ne proviennent pas de la calibration ElecDom, qui ne publie pas le nombre d’habitants au grain logement. Ils restent cohérents avec les exposants descriptifs qu’elle mesure, tous nettement inférieurs à 1.

Source statistique des préréglages calibrés : jeu ElecDom de l’ADEME, données mises à jour le 4 mars 2022.

## Disponibilité de l’option Base

La grille EDF Corse du 1er août 2026 met l’option Base en extinction au-delà de 6 kVA : elle n’est plus souscriptible depuis le 1er février 2026 de 9 à 15 kVA et disparaît le 1er février 2027 de 18 à 36 kVA. L’option Heures Pleines / Heures Creuses reste ouverte sur toute la grille. La simulation reste calculée pour toutes les puissances, mais l’interface signale que la comparaison ne vaut plus que pour un contrat déjà en cours. Aucune extinction n’est affirmée en dehors des puissances du Tarif Bleu résidentiel, une grille importée pouvant décrire un autre contrat.

L’abonnement annuel est identique en Base et en HP/HC pour les neuf puissances de cette grille. Le point d’équilibre est donc indépendant de la consommation annuelle : c’est une propriété du tarif corse, non une approximation du modèle.

Source : grilles de prix du Tarif Bleu résidentiel EDF Corse, HT et TTC, applicables au 1er août 2026, relevées le 22 août 2026.

## Point d’équilibre

Le point d’équilibre est résolu sur la différence exacte entre les factures Base et HP/HC. Le résultat distingue un seuil classique, un seuil inversé lorsque le prix HC dépasse le prix HP, et les cas où HP/HC est toujours avantageux, jamais avantageux ou strictement équivalent.

Source : égalité algébrique des deux formules tarifaires, révisée le 21 août 2026.
