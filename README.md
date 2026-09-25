# AnouckMartin.com

Site vitrine d'Anouck Martin, psychopraticienne à Laroin et Lasseube.
HTML, CSS et JavaScript côté navigateur ; Node.js sans dépendance npm côté serveur.

## Arborescence

```text
frontend/                 Fichiers publics uniquement
  index.html              Structure de la page
  style.css               Styles et adaptation mobile
  script.js               Contenu, interactions et carte
  admin.js                Interface d'administration dans le navigateur
  content.json            Textes éditables
  *.jpg, *.jpeg, *.png     Images
backend/                  Code exécuté côté serveur
  server.js               Serveur HTTP, authentification et API
  storage.js              Écritures atomiques et validation des images
  deploy.js               Mise à jour isolée et retour arrière
  tests/                  Tests d'intégration et de déploiement
data/                     Données privées générées, ignorées par Git
  admin.json              Mot de passe haché et secret de session
  backups/                Sauvegardes du contenu
  uploads/                Images envoyées depuis l'administration
  update-status.json      Résultat de la dernière mise à jour
.deploy/                  Versions préparées et précédentes (hors Git)
package.json              Commandes du projet
ecosystem.config.js       Configuration PM2
nginx.conf                Configuration nginx
demarrer-anouck.ps1        Installation du poste d'Anouck
```

`admin.js` appartient au frontend : il s'exécute dans le navigateur.
L'authentification et les écritures sont gérées par `backend/server.js`.
Seul le dossier `frontend/` est exposé comme racine web.

## Développement

Depuis la racine, avec Node.js 18 minimum :

```powershell
npm.cmd start
```

Ouvrir http://localhost:3210. `npm run dev` lance le même serveur.
Aucune installation de dépendances n'est nécessaire pour le site.
Le script `demarrer-anouck.ps1` installe les outils sur le poste d'Anouck.

Les chemins par défaut sont indépendants du dossier de lancement de Node :

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` | `3210` | Port HTTP |
| `ROOT` | `<projet>/frontend` | Dossier public, contenant `content.json` |
| `DATA_DIR` | `<projet>/data` | Dossier privé des identifiants et sauvegardes |
| `ENABLE_UPDATES` | désactivé | `1` active le bouton de déploiement sur Linux avec PM2 |

Ne jamais placer `DATA_DIR` dans le dossier public.

## Contenu et administration

`frontend/content.json` contient les sections `hero`, `intro`, `situations`,
`ressenti`, `about`, `approach`, `services`, `cabinets`, `contact`.
Les blocs utilisent `label`, `title`, `texte` et des sous-blocs comme `cards`.
La syntaxe `*gras*`, `_italique_`, `~barré~` est interprétée à l'affichage.
Conserver le nombre d'éléments des tableaux pour respecter la structure HTML.
Menus, boutons, coordonnées et liens restent dans `frontend/index.html`.

Cliquer sur le **cadenas** en bas à droite : à la première connexion, le mot de passe saisi est
haché avec scrypt et enregistré dans `data/admin.json`. La session dure 48 h.
Cliquer sur un texte pour le modifier ; quitter la zone ou appuyer sur Entrée
pour enregistrer, Échap pour annuler.

L'API reste accessible sous `/api/`. Les écritures nécessitent un jeton valide.
Chaque écriture crée une sauvegarde horodatée unique dans `data/backups/`,
puis remplace atomiquement le JSON. Un contrôle de version refuse les écritures
depuis une page périmée : recharger la page pour récupérer les dernières données.
Le frontend lit `/api/content`, qui fournit le contenu et sa version.

### Remplacer les images

En mode admin, déposer un fichier sur une image ou utiliser **Remplacer l'image**
(également disponible sur mobile). JPEG, PNG et WebP sont acceptés, jusqu'à 8 Mo.
Le navigateur vérifie le décodage ; le serveur contrôle la signature du format,
la taille, la session et la version du contenu. SVG n'est pas accepté en upload.
Les fichiers sont enregistrés sous un nom unique dans `data/uploads/` et servis
par `/api/media/`. L'ancienne image est conservée, notamment pour les sauvegardes.

`content.json` contient un objet `images` avec les clés `hero`, `artTherapy`,
`portrait`, `office`, `email` et `whatsapp`. L'image `hero` sert aussi de fond
de page. Les anciens JSON sans objet `images` restent compatibles avec les
images par défaut du HTML/CSS ; le premier upload ajoute sa référence.

### Mettre à jour depuis GitHub

Après connexion, le bouton **Mettre à jour** apparaît à gauche du cadenas,
fixe en bas à droite. Il ouvre une fenêtre de confirmation ; seul le clic sur
**Confirmer la mise à jour** lance l'opération. Le bouton reste accessible si
le déploiement est indisponible, afin d'en afficher la raison.

La fenêtre suit le téléchargement, la vérification, l'installation, le
redémarrage et le contrôle du site. On peut la fermer et la rouvrir sans
interrompre l'opération. Le résultat reste visible jusqu'au clic sur
**Recharger le site**. La rubrique **Retour en arrière et sauvegardes** affiche
le dossier de la transaction, les versions et le résultat d'une éventuelle
restauration automatique, ainsi que les indications de restauration manuelle.

La mise à jour récupère
`https://github.com/sctfic/AnouckMartin.com`, branche **main**. La source et la
branche sont fixées côté serveur et ne proviennent jamais d'une requête client.

