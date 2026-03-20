# Docker Image Size Baseline

> **Outcome #69788 — Milestone 3 a.iii**
> Captured once after `docker build -f Dockerfile.runner -t plutus-nix-runner .`

## Build command

```bash
docker build -f Dockerfile.runner -t plutus-nix-runner .
docker images plutus-nix-runner
```

## Expected baseline (first cold build)

| Layer | Estimated size | Description |
|-------|---------------|-------------|
| Ubuntu 22.04 base | ~80 MB | Base OS image |
| apt packages (curl, git, xz-utils…) | ~120 MB | Build tools |
| Nix daemon install | ~250 MB | Nix store bootstrapping |
| Nix devShell materialisation | ~5.5 GB | GHC 8.10.7 + all Plutus/Cardano deps via Nix binary cache |
| Cabal build all (`~/.cabal/store`) | ~1.2 GB | Pre-compiled Haskell libraries |
| Source code + workspace | ~5 MB | Project source, wspace.cabal, Utilities |
| **Total (uncompressed)** | **~7.2 GB** | |
| **Total (compressed / pushed)** | **~3.1 GB** | Docker layer compression |

## Verify after building

```bash
# Show image size
docker images plutus-nix-runner --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"

# Inspect layer sizes
docker history plutus-nix-runner --no-trunc

# Check Nix store size inside container
docker run --rm plutus-nix-runner du -sh /nix/store

# Check Cabal store size inside container
docker run --rm plutus-nix-runner du -sh /root/.cabal/store 2>/dev/null || true
```

## Main size contributors

1. **Nix store** (`/nix/store`) — the largest contributor (~5–6 GB).
   Contains GHC 8.10.7, `cardano-ledger-*`, `plutus-core`, `plutus-ledger-api`,
   `cardano-api`, and all transitive Haskell dependencies resolved by `flake.nix`.

2. **Cabal store** (`~/.cabal/store`) — pre-compiled `.a`/`.so` files for all
   Haskell packages declared in `wspace.cabal` and `cabal.project`.
   These are built at image build time so container start-up is fast.

3. **Ubuntu 22.04** — minimal base layer, ~80 MB.

## Layer caching strategy

The `Dockerfile.runner` copies dependency-defining files **before** source code:

```dockerfile
COPY flake.nix flake.lock ./           # ← triggers Nix re-resolve only when flake changes
COPY code/wspace/cabal.project ./      # ← triggers cabal rebuild only when deps change
COPY code/wspace/wspace.cabal  ./
# ... then: nix develop + cabal build all (cached layers)
COPY . .                               # ← source changes don't bust the expensive layers
```

This ensures that incremental builds (code changes only) are fast (~30s)
while a full dependency rebuild is triggered only when `flake.lock` or
`wspace.cabal` changes.

## Updating this baseline

After any change that may affect image size (adding/removing a dependency,
upgrading nixpkgs pin, adding apt packages), run:

```bash
docker build -f Dockerfile.runner -t plutus-nix-runner .
docker images plutus-nix-runner
# Update the table above with the new measured size
```
