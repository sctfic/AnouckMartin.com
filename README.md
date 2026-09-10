# AnouckMartin.com

Site vitrine statique d'**Anouck Martin**, psychopraticienne (Laroin & Lasseube, 64), avec un petit **serveur Node** optionnel qui permet la mise à jour du contenu sans toucher au HTML.

## Structure

| Fichier | Rôle |
| --- | --- |
| `index.html` | Structure de la page. Les textes éditoriaux y figurent sous forme de `...` (le contenu réel vient de `content.json`). |
| `content.json` | **Contenu éditable** du site (source de vérité des textes). |
| `admin.json` | (créé à la 1ʳᵉ connexion) mot de passe admin **haché** + clé de session. **Jamais servi publiquement.** |
| `style.css` | Design system (thème unique) + styles du mode admin. |
| `script.js` | Chargement du contenu depuis `content.json` et injection dans la page. |
| `admin.js` | Espace admin : connexion, édition en place, enregistrement. |
| `server.js` | Mini-serveur Node (statique + API `/api/`) pour authentifier et enregistrer le JSON. |
| `nginx.conf` | Configuration nginx (proxy `/api/`, blocage fichiers sensibles). |
| `txt.md` | Brouillons éditoriaux (source des textes). |

## Contenu (`content.json`)

Les textes sont regroupés **par section** (même nom que l'`id` de la section dans le code) : `hero`, `intro`, `situations`, `ressenti`, `about`, `approach`, `services`, `cabinets`, `contact`.

Chaque bloc contient :

```json
{
  "label": "petit intitulé / icône (vide si absent)",
  "title": "Titre",
  "texte": "Contenu (un paragraphe, ou un tableau de paragraphes)"
}
```

Certaines sections contiennent des sous-blocs du même format : `cards`, `formation`, `facts`, `offer`, `note`, `days`…

**Mise en forme simple** (interprétée à l'affichage) :

- `*mot*` → **gras**
- `_mot_` → *italique*
- `~mot~` → ~~barré~~

Les éléments non éditoriaux (menu, boutons, coordonnées, listes de communes, liens) restent dans le HTML.

> ⚠️ Conservez le **même nombre d'éléments** dans les tableaux (`cards`, `texte`, …) pour que chaque texte tombe au bon endroit.

## Espace d'administration

1. Cliquez sur **« Admin »** dans le menu.
2. **Première fois** : aucun mot de passe n'existe → le mot de passe saisi devient le mot de passe admin (stocké **haché** dans `admin.json`).
3. Ensuite : saisissez le mot de passe pour vous connecter.
4. La session reste active **48 h** (persistant, sans reconnexion).
5. Connecté : chaque bloc est **surligné en pointillés** ; **un clic** ouvre la zone de saisie.
6. **Quitter la zone (perte de focus) ou Entrée** enregistre automatiquement ; **Échap** annule.

Avant chaque enregistrement, le serveur crée une copie de sauvegarde si `content.json` a été modifié **il y a plus de 12 heures** :

```text
backups/Content_AAAA-MM-JJ.json
```

## Lancement local

```bash
node server.js
# Site : http://localhost:3210
```

Options :

```bash
PORT=3210 ROOT=/chemin/vers/le/site node server.js
```

## Mise en production

Le site est servi par nginx. L'API doit être relayée :

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3210;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
}

location = /admin.json { deny all; }
location /backups/ { deny all; }
```

Étapes :

1. Copier les fichiers sur le serveur (ex. `/home/alban/www/anouckmartin.psy`).
2. Vérifier la configuration : `nginx -t` puis `nginx -s reload`.
3. Lancer le service en permanence avec **PM2** (voir ci-dessous), avec accès en **écriture** au dossier.
4. Définir `ROOT` si le site n'est pas dans le dossier du script (`ecosystem.config.js` le renseigne déjà).

### Première installation PM2

```bash
# 1) Installer PM2 (une seule fois)
npm install -g pm2

# 2) Depuis le dossier du site : démarrer l'application
pm2 start ecosystem.config.js --env production

# 3) Enregistrer la liste des processus
pm2 save

# 4) Démarrage automatique au boot (exécuter la commande affichée)
pm2 startup
```

Commandes utiles :

```bash
pm2 status                  # état du process
pm2 logs anouckmartin       # journaux en direct
pm2 reload anouckmartin     # rechargement après mise à jour
pm2 restart anouckmartin    # redémarrage
pm2 stop anouckmartin       # arrêt
pm2 delete anouckmartin     # suppression du process
```

> **Surveillance des fichiers** : `watch` est activé dans `ecosystem.config.js` ; PM2 redémarre automatiquement l'application à chaque **upload de nouvelles versions du code**. Les fichiers de données (`content.json`, `admin.json`, `backups/`, `logs`) sont **ignorés** pour ne pas redémarrer lors des sauvegardes effectuées depuis l'espace admin.

## Sécurité

- Le mot de passe n'est jamais stocké en clair (hash `scrypt` + sel).
- `admin.json` et `backups/` sont bloqués par nginx et par `server.js`.
- Les écritures passent uniquement par l'API authentifiée (jeton signé 48 h).
- `content.json` reste public (nécessaire à l'affichage).
