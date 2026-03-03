## PRD — Cardano Smart Contract Studio (multi-language)

Author: Bernard Sibanda

Company: Coxygen Global Pty Ltd

Date: 03-03-2026

### 1) Product vision

Being in Cardano since 2022 and strictly being on smart contract development languages, experience has taught us that there is no one best language. Also working extensively with 
student developers who mostly are new to blockchain, there is a measurable degree of frustration for beginners and even old developers caused by these:

- migration from imparative to functional programming paradigm.
- migration from windows culture to linux culture.
- expensive hardware resources needed -32GB RAM, 1TB SSD, multicore CPU
- migration from propriatory to open source loss of IP, sharing code via github
- tooling and hosting difficulties: nix, cabal, etc Haskell hosting is not very popular thus expensive
- deployment environment not as easy as the most popular CMS e.g. wordpress, most cloud services need about $400
- lack of Ethereum Remix online IDE playground
  
From this experience, it is clear that an online playground similar to Ethereum Remix is the best option but in order to be language inclusive, it must not only cater for Plutus/Plinth Haskell but for other languages as well. This is the logical next step:- create a studio playground - Plutus Playground because all Cardano Smart Contract 
development languages compile to UPLC - Untyped Plutus Core.

Aim:

A browser-based **developer studio** that lets users write, compile, simulate, and export smart contracts across multiple Cardano ecosystems—while keeping outputs **reproducible** (pinned toolchains) and **interoperable** (shared artifact format + shared simulation UX).

### 2) Language & framework scope

#### Cardano “On-chain (UPLC)” languages (compile to UPLC/CBOR)

* **Plutus/Plinth** (Haskell subset → UPLC via GHC plugin-style pipeline) ([plutus.cardano.intersectmbo.org][1])
* **Plutarch** (typed Haskell eDSL for efficient Plutus Core validators) ([developers.cardano.org][2])
* **Aiken** (modern Cardano smart contract language/toolkit; compiles to Plutus Core/UPLC) ([aiken-lang.org][3])
* **Helios** (DSL compiling to Plutus Core, JS toolchain) ([GitHub][4])
* **OpShin** (strict subset of valid Python; aims for on-chain eval parity) ([opshin.opshin.dev][5])
* **Scalus** (Scala 3; compiles to Plutus Core/UPLC) ([developers.cardano.org][6])
* **Pebble** (strongly-typed DSL targeting UPLC) ([pluts.harmoniclabs.tech][7])
* **plu-ts (onchain)** (TypeScript-hosted eDSL generating smart contracts; plus offchain helpers) ([harmoniclabs.tech][8])

#### Contract DSL

* **Marlowe** (builder + analysis + simulation centered “playground” experience) ([docs.marlowe.iohk.io][9])

#### Off-chain frameworks (transaction building + dApp logic)

* **Lucid** (JS/TS library to build Cardano transactions and off-chain code for Plutus contracts) ([GitHub][10])
* **MeshJS** (Cardano TypeScript SDK with transaction builder + dApp tooling) ([Mesh SDK][11])

#### Other network mode

* **Midnight (Compact)**: separate track; Compact compiler outputs ZK circuits; not UPLC/Cardano. ([academy.midnight.network][12])

#### Knowledge/patterns (not a compiler target)

* **Plutonomicon**: embed as “Patterns & pitfalls” reference panel (optimization, vulnerabilities, practices). ([GitHub][13])

### 3) Personas

1. **Learner**: templates + instant compile + guided simulation.
2. **Contract dev**: fast iteration, budget/size checks, export deployable artifacts.
3. **Reviewer/Auditor**: deterministic builds, version pinning, readable UPLC, reproducible links.
4. **Team**: workspaces, RBAC, private share links, audit logs.

### 4) Core user journeys

#### A) Create & compile (any on-chain language)

* Choose **Network: Cardano (UPLC)** → choose language template → edit → Compile
* Outputs: **UPLC**, **CBOR**, **hash**, **size**, **budget report**, **toolchain manifest**

#### B) Simulate

* Quick-run fixture (template-provided) or advanced context builder
* Result: pass/fail + traces + cost/budget

