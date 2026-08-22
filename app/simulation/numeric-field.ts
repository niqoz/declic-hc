// Règle de synchronisation du champ numérique de l'interface. Elle vit ici pour
// rester couverte par les tests : un champ garde un brouillon de saisie pour
// pouvoir être vidé, mais ce brouillon ne doit jamais masquer une valeur
// recalculée ailleurs — changement du nombre d'habitants, profil rechargé,
// supprimé ou importé. Sans cette règle, le recalcul reste invisible puis se
// fait écraser par le brouillon au moment où le champ perd le focus.
export function shouldAdoptExternalValue(focused: boolean, value: number, emitted: number) {
  return !focused || !Object.is(value, emitted);
}
