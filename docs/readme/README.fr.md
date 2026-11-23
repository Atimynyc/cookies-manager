| [English](../../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Deutsch](README.de.md) | **Français ✓** | [日本語](README.ja.md) | [Română](README.ro.md) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |

# ![](../../assets/icon-48.png) Cookie Controller

Gérez les cookies, Local Storage et Session Storage, pour le site web de votre choix, depuis une fenêtre contextuelle ou le panneau latéral Chrome. Conçu pour les développeurs, les testeurs et les utilisateurs avancés qui souhaitent inspecter et modifier les données d'un site sans ouvrir DevTools.

## Commencer

1. Installez [Cookie Controller](https://chromewebstore.google.com/detail/cookie-controller/hmfnocennjjcieebhojphobilohcdfda) depuis la boutique en ligne Chrome.
2. Ouvrez une page HTTP/HTTPS et cliquez sur l'icône de l'extension.
3. Autorisez l'accès au site Web sélectionné lorsque vous y êtes invité, puis choisissez « Cookies », « Local Storage » ou « Session Storage ».
4. Recherchez, modifiez, importez ou exportez des données. Ouvrez le panneau latéral pour agrandir l'espace de travail, ou activez le rafraîchissement automatique de la page après chaque modification.

Pour une installation locale, clonez ce dépôt, ouvrez `chrome://extensions`, activez le mode Développeur, puis utilisez l'option « Charger sans compression » pour sélectionner le dossier du dépôt contenant `manifest.json`. L'extension s'exécute directement à partir des fichiers inclus ; aucune étape de compilation n'est nécessaire.

## Caractéristiques

- Recherchez des cookies par nom, valeur, domaine ou chemin d'accès.
- L'éditeur conserve les attributs « domaine », « chemin », « SameSite », « Secure » et « HttpOnly » de chaque cookie lorsque vous modifiez sa valeur ou sa date d'expiration.
- Créer et supprimer des cookies, supprimer les éléments sélectionnés et définir des valeurs par lots.
- Afficher, créer, modifier et supprimer les entrées Local Storage et Session Storage.
- Les cookies HTTP et les entrées de stockage Web favoris apparaissent en haut de chaque liste de données.
- Prévisualisez les exportations et enregistrez la vue actuelle, les éléments sélectionnés ou l'ensemble des données du site sous la forme d'un package JSON versionné, dans un fichier ou dans le presse-papiers. Importation avec prévisualisation des différences, sélection élément par élément, stratégies de résolution des conflits, suivi de la progression, affichage des résultats et annulation par lots.
- Importer et exporter les cookies au format « cookie-jar » Netscape/cURL, y compris ceux respectant la convention `#HttpOnly_` et les cookies de session.
- Enregistrez localement les états de site réutilisables avec les balises, les règles d'origine, les stratégies de résolution des conflits par défaut et les variables saisies lors de l'application d'un état. Renommez, dupliquez, exportez, appliquez ou supprimez les états enregistrés.
- Importez rapidement des cookies à l'aide des champs distincts Name et Value, ou ajoutez une entrée de stockage avec `key=value`. Copiez des valeurs, des paires `name=value` ou des données structurées JSON.
- Utilisez les outils d'encodage/décodage d'URL, de mise en forme/compactage JSON et de décodage de la charge utile JWT lors de la modification des valeurs.
- Consultez les modifications récentes et les différences « avant/après », relancez les opérations ayant échoué et annulez les modifications prises en charge au cours de la session de navigation en cours.
- Basculez la cible entre les onglets HTTP et HTTPS dans la fenêtre actuelle du navigateur.

Le format Netscape/cURL ne prend en charge que les cookies. Il ne conserve pas l'attribut SameSite, les informations de partition Partitioned/CHIPS ni l'identifiant du magasin de cookies Chrome. Utilisez les paquets JSON pour conserver ces attributs et le stockage Web.

## Langues et thèmes

L'interface prend en charge l'anglais, le chinois simplifié, le chinois traditionnel, l'espagnol, le portugais brésilien, l'allemand, le français, le japonais et le roumain. Toutes les traductions sont incluses dans l'extension et fonctionnent hors ligne.

Lors de la première utilisation, une langue prise en charge est sélectionnée parmi celles proposées par Chrome, puis enregistrée ; les langues non prises en charge sont automatiquement remplacées par l'anglais. Les paramètres régionaux roumains, tels que `ro-RO` et `ro-MD`, sélectionnent le roumain. Vous pouvez modifier la langue à tout moment à l'aide du bouton « Paramètres » ; le changement de langue ne supprime pas les brouillons de l'éditeur.

Utilisez le bouton « Soleil/Lune » pour basculer entre les thèmes clair et foncé. Par défaut, le mode normal utilise le thème clair, tandis que le mode incognito utilise le thème foncé. Chaque mode mémorise son choix indépendamment du système d'exploitation, et les préférences se synchronisent entre toutes les fenêtres de l'extension ouvertes dans le même mode.

## Confidentialité et contrôle des données

Pas de publicités, d'analyses, de suivi des utilisateurs ni de compte requis. Les données du site sont traitées sur votre appareil et ne sont ni transmises, ni vendues, ni partagées avec le développeur ou des serveurs tiers. Par défaut, l’accès est demandé séparément pour chaque site et peut être révoqué dans les paramètres de l’extension dans Chrome. Les opérations que vous lancez peuvent se terminer après la fermeture de la fenêtre contextuelle ou du panneau latéral.

Vous pouvez activer **Autoriser tous les sites** dans les paramètres ou la boîte de dialogue d’accès au site pour demander l’accès aux cookies, à localStorage et à sessionStorage sur tous les sites HTTP/HTTPS que vous consultez. Une fois cette autorisation accordée par Chrome, les nouveaux sites ne nécessitent plus de confirmation individuelle. Désactivez cette option pour revenir à une autorisation séparée pour chaque site.

Les préférences, les confirmations d'accès au site, les identifiants des favoris (sans les valeurs associées), les états enregistrés et les résumés de l'historique sont conservés dans le stockage local de l'extension. Les états enregistrés peuvent contenir les valeurs des cookies et du stockage que vous choisissez explicitement d'enregistrer. Les valeurs complètes « avant/après » et les données de récupération des opérations ne sont conservées que pendant la session de navigation en cours ; le redémarrage de Chrome ou le rafraîchissement de l’extension les efface. Effacez les données de l’extension ou désinstallez-la pour supprimer les données enregistrées localement.

Les cookies et le stockage Web peuvent contenir des informations de connexion ou d'autres données sensibles. Protégez les données copiées et exportées. L'outil JWT affiche le contenu décodé en Base64URL à des fins d'inspection uniquement. Il ne vérifie pas les signatures et ne contrôle pas si un jeton d'authentification est fiable ou valide. Consultez la [politique de confidentialité](../../docs/privacy-policy.html) pour plus de détails.

## Développement de logiciels

Installez les dépendances de développement et exécutez les vérifications depuis la racine du référentiel :

```sh
npm install
npm run lint
npm test
npm run test:locales
npm run test:acceptance -- --storage-only
```

La dernière commande permet de tester la lecture et la modification des données Local Storage et Session Storage d'un site web dans Chromium. Consultez la [référence de développement et de mise en production (en anglais)](../../docs/development.md) pour connaître l'ensemble des commandes de test du navigateur, les emplacements de sortie et les détails relatifs à la fiabilité du fonctionnement.

## Version et documentation

Version actuelle : **0.3.9**. Nécessite **Chrome 114 ou une version plus récente**.

- [Notes de mise à jour v0.3.9](../../docs/release-notes-v0.3.9.md)
- [Maintenance de la localisation](../../docs/localization.md)
- [Format de pack de données de site avec gestion des versions](../../docs/site-data-package-v1.md)
- [Descriptions des produits et images promotionnelles de la boutique en ligne Chrome](../../store-assets/)
- [Signaler un problème](https://github.com/Atimynyc/cookies-manager/issues)