Le téléchargement et la vérification syntaxique ont lieu dans `.deploy/`.
Seuls les dossiers `frontend/` et `backend/` sont déployés. **Tous les JSON
existants dans ces dossiers sont recopiés à l'identique ; aucun JSON GitHub
n'est importé.** Les images existantes, `data/`, les uploads et les fichiers à
la racine du projet sont conservés. Les ajouts ou migrations de schéma JSON
doivent donc être faits séparément, sans écraser les données de production.

L'édition est verrouillée pendant le déploiement. Une copie des deux anciens
dossiers est conservée, PM2 redémarre le serveur, puis sa santé est vérifiée.
En cas d'échec au redémarrage, l'ancienne version est restaurée automatiquement.
Les changements de dépendances ou de version Node demandent une installation
manuelle. Aucun `git reset` ou `git pull` n'est effectué dans le dossier actif.
Le déploiement peut entraîner une brève indisponibilité pendant le redémarrage.

**Installation initiale requise :** publier cette version sur `main`, puis
l'installer une première fois sur le serveur, en conservant ses JSON actuels.
Installer Git et PM2 pour le même utilisateur que le service Node. Pour un dépôt
privé, configurer un accès Git en lecture non interactif pour cet utilisateur ;
ne pas ajouter de jeton GitHub au frontend ni dans `content.json`.
Le processus doit pouvoir renommer les dossiers `frontend/` et `backend/`, écrire
dans `.deploy/` et `data/`, et joindre GitHub. Garder `ROOT` sur `<projet>/frontend`.

Appliquer le `nginx.conf` fourni (uploads : `client_max_body_size 12m`, cache des
fichiers du code avec revalidation) et recréer le processus PM2 avec la configuration
fournie, **watch désactivé**, **treekill=false** et `ENABLE_UPDATES=1` en production.
Le worker détaché doit survivre au redémarrage du serveur ; cette option est
décrite dans la [documentation PM2](https://pm2.io/docs/runtime/reference/ecosystem-file/).
Les anciens assets
déjà en cache navigateur peuvent nécessiter un rechargement forcé à l'installation
initiale. Après une mise à jour, utiliser **Recharger le site** dans la fenêtre.

Les versions précédentes et sauvegardes ne sont pas purgées automatiquement.
En cas d'arrêt brutal de la machine pendant une permutation, arrêter PM2,
consulter `.deploy/<identifiant>/transaction.json` et restaurer les dossiers
`previous-frontend` / `previous-backend` de cette transaction si nécessaire.
Conserver les copies présentes avant toute restauration. Vérifier les JSON,
rétablir `data/release.json` d'après `oldRelease`, puis seulement retirer
`data/update.lock` et relancer PM2. Un échec de restauration garde volontairement
ce verrou afin d'empêcher toute nouvelle écriture.

## Vérifications

```powershell
npm.cmd test
```

Les tests utilisent une copie temporaire du frontend, des données privées
temporaires et un port libre. Ils ne modifient pas le contenu du projet.

## Production et migration

Déployer l'arborescence complète dans `/home/alban/www/anouckmartin.psy`.
nginx sert `/home/alban/www/anouckmartin.psy/frontend` et relaie `/api/`
vers `http://127.0.0.1:3210`. Node doit pouvoir écrire dans
`frontend/content.json` et `data/`.

Pour migrer une installation existante :

1. Arrêter le processus PM2 et sauvegarder les fichiers de production
   `content.json`, `admin.json` et `backups/` avant le transfert.
2. Déployer les nouveaux dossiers. Replacer le contenu de production dans
   `frontend/content.json`, les identifiants dans `data/admin.json` et les
   sauvegardes dans `data/backups/`.
3. Installer la nouvelle configuration nginx ; exécuter `nginx -t`, puis
   recharger nginx si la vérification réussit.
4. Recréer l'entrée PM2 pour prendre en compte le nouveau chemin du serveur :

```sh
pm2 delete anouckmartin
pm2 start ecosystem.config.js --env production
pm2 save
```

Pour une première installation, installer PM2 puis lancer les deux dernières
commandes et `pm2 startup` (suivre la commande affichée).
Vérifier le site et la connexion admin avant de retirer les anciens fichiers
à la racine du déploiement. Les domaines et certificats nginx doivent
correspondre au serveur cible.

PM2 ne surveille pas les fichiers : le déploiement déclenche un seul redémarrage
après la permutation complète des dossiers.
Commandes utiles : `pm2 status`, `pm2 logs anouckmartin`, `npm run pm2:reload`.
