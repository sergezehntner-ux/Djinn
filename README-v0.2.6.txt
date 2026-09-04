Djinn v0.2.6 · Enchaînement

Cette version ajoute uniquement le deuxième point testé sur le terrain : proposer facultativement une autre tâche lorsqu'il reste du temps disponible.

Fonctionnement :
- après « D’accord, je m’y mets », Djinn calcule le solde de la tranche de temps choisie ;
- s’il reste du temps, un pop-up demande : « Veux-tu encore une autre proposition ? » ;
- « Non » ferme simplement le pop-up et les propositions continuent normalement ;
- « Oui » recentre l’écran sur la suggestion ;
- Djinn privilégie alors une tâche qui tient dans le solde ET se trouve au même lieu que la tâche choisie ;
- s’il n’y en a pas au même lieu, il propose une autre tâche compatible avec le temps restant ;
- si aucune tâche ne tient dans le solde, Djinn revient aux propositions habituelles sans insister.

Les autres comportements restent inchangés.
La clé locale reste djinn-v0100-state afin de préserver toutes les données existantes.
