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
  tests/server.test.js    Tests d'intégration
data/                     Données privées générées, ignorées par Git
  admin.json              Mot de passe haché et secret de session
  backups/                Sauvegardes du contenu
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

Ne jamais placer `DATA_DIR` dans le dossier public.

## Contenu et administration

`frontend/content.json` contient les sections `hero`, `intro`, `situations`,
`ressenti`, `about`, `approach`, `services`, `cabinets`, `contact`.
Les blocs utilisent `label`, `title`, `texte` et des sous-blocs comme `cards`.
La syntaxe `*gras*`, `_italique_`, `~barré~` est interprétée à l'affichage.
Conserver le nombre d'éléments des tableaux pour respecter la structure HTML.
Menus, boutons, coordonnées et liens restent dans `frontend/index.html`.

Cliquer sur **Admin** : à la première connexion, le mot de passe saisi est
haché avec scrypt et enregistré dans `data/admin.json`. La session dure 48 h.
Cliquer sur un texte pour le modifier ; quitter la zone ou appuyer sur Entrée
pour enregistrer, Échap pour annuler.

L'API reste accessible sous `/api/`. Les écritures nécessitent un jeton valide.
Avant une écriture, si le contenu n'a pas été modifié depuis plus de 12 h,
une copie est créée dans `data/backups/Content_AAAA-MM-JJ.json`.

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

PM2 surveille le code et ignore `data/` et `frontend/content.json`.
Commandes utiles : `pm2 status`, `pm2 logs anouckmartin`, `npm run pm2:reload`.