#### C) Export

* Download bundle: `.cbor/.plutus`, `.uplc`, `metadata.json` (toolchain + hashes + budgets)

#### D) Off-chain integration (Lucid/Mesh)

* Create “Off-chain workspace” → import compiled script artifacts → build tx → export blueprint payload(s)

#### E) Share & fork

* Share read-only link to a specific **Project Version** (reproducible)
* Fork into own workspace

### 5) Feature requirements

#### 5.1 Universal features (all languages)

* Monaco editor, multi-file projects
* Template gallery + sample inputs
* Job streaming logs (SSE/WebSocket)
* Toolchain selector (pinned versions)
* Share/fork/export

#### 5.2 On-chain (UPLC) standardized outputs

Every UPLC language adapter must emit:

* `uplc.pretty`
* `uplc.raw` (optional)
* `script.cbor` (hex + file)
* `scriptHash` (+ validator hash / policy ID)
* `sizeBytes`
* `budgetReport` (cpu/mem/steps when supported)
* `toolchain` manifest (pinned + container digest)
* `reproChecksum` (hash(source + toolchain + adapter))

#### 5.3 Marlowe mode

* Visual builder + code/JSON view
* Simulation timeline & analysis tools (behavior without deployment) ([docs.marlowe.iohk.io][9])
* Export: Marlowe JSON + deployment pack (later)

#### 5.4 Midnight mode (Compact)

* Separate compiler + artifact types
* Separate simulation + export formats (ZK circuit outputs, etc.) ([docs.midnight.network][14])

#### 5.5 Plutonomicon panel

* Searchable patterns library
* Contextual hints (e.g., size/budget pitfalls, common vulnerabilities) ([GitHub][13])

### 6) MVP rollout

1. **UPLC Track v1**: Aiken + Helios + OpShin + Pebble (fastest toolchains) ([aiken-lang.org][3])
2. Add **Plutus/Plinth + Plutarch** ([plutus.cardano.intersectmbo.org][1])
3. Add **Scalus** ([developers.cardano.org][6])
4. Add **Lucid + Mesh** off-chain workspaces ([GitHub][10])
5. Add **Marlowe** mode ([docs.marlowe.iohk.io][9])
6. Add **Midnight (Compact)** mode ([docs.midnight.network][14])

### 7) Success metrics

* Compile success rate by template/language
* Median “edit → compile” latency (warm)
* % reproducible builds (same source+toolchain → same hash)
* Simulation usage rate
* Share/fork conversion

## Technical Design Doc — Adapter-based architecture

### 1) Architecture overview

**Front-end**

* Language picker: `Network = {Cardano(UPLC), Midnight(Compact)}` → `Mode = {On-chain, Off-chain, DSL}`
* Editor + templates + output panels
* Job runner UI (SSE log stream)

**Back-end**

* API Gateway (auth, projects, share links, toolchains, job submit/status)
* Job Queue (priority tiers)
* Worker pools (by runtime/toolchain family)
* Artifact store (S3-compatible) + Postgres metadata
* Build cache (content-addressed) keyed by `(adapterId, toolchainId, sourceHash)`

### 2) The key abstraction: LanguageAdapter

Every language integrates via an **adapter contract** so the platform stays stable.

#### 2.1 Adapter interface (concept)

```ts
interface LanguageAdapter {
  id: string;                // e.g. "aiken", "plinth", "opshin"
  displayName: string;
  network: "cardano-uplc" | "midnight-compact" | "marlowe";
  mode: "onchain" | "offchain" | "dsl";

  editor: {
    fileExtensions: string[];
    syntax: string;          // monaco language id
    formatter?: "none" | "prettier" | "ormolu" | "fourmolu" | "aikenfmt" | "custom";
  };

  toolchains: ToolchainDescriptor[];  // pinned versions (container digests)

  compile?: (input: ProjectSource, toolchain: ToolchainRef) => CompileResult;
  evaluate?: (artifacts: CompileResult, evalInput: EvalInput) => EvalResult;
  simulate?: (artifacts: CompileResult, simInput: SimInput) => SimResult;

  normalizeArtifacts: (raw: any) => StandardArtifacts; // maps to platform output schema
  fixtures: FixturePack; // templates + sample datum/redeemer/context etc.
}
```

