# Saveur

Un seul serveur et une seule application web pour **plusieurs restaurants**. Chaque restaurant a son propre compte admin,
ses caissiers, son menu, ses tables, ses commandes, ses factures et ses réclamations : rien n'est partagé entre restaurants.

| Interface | Adresse | Dossier du code |
|---|---|---|
| Menu client (scan du QR code de la table) | `/` | `web/src/client` |
| Caisse | `/caisse/` | `web/src/caisse` |
| Connexion (admin et caissiers) | `/login` | `web/src/admin` |
| Dashboard admin | `/admin/` | `web/src/admin` |
| API + temps réel (Socket.IO) | `/api`, `/socket.io` | `server/` |

- `server/` : Node.js (Express + Socket.IO + MySQL). Base de données : MySQL 8
  (connexion dans `server/config.env` : `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` ;
  les tables sont créées et mises à niveau automatiquement au démarrage),
  photos des plats : `server/public/images/dishes`.
- `web/` : une application Vite avec trois pages (une par interface). Chaque interface garde
  ses propres composants et son thème (`tailwind.<interface>.config.ts`) ; dans le code,
  `@/...` pointe vers le dossier de l'interface qui fait l'import. Le socle commun (traductions, devise, ticket, addition,
  authentification) est dans `web/src/shared`.

## Installation (une fois)

Prérequis : Node.js et un serveur MySQL 8 démarré, avec une base et un utilisateur correspondant à `server/config.env`.

```bash
npm run install:all
```

## Développement

```bash
npm run dev
```

Lance le serveur (port 3001) et l'application web (port 8080, rechargement automatique).
Ouvrir http://localhost:8080/ (client), http://localhost:8080/caisse/ et http://localhost:8080/admin/ (connexion : http://localhost:8080/login).

## Production (un seul processus)

```bash
npm run build
npm start
```

Le serveur sert alors les trois interfaces et l'API sur le même port :
http://localhost:3001/, http://localhost:3001/caisse/, http://localhost:3001/admin/ (connexion : http://localhost:3001/login).

## Premiers pas

1. **Créer le compte du restaurant** : ouvrir `/login` > « Créer mon restaurant » (nom du restaurant, votre nom, e-mail,
   mot de passe d'au moins 8 caractères, devise et **clé d'activation** : elle donne un mois d'essai gratuit et reste liée à votre compte ;
   elle sert aussi à retrouver l'accès si vous oubliez votre mot de passe, voir « Mot de passe oublié »). Sur une base qui contenait déjà des données (installation à un seul
   restaurant), **le premier compte créé reprend ces données** : menu, caissiers, tables, historique.
2. **Paramètres** (admin) : nom, adresse et téléphone du restaurant (repris sur le menu client, les additions, les factures et
   la caisse), message de bas de ticket, **devise** (euro par défaut, ou dollar), fuseau horaire, TVA, frais de table / service.
3. **Menu** (admin ou caisse) : ajouter les plats avec le même formulaire (catégorie existante ou nouvelle, photo, prix, devise).
4. **Caissiers** (admin) : créer un compte par caissier avec son **e-mail** (unique) et un mot de passe. L'admin peut relire et modifier ce mot de passe.
   Les caissiers se connectent sur la **même page que l'admin** (`/login`) avec leur e-mail : le rôle du compte décide de la suite (tableau de bord
   pour l'admin, caisse pour le caissier). Un caissier ne voit que les données de son restaurant.
5. **Tables & QR codes** (admin) : créer les tables, imprimer ou télécharger les QR codes. L'admin peut fixer une **TVA propre à chaque
   table** (vide = taux du restaurant, 0 = pas de TVA sur cette table). L'adresse du menu dans les QR codes est détectée automatiquement
   (carte Wi-Fi du PC en priorité, ou `PUBLIC_URL` dans `server/config.env` une fois le site en ligne).
6. Le client scanne le QR code de sa table et commande ; la caisse ou l'admin confirme, sert et encaisse.
   L'encaissement ferme la session de la table : pour commander à nouveau, il faut rescanner le QR code.

## Mot de passe oublié

Sur l'écran de connexion, « Mot de passe oublié ? » demande l'e-mail, la **clé d'activation** liée au compte et un nouveau mot de passe : aucun e-mail n'est nécessaire.
La clé (et sa date d'expiration) est visible dans Paramètres > Licence ; une nouvelle clé peut être saisie pour renouveler la licence.

## Devise

Une devise par restaurant (euro, dollar ou dinar algérien), appliquée au menu, aux additions, aux factures, aux tickets et aux rapports.
Elle se change dans **Paramètres** (bouton de devise dans la barre du haut de l'admin) ou dans le formulaire d'ajout d'un plat
(avec confirmation, car elle change pour tout le restaurant).

## Langues

Anglais, français, allemand et arabe (de droite à gauche), au choix sur chaque interface (liste de langues en haut de l'écran).
Le client voit d'abord la langue de son téléphone.

## Impression

Les factures et additions s'impriment sur l'imprimante de tickets thermique (**80 mm** par défaut, 58 mm) ou sur une imprimante A4 :
choisir le format du papier à côté du bouton d'impression (mémorisé sur le poste), puis l'imprimante dans la boîte d'impression
du navigateur. Le client peut **enregistrer son addition en image** ou l'imprimer / l'enregistrer en PDF depuis son téléphone.

## Rapports et tableau de bord (admin)

- Tableau de bord : chiffres du jour (ou 7 jours / mois / année), avec la période affichée ; plats les plus commandés sur les 30 derniers jours.
- Rapports : filtre par **jour**, **mois** ou **année**, comparaison avec la période précédente, graphiques du chiffre d'affaires,
  des commandes et de la **fréquentation des clients** (visites par jour, par jour de la semaine et par heure), plats, caissiers.
  Une visite = une table qui a passé au moins une commande.

## Hébergement (plusieurs restaurants en ligne)

- Mettre le serveur Node derrière un reverse proxy **HTTPS** (Nginx, Caddy...). Le proxy doit laisser passer `/socket.io` en WebSocket.
- `server/config.env` : `PUBLIC_URL` (adresse publique, utilisée dans les QR codes), `TRUST_PROXY=true` derrière un proxy,
  `ALLOW_SIGNUP=false` pour fermer l'inscription de nouveaux restaurants, `AUTH_SECRET` (secret de signature des connexions ;
  sinon généré et gardé dans `server/.auth-secret`, à ne pas partager ni perdre : sa perte déconnecte tout le monde).
- Prévoir un disque durable pour `server/public/images` (photos des plats) et des **sauvegardes régulières de la base MySQL**.
- Les connexions des caissiers en cours (présence) sont gardées en mémoire : un seul processus serveur.
- Sécurité : mots de passe hachés (bcrypt), connexions par jeton signé, essais de connexion limités, chaque requête du personnel est
  limitée au restaurant de son compte, les prix d'une commande sont recalculés par le serveur à partir du menu.
- Pas encore prévu : la réinitialisation du mot de passe admin par e-mail (l'admin connecté peut changer son mot de passe).

