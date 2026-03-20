#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
#  compile.sh — Headless Plutus compiler CLI
#  Outcome #69788 — Milestone 2 a.i (Gap 1 fix)
#
#  Usage:
#    ./compile.sh <path/to/File.hs> <validatorName> [output-dir]
#
#  Examples:
#    ./compile.sh contracts/Vesting.hs mkVestingValidator ./dist
#    ./compile.sh contracts/NFTMarketPlace.hs mValidator
#
#  Requirements:
#    - Docker must be running
#    - Container named plutus-runner must be started:
#        docker run --name plutus-runner -d plutus-nix-runner
#
#  Output:
#    <output-dir>/<ModuleName>.plutus   — Cardano TextEnvelope JSON
#    <output-dir>/manifest.json         — machine-readable artifact manifest
#    <output-dir>/build.log             — full GHC log
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Args ──────────────────────────────────────────────────────────
SOURCE_FILE="${1:-}"
VALIDATOR_NAME="${2:-}"
OUTPUT_DIR="${3:-./dist}"

if [[ -z "$SOURCE_FILE" || -z "$VALIDATOR_NAME" ]]; then
    echo "Usage: $0 <path/to/File.hs> <validatorName> [output-dir]"
    echo ""
    echo "Examples:"
    echo "  $0 contracts/Vesting.hs mkVestingValidator ./dist"
    echo "  $0 contracts/NFTMarketPlace.hs mValidator"
    exit 1
fi

if [[ ! -f "$SOURCE_FILE" ]]; then
    echo "ERROR: Source file not found: $SOURCE_FILE" >&2
    exit 1
fi

# ── Config ────────────────────────────────────────────────────────
CONTAINER="${PLUTUS_CONTAINER:-plutus-runner}"
LECTURE_DIR="/app/code/wspace/lecture"
ASSETS_DIR="/app/code/wspace/assets"
JOB_ID="cli_$(date +%s)_$$"
MODULE_NAME="$(basename "$SOURCE_FILE" .hs)"
BUILD_LOG="$OUTPUT_DIR/build.log"
MANIFEST="$OUTPUT_DIR/manifest.json"
PLUTUS_OUT="$OUTPUT_DIR/${MODULE_NAME}.plutus"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$OUTPUT_DIR"
echo "" > "$BUILD_LOG"

echo "═══════════════════════════════════════════════════"
echo "  Plutus Headless Compiler CLI"
echo "  Job: $JOB_ID"
echo "  File: $SOURCE_FILE"
echo "  Validator: $VALIDATOR_NAME"
echo "  Output: $OUTPUT_DIR"
echo "═══════════════════════════════════════════════════"

# ── Verify container is running ────────────────────────────────────
if ! docker ps --filter "name=^${CONTAINER}$" --filter "status=running" --format "{{.Names}}" | grep -q "^${CONTAINER}$"; then
    echo "ERROR: Container '$CONTAINER' is not running." >&2
    echo "Start it with: docker run --name $CONTAINER -d plutus-nix-runner" >&2
    exit 1
fi

# ── Read source and build augmented Main.hs ───────────────────────
SOURCE_CODE="$(cat "$SOURCE_FILE")"

# Determine if source has its own main
HAS_MAIN=0
if echo "$SOURCE_CODE" | grep -q "^main ::"; then
    HAS_MAIN=1
fi

TMP_MAIN="$(mktemp /tmp/plutus_cli_XXXXXX.hs)"
trap 'rm -f "$TMP_MAIN"' EXIT

if [[ $HAS_MAIN -eq 1 ]]; then
    # Source already has main — just rename module
    sed 's/^module [A-Za-z.]\+/module Main/' "$SOURCE_FILE" > "$TMP_MAIN"
    echo "[CLI] Source has own main() — using as-is"
