# Plutus IDE Backend

## Description

Ce dossier contient le backend et l'interface web d'un IDE orienté contrats Cardano. Le projet permet de s'authentifier, de manipuler un espace de travail personnel, d'éditer et compiler des fichiers Plutus/Haskell et Aiken, puis de récupérer les artefacts générés.

Ce README décrit uniquement ce qui est effectivement présent dans le dossier `backend`, sans couvrir les parties RAG ni les fonctionnalités liées à l'IA.

## Ce qui a été réalisé

- Authentification utilisateur avec inscription, connexion, déconnexion et session persistée via Redis.
- Interface IDE web avec page de connexion, éditeur Monaco, panneau de logs, terminal intégré et gestion de fichiers.
- Espaces de travail isolés par utilisateur dans des conteneurs Docker.
- Gestion des fichiers Plutus/Haskell : lecture, création, sauvegarde, suppression, création de dossiers et recherche dans le workspace.
- Support d'un workspace Aiken par utilisateur avec initialisation automatique du projet.
- Compilation Plutus/Haskell via Docker avec diffusion des logs en temps réel en SSE.
- Compilation Aiken via Docker avec restitution des validateurs compilés.
- Mise en cache des compilations, suivi des jobs, stockage temporaire des logs et des artefacts.
- Téléchargement des scripts compilés au format `.plutus`.
- Diagnostics de compilation structurés pour faciliter l'affichage des erreurs.
- Templates embarqués pour démarrer rapidement sur des exemples de contrats.
- Endpoints de supervision : santé du service, versions d'outillage et métriques d'exécution.
- Limitation de charge : file d'attente de builds, timeout et rate limiting.

## Fonctionnalités principales

### 1. Authentification et sessions

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`

Les utilisateurs sont stockés dans Redis et les mots de passe sont hachés avec `bcrypt`. Les sessions HTTP sont elles aussi stockées dans Redis.

### 2. Workspace Plutus/Haskell

Le backend expose des routes pour manipuler les fichiers d'un utilisateur dans le conteneur `plutus-runner` :

- `GET /workspace/files`
- `GET /workspace/file`
- `POST /workspace/create`
- `POST /workspace/save`
- `POST /workspace/mkdir`
- `DELETE /workspace/delete`
- `GET /workspace/search`
- `POST /workspace/compile`

Le serveur applique aussi une validation simple des chemins pour éviter les traversées de répertoires (`..`, chemins absolus).

### 3. Compilation Plutus/Haskell

- `POST /compile`

La compilation :

- fonctionne en streaming SSE pour remonter les logs en direct ;
- peut compiler un fichier du workspace ou du code envoyé depuis l'éditeur ;
- détecte et injecte automatiquement un `main` si nécessaire pour produire un script Plutus ;
- conserve un statut de job, des logs et des artefacts téléchargeables ;
- réutilise le cache si le code compilé est déjà connu.

Endpoints liés aux jobs :

- `GET /job/:jobId/status`
- `GET /job/:jobId/log`
- `GET /job/:jobId/errors`
- `GET /job/:jobId/artifact`
- `GET /job/:jobId/download`
- `GET /job/:jobId/files`
- `GET /job/:jobId/file/:name`

### 4. Workspace et compilation Aiken

Le backend intègre aussi un flux dédié à Aiken dans le conteneur `aiken-runner`.

Routes disponibles :

- `GET /aiken/init`
- `GET /aiken/workspace/files`
- `GET /aiken/workspace/file`
- `POST /aiken/workspace/create`
- `POST /aiken/workspace/save`
- `POST /aiken/workspace/mkdir`
- `DELETE /aiken/workspace/delete`
- `POST /aiken/compile`
- `POST /aiken/check`
- `GET /aiken/version`

Chaque utilisateur dispose d'un projet Aiken persistant initialisé automatiquement au premier accès.

### 5. Templates embarqués

Le projet expose des templates côté backend :

- `GET /templates`
- `GET /templates/:id`

Les exemples actuellement fournis dans `server/templates.js` sont :

- `Vesting`
- `NFTMarketPlace`

### 6. Supervision et métriques

- `GET /health`
- `GET /version`
- `GET /admin/metrics`

Le backend suit notamment :

- le nombre de jobs lancés ;
- les échecs par type ;
- les hits et misses du cache ;
- l'état de la file d'attente ;
- les limites de timeout et de débit.

## Stack technique

- Backend : Node.js, Express
- Frontend : HTML, CSS, JavaScript vanilla, Monaco Editor
- Stockage : Redis
- Authentification : `express-session`, `connect-redis`, `bcrypt`
- Compilation : Docker, Haskell/Plutus, Aiken

## Prérequis

- Node.js
- Redis
- Docker
- Un conteneur `plutus-runner` disponible pour la compilation Plutus/Haskell
- Un conteneur `aiken-runner` disponible pour la compilation Aiken

## Installation

```bash
cd backend
npm install
```

Configurer ensuite les services nécessaires :

- démarrer Redis ;
- s'assurer que les conteneurs Docker requis sont accessibles ;
- définir les variables d'environnement nécessaires.

## Configuration

Variables observées dans le code :

- `REDIS_URL`
- `SESSION_SECRET`

Constantes applicatives définies dans `server/constants.js` :

- `MAX_CONCURRENT`
- `MAX_QUEUE`
- `JOB_TIMEOUT_MS`
- `MAX_OUTPUT_MB`
- `RATE_LIMIT_MAX`

Par défaut, le serveur écoute sur le port `3000`.

## Lancement

```bash
npm run dev
```

Puis ouvrir :

- `http://localhost:3000/login`

## Structure du dossier

```text
backend/
├── frontend/
│   ├── index.html
│   ├── login.html
│   ├── ide-core.js
│   ├── ide-workspace.js
│   ├── ide-compile.js
│   ├── ide-terminal.js
│   └── ide-styles.css
├── server/
│   ├── auth/
│   │   └── auth.js
│   ├── config/
│   │   └── db.js
│   ├── aiken-compile.js
│   ├── cache.js
│   ├── constants.js
│   ├── jobQueue.js
│   ├── middleware.js
│   ├── server.js
│   ├── templates.js
│   └── utils.js
├── package.json
├── README.md
└── README_FR.md
```

## Sécurité et limites déjà en place

- Hashage des mots de passe avec `bcrypt`
- Sessions stockées côté serveur
- Validation basique des chemins de fichiers
- Rate limiting
- File d'attente de compilation
- Timeout de build
- Limitation de la taille de sortie

## Licence

ISC