#### 2.2 Standard artifacts schema (Cardano UPLC)

* Always return the “universal bundle” fields (UPLC/CBOR/hash/size/budget/manifest).
* For languages that can’t compute certain metrics natively, the platform runs **post-processing**:

  * CBOR decode/size
  * Script hash computation
  * Budget evaluation via a shared evaluator (when possible)

### 3) Worker pool strategy (runtime families)

* **Haskell/GHC**: Plinth/PlutusTx, Plutarch
* **Rust**: Aiken toolchain
* **Node**: Helios, plu-ts (compile/eval if supported), off-chain workspaces (Lucid/Mesh)
* **Python**: OpShin
* **JVM**: Scalus
* **DSL**: Marlowe
* **Midnight**: Compact toolchain

Each worker image:

* No outbound network
* Strict CPU/mem/time quotas
* Read-only base FS + ephemeral workspace
* Attested/pinned by **image digest** for reproducibility

### 4) Deterministic builds & caching

* Project version has a `sourceHash` computed from:

  * normalized file tree (paths + contents)
  * adapter ID
  * toolchain ID (and container digest)
* Build cache keyed by `(sourceHash, toolchainDigest)`
* Cache stores:

  * compile outputs
  * logs
  * derived metrics (hash/size/budget)

### 5) Off-chain workspaces (Lucid + Mesh + plu-ts/offchain)

A distinct project type:

* `mode = offchain`
* Adds “dependency slots” to import artifacts from **on-chain projects**:

  * attach validator/policy by version ID
  * auto-generate TypeScript helper stubs (optional)
* Supports providers:

  * mock provider (UTxO fixtures)
  * emulator hooks (post-MVP)
* Export:

  * tx blueprint JSON
  * signing payloads / metadata

Why both Lucid + Mesh:

* Lucid focuses on “easy off-chain + tx building” ([GitHub][10])
* Mesh positions as a broad TS SDK with tx builder APIs ([Mesh SDK][11])

### 6) Security model

* Multi-tenant isolation: per-job containers, no shared writable volumes
* Rate limit per IP/user + per-workspace quotas
* Artifact scanning + size limits
* Abuse detection: compile spam, fork bombs, resource exhaustion

## OpenAPI spec (skeleton) — jobs, artifacts, sharing, toolchains