else
    # Inject IDE imports and main() that serialises the validator
    cat > "$TMP_MAIN" <<HASKELL
{-# LANGUAGE DataKinds #-}
{-# LANGUAGE NoImplicitPrelude #-}
{-# LANGUAGE TemplateHaskell #-}
module Main where

$(grep -v "^module " "$SOURCE_FILE")

-- ══ CLI auto-injected ══
import qualified PlutusTx              as IDE_PlutusTx
import qualified PlutusTx.Prelude      as IDE_PP
import qualified Plutus.V2.Ledger.Api  as IDE_V2
import           Utilities             (writeValidatorToFile)
import           Prelude               (IO, putStrLn)

_ide_validatorScript :: IDE_V2.Validator
_ide_validatorScript = IDE_V2.mkValidatorScript \$\$(IDE_PlutusTx.compile [|| ${VALIDATOR_NAME} ||])

main :: IO ()
main = do
  writeValidatorToFile "./assets/${JOB_ID}output.plutus" _ide_validatorScript
  putStrLn "Validator CBOR written successfully."
HASKELL
    echo "[CLI] Injected main() for validator: $VALIDATOR_NAME"
fi

# ── Copy augmented source into container ──────────────────────────
echo "[CLI] Copying source to container..."
docker cp "$TMP_MAIN" "${CONTAINER}:${LECTURE_DIR}/Main.hs"

# ── Run compilation ───────────────────────────────────────────────
echo "[CLI] Starting GHC compilation (this may take 30-120s on first run)..."
EXIT_CODE=0
docker exec "$CONTAINER" bash -lc "
    source /root/.nix-profile/etc/profile.d/nix.sh
    cd /app/code/wspace
    nix develop . --command cabal run alw-exe 2>&1
" 2>&1 | tee "$BUILD_LOG" || EXIT_CODE=$?

# ── Check result ──────────────────────────────────────────────────
ENDED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ $EXIT_CODE -ne 0 ]]; then
    echo ""
    echo "✗ BUILD FAILED (exit code $EXIT_CODE)"
    echo "  See $BUILD_LOG for details"
    # Write failure manifest
    cat > "$MANIFEST" <<JSON
{
  "jobId": "$JOB_ID",
  "status": "failed",
  "exitCode": $EXIT_CODE,
  "sourceFile": "$SOURCE_FILE",
  "validatorName": "$VALIDATOR_NAME",
  "startedAt": "$STARTED_AT",
  "endedAt": "$ENDED_AT",
  "logFile": "$BUILD_LOG"
}
JSON
    exit $EXIT_CODE
fi

# ── Extract CBOR output ───────────────────────────────────────────
CBOR_HEX=""
SCRIPT_HASH=""

if [[ $HAS_MAIN -eq 0 ]]; then
    # Standard output path
    CONTAINER_OUT="${ASSETS_DIR}/${JOB_ID}output.plutus"
    if docker exec "$CONTAINER" test -f "$CONTAINER_OUT" 2>/dev/null; then
        RAW_JSON="$(docker exec "$CONTAINER" cat "$CONTAINER_OUT")"
        CBOR_HEX="$(echo "$RAW_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cborHex',''))" 2>/dev/null || echo "")"
        docker cp "${CONTAINER}:${CONTAINER_OUT}" "$PLUTUS_OUT"
        echo "✓ Output: $PLUTUS_OUT"
    else
        echo "⚠ Could not find output at $CONTAINER_OUT"
    fi
else
    # Custom main — scan assets for generated files
    GENERATED="$(docker exec "$CONTAINER" find "${ASSETS_DIR}" -name "*.plutus" -newer "${LECTURE_DIR}/Main.hs" 2>/dev/null | head -5)"
    for fp in $GENERATED; do
        bn="$(basename "$fp")"
        docker cp "${CONTAINER}:${fp}" "${OUTPUT_DIR}/${bn}"
        echo "✓ Output: ${OUTPUT_DIR}/${bn}"
        if [[ -z "$CBOR_HEX" ]]; then
            RAW_JSON="$(docker exec "$CONTAINER" cat "$fp")"
            CBOR_HEX="$(echo "$RAW_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cborHex',''))" 2>/dev/null || echo "")"
            PLUTUS_OUT="${OUTPUT_DIR}/${bn}"
        fi
    done
fi

# ── Compute script hash (Outcome #69788 a.ii.2) ──────────────────
if [[ -n "$CBOR_HEX" ]]; then
    SCRIPT_HASH="$(echo -n "$CBOR_HEX" | python3 -c "
import sys, hashlib, binascii
cbor = binascii.unhexlify(sys.stdin.read().strip())
print(hashlib.blake2b(cbor, digest_size=28).hexdigest())
" 2>/dev/null || echo "")"
fi

# ── Write machine-readable manifest (Outcome #69788 a.ii) ─────────
LOG_CONTENT="$(cat "$BUILD_LOG" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null || echo '""')"

cat > "$MANIFEST" <<JSON
{
  "jobId": "$JOB_ID",
  "status": "succeeded",
  "exitCode": 0,
  "sourceFile": "$SOURCE_FILE",
  "moduleName": "$MODULE_NAME",
  "validatorName": "$VALIDATOR_NAME",
  "outputFile": "$PLUTUS_OUT",
  "cborHex": "$CBOR_HEX",
  "scriptHash": "$SCRIPT_HASH",
  "startedAt": "$STARTED_AT",
  "endedAt": "$ENDED_AT",
  "logFile": "$BUILD_LOG"
}
JSON

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✓ Build succeeded!"
echo "  Manifest : $MANIFEST"
echo "  .plutus  : $PLUTUS_OUT"
if [[ -n "$SCRIPT_HASH" ]]; then
    echo "  Hash     : $SCRIPT_HASH"
fi
echo "═══════════════════════════════════════════════════"
