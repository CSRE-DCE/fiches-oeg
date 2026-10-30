/* Accès aux stations — données communes à toutes les tablettes
 *
 * Ces informations (point de départ, moyens de transport, niveau d'accessibilité, étapes / consignes,
 * marché, bassin versant) sont livrées avec l'application : chaque tablette les reçoit à la mise à jour,
 * sans import ni synchronisation. Elles proviennent du fichier « modeles/acces-stations-a-remplir.xlsx »
 * rempli par l'Office de l'Eau.
 *
 * Une modification faite ensuite sur une tablette (onglet Données → « Accès et moyens de transport par
 * station », ou import d'un fichier) reste prioritaire sur cette tablette si elle est plus récente que
 * « majLe ».
 *
 * Format : clé = code de la station (ou son nom si elle n'a pas de code, par ex. les points ESO) ;
 * niveau : 'Très facile' | 'Facile' | 'Moyen' | 'Difficile' | 'Très difficile'.
 *   "09141515": {pointDepart:"Cayenne", modes:["4x4","À pied"], niveau:"Moyen", etapes:"…", marche:"…", bassin:"…"}
 */
window.OEG_ACCES_STATIONS = {
  majLe: '',
  stations: {}
};