```yaml
openapi: 3.1.0
info:
  title: Cardano Smart Contract Studio API
  version: 0.1.0
servers:
  - url: https://api.example.com

tags:
  - name: Toolchains
  - name: Projects
  - name: Jobs
  - name: Artifacts
  - name: Sharing

paths:
  /languages:
    get:
      tags: [Toolchains]
      summary: List supported languages and modes
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  languages:
                    type: array
                    items:
                      $ref: "#/components/schemas/Language"

  /toolchains:
    get:
      tags: [Toolchains]
      summary: List toolchains (pinned compiler bundles)
      parameters:
        - in: query
          name: languageId
          schema: { type: string }
        - in: query
          name: network
          schema: { type: string, enum: [cardano-uplc, midnight-compact, marlowe] }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  toolchains:
                    type: array
                    items:
                      $ref: "#/components/schemas/Toolchain"

  /projects:
    post:
      tags: [Projects]
      summary: Create a project
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/CreateProjectRequest" }
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Project" }
    get:
      tags: [Projects]
      summary: List projects (caller-visible)
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  projects:
                    type: array
                    items: { $ref: "#/components/schemas/Project" }

  /projects/{projectId}:
    get:
      tags: [Projects]
      summary: Get project
      parameters:
        - in: path
          name: projectId
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Project" }

  /projects/{projectId}/versions:
    post:
      tags: [Projects]
      summary: Create a version (snapshot of source + toolchain selection)
      parameters:
        - in: path
          name: projectId
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/CreateVersionRequest" }
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ProjectVersion" }
    get:
      tags: [Projects]
      summary: List versions
      parameters:
        - in: path
          name: projectId
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  versions:
                    type: array
                    items: { $ref: "#/components/schemas/ProjectVersion" }

  /jobs:
    post:
      tags: [Jobs]
      summary: Submit a job (compile/eval/simulate)
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/SubmitJobRequest" }
      responses:
        "202":
          description: Accepted
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Job" }

  /jobs/{jobId}:
    get:
      tags: [Jobs]
      summary: Get job status + result pointers
      parameters:
        - in: path
          name: jobId
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Job" }

  /jobs/{jobId}/stream:
    get:
      tags: [Jobs]
      summary: Stream logs via Server-Sent Events (SSE)
      parameters:
        - in: path
          name: jobId
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: text/event-stream

  /artifacts/{artifactId}:
    get:
      tags: [Artifacts]
      summary: Download an artifact blob (uplc, cbor, logs, bundles)
      parameters:
        - in: path
          name: artifactId
          required: true
          schema: { type: string, format: uuid }
      responses:
        "302":
          description: Redirect to signed URL
        "200":
          description: Artifact bytes
          content:
            application/octet-stream: {}

  /shares:
    post:
      tags: [Sharing]
      summary: Create a share link to a project or version
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/CreateShareRequest" }
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ShareLink" }

  /shares/{token}:
    get:
      tags: [Sharing]
      summary: Resolve a share token to a project/version
      parameters:
        - in: path
          name: token
          required: true
          schema: { type: string }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ShareResolveResponse" }

components:
  schemas:
    Language:
      type: object
      properties:
        id: { type: string }
        displayName: { type: string }
        network: { type: string, enum: [cardano-uplc, midnight-compact, marlowe] }
        mode: { type: string, enum: [onchain, offchain, dsl] }
        fileExtensions:
          type: array
          items: { type: string }
      required: [id, displayName, network, mode]

    Toolchain:
      type: object
      properties:
        id: { type: string }
        languageId: { type: string }
        version: { type: string }
        containerDigest: { type: string, description: "Immutable image digest for reproducibility" }
        runtimeFamily: { type: string, enum: [ghc, rust, node, python, jvm, dsl, midnight] }
        createdAt: { type: string, format: date-time }
      required: [id, languageId, version, containerDigest, runtimeFamily]

    CreateProjectRequest:
      type: object
      properties:
        name: { type: string }
        languageId: { type: string }
        network: { type: string, enum: [cardano-uplc, midnight-compact, marlowe] }
        mode: { type: string, enum: [onchain, offchain, dsl] }
        visibility: { type: string, enum: [private, unlisted, public] }
      required: [name, languageId, network, mode]

    Project:
      type: object
      properties:
        id: { type: string, format: uuid }
        name: { type: string }
        languageId: { type: string }
        network: { type: string }
        mode: { type: string }
        visibility: { type: string }
        createdAt: { type: string, format: date-time }
        updatedAt: { type: string, format: date-time }
      required: [id, name, languageId, network, mode, visibility]

    CreateVersionRequest:
      type: object
      properties:
        toolchainId: { type: string }
        files:
          type: array
          items:
            $ref: "#/components/schemas/SourceFile"
      required: [toolchainId, files]

    SourceFile:
      type: object
      properties:
        path: { type: string }
        content: { type: string }
      required: [path, content]

    ProjectVersion:
      type: object
      properties:
        id: { type: string, format: uuid }
        projectId: { type: string, format: uuid }
        toolchainId: { type: string }
        sourceHash: { type: string }
        createdAt: { type: string, format: date-time }
      required: [id, projectId, toolchainId, sourceHash]

    SubmitJobRequest:
      type: object
      properties:
        type: { type: string, enum: [compile, evaluate, simulate, bundleExport] }
        projectVersionId: { type: string, format: uuid }
        input:
          type: object
          additionalProperties: true
      required: [type, projectVersionId]

    Job:
      type: object
      properties:
        id: { type: string, format: uuid }
        type: { type: string }
        status: { type: string, enum: [queued, running, succeeded, failed, canceled] }
        projectVersionId: { type: string, format: uuid }
        createdAt: { type: string, format: date-time }
        startedAt: { type: string, format: date-time, nullable: true }
        finishedAt: { type: string, format: date-time, nullable: true }
        logsArtifactId: { type: string, format: uuid, nullable: true }
        result:
          $ref: "#/components/schemas/JobResult"
      required: [id, type, status, projectVersionId, createdAt]

    JobResult:
      type: object
      properties:
        artifacts:
          type: array
          items: { $ref: "#/components/schemas/ArtifactRef" }
        metrics:
          type: object
          additionalProperties: true

    ArtifactRef:
      type: object
      properties:
        id: { type: string, format: uuid }
        kind: { type: string, enum: [uplcPretty, uplcRaw, cbor, metadataJson, exportZip, logs] }
        bytes: { type: integer }
      required: [id, kind, bytes]

    CreateShareRequest:
      type: object
      properties:
        projectId: { type: string, format: uuid, nullable: true }
        projectVersionId: { type: string, format: uuid, nullable: true }
        permission: { type: string, enum: [read] }
        expiresAt: { type: string, format: date-time, nullable: true }
      required: [permission]

    ShareLink:
      type: object
      properties:
        token: { type: string }
        url: { type: string }
        permission: { type: string }
        expiresAt: { type: string, format: date-time, nullable: true }
      required: [token, url, permission]

    ShareResolveResponse:
      type: object
      properties:
        project: { $ref: "#/components/schemas/Project" }
        version: { $ref: "#/components/schemas/ProjectVersion" }
      required: []
```

