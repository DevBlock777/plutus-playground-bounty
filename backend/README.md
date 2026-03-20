# Plutus IDE Backend

## Description

This folder contains the backend and web interface for a Cardano smart contract IDE. The project lets users authenticate, manage a personal workspace, edit and compile Plutus/Haskell and Aiken files, and retrieve the generated artifacts.

This README only documents what is actually implemented in the `backend` folder, and intentionally excludes RAG and AI-related features.

## What Has Been Built

- User authentication with registration, login, logout, and Redis-backed sessions.
- Web IDE interface with login page, Monaco editor, logs panel, terminal-style output, and file management UI.
- Per-user isolated workspaces inside Docker containers.
- Plutus/Haskell file management: read, create, save, delete, create folders, and search within the workspace.
- Aiken workspace support with automatic project initialization per user.
- Plutus/Haskell compilation through Docker with real-time SSE log streaming.
- Aiken compilation through Docker with validator artifact extraction.
- Compilation cache, job tracking, temporary log retention, and artifact storage.
- Download of compiled scripts in `.plutus` format.
- Structured compilation diagnostics for easier error display.
- Built-in templates for quickly starting from sample contracts.
- Operational endpoints for health checks, toolchain versions, and runtime metrics.
- Load control with build queueing, timeout handling, and rate limiting.

## Main Features

### 1. Authentication and Sessions

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`

Users are stored in Redis and passwords are hashed with `bcrypt`. HTTP sessions are also stored in Redis.

### 2. Plutus/Haskell Workspace

The backend exposes routes to manage user files inside the `plutus-runner` container:

- `GET /workspace/files`
- `GET /workspace/file`
- `POST /workspace/create`
- `POST /workspace/save`
- `POST /workspace/mkdir`
- `DELETE /workspace/delete`
- `GET /workspace/search`
- `POST /workspace/compile`

The server also applies basic path validation to prevent directory traversal (`..`, absolute paths).

### 3. Plutus/Haskell Compilation

- `POST /compile`

Compilation:

- streams logs in real time over SSE;
- can compile either a workspace file or code sent directly from the editor;
- automatically injects a `main` function when needed to produce a Plutus script;
- stores job status, logs, and downloadable artifacts;
- reuses cached compilation output when available.

Job-related endpoints:

- `GET /job/:jobId/status`
- `GET /job/:jobId/log`
- `GET /job/:jobId/errors`
- `GET /job/:jobId/artifact`
- `GET /job/:jobId/download`
- `GET /job/:jobId/files`
- `GET /job/:jobId/file/:name`

### 4. Aiken Workspace and Compilation

The backend also includes a dedicated Aiken flow using the `aiken-runner` container.

Available routes:

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

Each user gets a persistent Aiken project automatically initialized on first access.

### 5. Built-in Templates

The backend exposes templates through:

- `GET /templates`
- `GET /templates/:id`

The examples currently defined in `server/templates.js` are:

- `Vesting`
- `NFTMarketPlace`

### 6. Monitoring and Metrics

- `GET /health`
- `GET /version`
- `GET /admin/metrics`

The backend tracks:

- total jobs;
- failures by type;
- cache hits and misses;
- queue state;
- timeout and rate-limit settings.

## Tech Stack

- Backend: Node.js, Express
- Frontend: HTML, CSS, vanilla JavaScript, Monaco Editor
- Storage: Redis
- Authentication: `express-session`, `connect-redis`, `bcrypt`
- Compilation: Docker, Haskell/Plutus, Aiken

## Prerequisites

- Node.js
- Redis
- Docker
- A `plutus-runner` container available for Plutus/Haskell compilation
- An `aiken-runner` container available for Aiken compilation

## Installation

```bash
cd backend
npm install
```

Then configure the required services:

- start Redis;
- make sure the required Docker containers are available;
- define the required environment variables.

## Configuration

Environment variables observed in the code:

- `REDIS_URL`
- `SESSION_SECRET`

Application constants defined in `server/constants.js`:

- `MAX_CONCURRENT`
- `MAX_QUEUE`
- `JOB_TIMEOUT_MS`
- `MAX_OUTPUT_MB`
- `RATE_LIMIT_MAX`

By default, the server runs on port `3000`.

## Running

```bash
npm run dev
```

Then open:

- `http://localhost:3000/login`

## Folder Structure

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

## Security and Runtime Limits

- Password hashing with `bcrypt`
- Server-side session storage
- Basic file path validation
- Rate limiting
- Build queueing
- Build timeout
- Output size limits

## License

ISC