---

## DB schema (PostgreSQL/mysql) — core tables

```sql
-- Users & org
create table users (
  id uuid primary key,
  email text unique not null,
  password_hash text,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key,
  name text not null,
  owner_user_id uuid not null references users(id),
  created_at timestamptz not null default now()
);

create table workspace_memberships (
  workspace_id uuid not null references workspaces(id),
  user_id uuid not null references users(id),
  role text not null check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- Toolchains (pinned compiler bundles)
create table toolchains (
  id text primary key, -- stable id like "aiken-1.2.3" or uuid; keep simple
  language_id text not null,
  network text not null check (network in ('cardano-uplc','midnight-compact','marlowe')),
  version text not null,
  runtime_family text not null check (runtime_family in ('ghc','rust','node','python','jvm','dsl','midnight')),
  container_digest text not null, -- immutable image digest
  created_at timestamptz not null default now()
);

-- Projects & versions
create table projects (
  id uuid primary key,
  workspace_id uuid references workspaces(id),
  owner_user_id uuid not null references users(id),
  name text not null,
  language_id text not null,
  network text not null check (network in ('cardano-uplc','midnight-compact','marlowe')),
  mode text not null check (mode in ('onchain','offchain','dsl')),
  visibility text not null check (visibility in ('private','unlisted','public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table project_versions (
  id uuid primary key,
  project_id uuid not null references projects(id) on delete cascade,
  toolchain_id text not null references toolchains(id),
  source_hash text not null, -- content-addressed snapshot hash
  created_at timestamptz not null default now(),
  unique(project_id, source_hash, toolchain_id)
);

create table version_files (
  version_id uuid not null references project_versions(id) on delete cascade,
  path text not null,
  content text not null,
  primary key (version_id, path)
);

-- Jobs & artifacts
create table jobs (
  id uuid primary key,
  type text not null check (type in ('compile','evaluate','simulate','bundleExport')),
  status text not null check (status in ('queued','running','succeeded','failed','canceled')),
  project_version_id uuid not null references project_versions(id) on delete cascade,
  input_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_text text
);

create table artifacts (
  id uuid primary key,
  job_id uuid references jobs(id) on delete set null,
  version_id uuid references project_versions(id) on delete set null,
  kind text not null check (kind in ('uplcPretty','uplcRaw','cbor','metadataJson','exportZip','logs','marloweJson','compactArtifact')),
  bytes bigint not null,
  content_type text not null,
  storage_key text not null, -- object storage key
  sha256 text not null,
  created_at timestamptz not null default now()
);

-- Share links
create table share_links (
  token text primary key,
  project_id uuid references projects(id) on delete cascade,
  project_version_id uuid references project_versions(id) on delete cascade,
  permission text not null check (permission in ('read')),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- Cross-project linking (e.g., offchain project imports onchain artifacts)
create table project_links (
  id uuid primary key,
  from_project_id uuid not null references projects(id) on delete cascade,
  to_project_version_id uuid not null references project_versions(id) on delete cascade,
  link_type text not null check (link_type in ('importsScript','usesTypes','usesBlueprint')),
  created_at timestamptz not null default now()
);

-- Quotas / usage (optional but recommended)
create table usage_counters (
  id uuid primary key,
  owner_user_id uuid not null references users(id),
  day date not null,
  cpu_ms bigint not null default 0,
  mem_mb_ms bigint not null default 0,
  jobs_count int not null default 0,
  unique(owner_user_id, day)
);
```

## Sequence diagrams (Mermaid)

### 1) Compile (UPLC language)

<img width="1504" height="773" alt="1  compile-uplc-languages" src="https://github.com/user-attachments/assets/093f2097-2d06-4640-bce2-e24066f25d52" />

### 2) Simulate/Evaluate

<img width="1504" height="773" alt="2  simulate-evaluate" src="https://github.com/user-attachments/assets/ef4914ab-66e0-438f-8b20-ced4fb45673b" />

### 3) Share + fork

<img width="1504" height="773" alt="3  share-fork" src="https://github.com/user-attachments/assets/31fe365d-bdf2-461e-8cda-910a0cc1dfcb" />

### 4) Export bundle

<img width="1504" height="773" alt="4  export-bundle" src="https://github.com/user-attachments/assets/7b498437-69b7-4fc7-837c-59c94b2eaeb3" />

### 5) Off-chain workspace (Lucid/Mesh) attaches on-chain script

<img width="1504" height="773" alt="5  offchain-workspace" src="https://github.com/user-attachments/assets/005382d8-18d4-4141-b910-667eb82d8eff" />


[1]: https://plutus.cardano.intersectmbo.org/docs/delve-deeper/languages?utm_source=chatgpt.com "Overview of Languages Compiling to UPLC | Plinth and Plutus Core ..."
[2]: https://developers.cardano.org/docs/build/smart-contracts/languages/plutarch/overview/?utm_source=chatgpt.com "Plutarch (Haskell) | Cardano Developer Portal"
[3]: https://aiken-lang.org/?utm_source=chatgpt.com "Aiken | The modern smart contract platform for Cardano"
[4]: https://github.com/ahaxu/Helios?utm_source=chatgpt.com "GitHub - ahaxu/Helios: Helios Lang reference compiler"
[5]: https://opshin.opshin.dev/opshin/?utm_source=chatgpt.com "opshin API documentation"
[6]: https://developers.cardano.org/docs/build/smart-contracts/languages/scalus/?utm_source=chatgpt.com "Scalus | Cardano Developer Portal"
[7]: https://pluts.harmoniclabs.tech/?utm_source=chatgpt.com "pluts.harmoniclabs.tech - Pebble"
[8]: https://www.harmoniclabs.tech/plu-ts-docs/index.html?utm_source=chatgpt.com "Introduction - plu-ts documentation - Harmonic Labs"
[9]: https://docs.marlowe.iohk.io/tutorials/concepts/playground-overview?utm_source=chatgpt.com "The Marlowe Playground - IOHK"
[10]: https://github.com/spacebudz/lucid?utm_source=chatgpt.com "GitHub - spacebudz/lucid: Lucid is a library designed to simplify ..."
[11]: https://meshjs.dev/?utm_source=chatgpt.com "MeshJS - Cardano TypeScript SDK for dApp Development"
[12]: https://academy.midnight.network/?utm_source=chatgpt.com "Midnight | Bringing rational privacy to blockchain"
[13]: https://github.com/Plutonomicon/plutonomicon?utm_source=chatgpt.com "Advanced techniques in the plutus smart contract language"
[14]: https://docs.midnight.network/compact?utm_source=chatgpt.com "The Compact language | Midnight Docs - docs.midnight.network"
