/**
 * aiken-compile.js — Server-side Aiken compilation handler
 *
 * Architecture:
 *   • Chaque utilisateur possède un projet Aiken persistant dans le container :
 *       /app/aiken/users/{userId}/   ← projet complet initialisé par `aiken new`
 *   • ensureAikenProject() s'exécute à la première requête de l'user (une seule fois).
 *   • La compilation tourne directement dans ce workspace (pas de tmp project).
 *   • Le fichier compilé DOIT être dans validators/ — s'il ne l'est pas encore,
 *     on le copie automatiquement avant le build.
 */

import { exec, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import {
    acquireSlot,
    checkRateLimit,
    recordJobStart,
    recordJobSuccess,
    recordJobFailure,
    appendJobLog,
    storeJobArtifact,
} from "./jobQueue.js";
import {
    JOB_TIMEOUT_MS,
    MAX_OUTPUT_MB,
    RATE_LIMIT_MAX,
    AIKEN_CONTAINER,
} from "./constants.js";

// ─────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────

function sendSSE(res, data, type = "stdout") {
    res.write(`data: ${JSON.stringify({ type, output: data })}\n\n`);
}
function endSSE(res) {
    res.write("event: done\ndata: {}\n\n");
    res.end();
}

/** Absolute path of a user's Aiken project INSIDE the container */
function userProjectDir(userId) {
    return `/app/aiken/users/${userId}`;
}

/** Promisified docker exec — resolves with { stdout, stderr } */
function dockerExec(cmd, opts = {}) {
    return new Promise((resolve, reject) => {
        exec(
            `docker exec ${AIKEN_CONTAINER} bash -c ${JSON.stringify(cmd)}`,
            { maxBuffer: 1024 * 1024 * 10, ...opts },
            (err, stdout, stderr) => {
                if (err) return reject(Object.assign(err, { stderr }));
                resolve({ stdout, stderr });
            },
        );
    });
}

// ─────────────────────────────────────────────────────────────────
//  Job status (in-memory)
// ─────────────────────────────────────────────────────────────────

const jobStatusMap = new Map();

function setJobStatus(jobId, status, userId) {
    const existing = jobStatusMap.get(jobId) || {
        userId,
        startedAt: new Date().toISOString(),
    };
    jobStatusMap.set(jobId, {
        ...existing,
        status,
        updatedAt: new Date().toISOString(),
    });
}

export { setJobStatus as setAikenJobStatus, jobStatusMap as aikenJobStatusMap };

// ─────────────────────────────────────────────────────────────────
//  ensureAikenProject
//
//  Garantit que le workspace de l'user est un projet Aiken valide.
//  Idempotent : si aiken.toml existe déjà → retour immédiat.
//
//  Séquence d'initialisation :
//    1. mkdir -p /app/aiken/users/{userId}
//    2. cd /tmp && aiken new {tmpName}   → crée /tmp/{tmpName}/ avec toute la structure
//    3. cp -r /tmp/{tmpName}/. {userDir}/ → déplace dans le workspace permanent
//    4. rm -rf /tmp/{tmpName}
// ─────────────────────────────────────────────────────────────────

async function ensureAikenProject(userId) {
    const userDir = userProjectDir(userId);
    const tmpName = `aiken_init_${userId}`;

    // Fast path : déjà initialisé
    try {
        await dockerExec(`test -f "${userDir}/aiken.toml"`);
        return; // existe → rien à faire
    } catch (_) {
        // N'existe pas → on initialise
    }

    console.log(`[Aiken] Initialising project for user ${userId}…`);

    // 1. Créer le répertoire de destination
    await dockerExec(`mkdir -p "${userDir}"`);

    // 2. aiken new dans /tmp (crée /tmp/{tmpName}/)
    await dockerExec(`cd /tmp && aiken new "${tmpName}/${tmpName}"`);

    // 3. Copier le contenu dans le workspace permanent
    await dockerExec(`cp -r "/tmp/${tmpName}/." "${userDir}/"`);

    // 4. Nettoyer
    await dockerExec(`rm -rf "/tmp/${tmpName}"`);

    console.log(`[Aiken] Project ready for user ${userId} at ${userDir}`);
}

// ─────────────────────────────────────────────────────────────────
//  Route registration
// ─────────────────────────────────────────────────────────────────

export function registerAikenRoutes(app, requireAuth, TMP_DIR) {
    // ── GET /aiken/init ─────────────────────────────────────────
    // Appelé dès la connexion de l'utilisateur (depuis ide-aiken.js)
    // pour déclencher l'initialisation du projet sans attendre la
    // première requête de fichiers.
    app.get("/aiken/init", requireAuth, async (req, res) => {
        try {
            await ensureAikenProject(req.session.user.id);
            res.json({ ok: true });
        } catch (err) {
            console.error("[Aiken] init error:", err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ── GET /aiken/workspace/files ──────────────────────────────
    app.get("/aiken/workspace/files", requireAuth, async (req, res) => {
        const userId = req.session.user.id;
        const subPath = (req.query.path || "").replace(/^\/+|\/+$/g, "");
        const base = userProjectDir(userId);
        const target = subPath ? `${base}/${subPath}` : base;

        try {
            await ensureAikenProject(userId);
            const { stdout } = await dockerExec(`ls -p "${target}"`);

            const items = stdout
                .split("\n")
                .filter((l) => l.trim())
                .map((name) => ({
                    name: name.replace(/\/$/, ""),
                    isDirectory: name.endsWith("/"),
                    fullPath: subPath
                        ? `${subPath}/${name.replace(/\/$/, "")}`
                        : name.replace(/\/$/, ""),
                }));

            res.json(items);
        } catch (err) {
            console.error("[Aiken] files error:", err.message);
            res.json([]);
        }
    });

    // ── GET /aiken/workspace/file ───────────────────────────────
    app.get("/aiken/workspace/file", requireAuth, (req, res) => {
        const filePath = req.query.name;
        if (!filePath) return res.status(400).send("Missing name");
        if (filePath.includes("..") || filePath.startsWith("/"))
            return res.status(400).send("Invalid path");

        const full = `${userProjectDir(req.session.user.id)}/${filePath}`;
        exec(
            `docker exec ${AIKEN_CONTAINER} cat "${full}"`,
            { maxBuffer: 1024 * 1024 * 10 },
            (err, stdout) => {
                if (err) return res.status(404).send("File not found");
                res.send(stdout);
            },
        );
    });

    // ── POST /aiken/workspace/create ────────────────────────────
    app.post("/aiken/workspace/create", requireAuth, (req, res) => {
        const { filePath, content } = req.body;
        if (!filePath) return res.status(400).send("Missing filePath");
        if (filePath.includes("..") || filePath.startsWith("/"))
            return res.status(400).send("Invalid path");

        const userId = req.session.user.id;
        const baseName = path.basename(filePath);
        const destDir =
            `${userProjectDir(userId)}/${path.dirname(filePath)}`.replace(
                /\/\.$/,
                "",
            );
        const destFull = `${userProjectDir(userId)}/${filePath}`;
        const tmpPath = path.join(TMP_DIR, `aiken_new_${uuidv4()}_${baseName}`);

        fs.writeFileSync(tmpPath, content || "");

        // mkdir inside container then docker cp the file
        exec(
            `docker exec ${AIKEN_CONTAINER} mkdir -p "${destDir}" && docker cp "${tmpPath}" ${AIKEN_CONTAINER}:"${destFull}"`,
            (err) => {
                if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
                if (err) return res.status(500).send(err.message);
                res.send("File created");
            },
        );
    });

    // ── POST /aiken/workspace/save ──────────────────────────────
    app.post("/aiken/workspace/save", requireAuth, (req, res) => {
        const { filePath, content } = req.body;
        if (!filePath) return res.status(400).send("Missing filePath");
        if (content === undefined)
            return res.status(400).send("Missing content");
        if (filePath.includes("..") || filePath.startsWith("/"))
            return res.status(400).send("Invalid path");

        const destFull = `${userProjectDir(req.session.user.id)}/${filePath}`;
        const baseName = path.basename(filePath);
        const tmpPath = path.join(
            TMP_DIR,
            `aiken_save_${uuidv4()}_${baseName}`,
        );

        fs.writeFileSync(tmpPath, content);
        exec(
            `docker cp "${tmpPath}" ${AIKEN_CONTAINER}:"${destFull}"`,
            (err) => {
                if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
                if (err) return res.status(500).send(err.message);
                res.send("Saved");
            },
        );
    });

    // ── POST /aiken/workspace/mkdir ─────────────────────────────
    app.post("/aiken/workspace/mkdir", requireAuth, (req, res) => {
        const { dirPath } = req.body;
        if (!dirPath) return res.status(400).send("Missing dirPath");
        if (dirPath.includes("..") || dirPath.startsWith("/"))
            return res.status(400).send("Invalid path");

        exec(
            `docker exec ${AIKEN_CONTAINER} mkdir -p "${userProjectDir(req.session.user.id)}/${dirPath}"`,
            (err) => {
                if (err) return res.status(500).send(err.message);
                res.send("Directory created");
            },
        );
    });

    // ── DELETE /aiken/workspace/delete ──────────────────────────
    app.delete("/aiken/workspace/delete", requireAuth, (req, res) => {
        const { itemPath, isDirectory } = req.body;
        if (!itemPath) return res.status(400).send("Missing itemPath");
        if (itemPath.includes("..") || itemPath.startsWith("/"))
            return res.status(400).send("Invalid path");

        const full = `${userProjectDir(req.session.user.id)}/${itemPath}`;
        exec(
            `docker exec ${AIKEN_CONTAINER} ${isDirectory ? "rm -rf" : "rm -f"} "${full}"`,
            (err) => {
                if (err) return res.status(500).send(err.message);
                res.send("Deleted");
            },
        );
    });

    // ── POST /aiken/compile  (SSE) ───────────────────────────────
    //
    // Body: { fileName: string }
    //   fileName est relatif au workspace, ex: "validators/spend.ak"
    //   ou simplement "spend.ak" (le fichier sera copié dans validators/).
    //
    app.post("/aiken/compile", requireAuth, async (req, res) => {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();

        const { fileName } = req.body;
        if (!fileName || !fileName.endsWith(".ak")) {
            sendSSE(
                res,
                "> ERROR: fileName must end with .ak\n",
                "compilation",
            );
            return endSSE(res);
        }

        const jobId = uuidv4();
        const userId = req.session.user.id;

        await recordJobStart();
        setJobStatus(jobId, "queued", userId);
        sendSSE(res, jobId, "jobId");

        // ── Rate limit ──
        if (!(await checkRateLimit(userId))) {
            sendSSE(
                res,
                `> Rate limit: max ${RATE_LIMIT_MAX} builds/minute.\n`,
                "compilation",
            );
            await recordJobFailure("rateLimit");
            setJobStatus(jobId, "failed", userId);
            return endSSE(res);
        }

        // ── Queue slot ──
        let release;
        try {
            release = await acquireSlot(jobId);
            setJobStatus(jobId, "running", userId);
        } catch (err) {
            sendSSE(res, `> ${err.message}\n`, "compilation");
            await recordJobFailure("queue");
            setJobStatus(jobId, "failed", userId);
            return endSSE(res);
        }

        const startTime = Date.now();
        let jobTimeout = null;

        function sendComp(text) {
            sendSSE(res, text, "compilation");
            appendJobLog(jobId, text);
        }

        function startWatchdog(child) {
            jobTimeout = setTimeout(async () => {
                sendComp(
                    `\n> Build timed out after ${JOB_TIMEOUT_MS / 1000}s.\n`,
                );
                await recordJobFailure("timeout");
                setJobStatus(jobId, "failed", userId);
                try {
                    child.kill("SIGKILL");
                } catch (_) {}
                release();
                endSSE(res);
            }, JOB_TIMEOUT_MS);
        }

        function finish(success = true) {
            clearTimeout(jobTimeout);
            release();
            if (success) {
                recordJobSuccess(Date.now() - startTime);
                setJobStatus(jobId, "succeeded", userId);
            } else {
                setJobStatus(jobId, "failed", userId);
            }
        }

        try {
            // ── 1. Ensure project exists ──
            await ensureAikenProject(userId);

            const projectDir = userProjectDir(userId);
            const displayName = path.basename(fileName);
            const sourcePath = `${projectDir}/${fileName}`;
            const validatorsPath = `${projectDir}/validators/${displayName}`;

            sendComp(`> Building ${displayName}…\n`);

            // ── 2. Si le fichier n'est pas déjà dans validators/, l'y copier ──
            //    Cas typique : l'user a créé un fichier à la racine du projet.
            try {
                await dockerExec(
                    `test "${sourcePath}" = "${validatorsPath}" || cp "${sourcePath}" "${validatorsPath}"`,
                );
            } catch (cpErr) {
                sendComp(
                    `> WARNING: could not stage file into validators/: ${cpErr.message}\n`,
                );
            }

            // ── 3. aiken build (spawn pour streamer en temps réel) ──
            const child = spawn("docker", [
                "exec",
                AIKEN_CONTAINER,
                "bash",
                "-c",
                `cd "${projectDir}" && aiken build 2>&1`,
            ]);

            startWatchdog(child);
            child.stdout.on("data", (chunk) => sendComp(chunk.toString()));
            child.stderr?.on("data", (chunk) => sendComp(chunk.toString()));

            child.on("close", async (code) => {
                clearTimeout(jobTimeout);

                if (code !== 0) {
                    sendComp(`\n> Build failed (exit code ${code}).\n`);
                    await recordJobFailure("ghc");
                    finish(false);
                    return endSSE(res);
                }

                // ── 4. Lire plutus.json ──
                let plutusJson;
                try {
                    const r = await dockerExec(
                        `cat "${projectDir}/plutus.json"`,
                    );
                    plutusJson = r.stdout;
                } catch (readErr) {
                    sendComp("> ERROR: plutus.json not found after build.\n");
                    finish(false);
                    return endSSE(res);
                }

                let parsed;
                try {
                    parsed = JSON.parse(plutusJson);
                } catch (parseErr) {
                    sendComp(
                        `> ERROR: Could not parse plutus.json: ${parseErr.message}\n`,
                    );
                    finish(false);
                    return endSSE(res);
                }

                const validators = parsed.validators || [];
                if (validators.length === 0) {
                    sendComp("> No validators found in plutus.json.\n");
                    finish(false);
                    return endSSE(res);
                }

                sendComp(
                    `\n> ✓ Build succeeded — ${validators.length} validator(s) found.\n`,
                );

                // ── 5. Émettre chaque validator ──
                for (const v of validators) {
                    const cborHex = v.compiledCode || "";
                    const title = v.title || "validator";
                    const hash = v.hash || "";
                    const artifactName = `${title}.plutus`;

                    sendSSE(res, "Successfully compiled ", "compilation");
                    sendSSE(res, cborHex, "cbor");

                    // sendSSE(res, `/job/${jobId}/download`,  'download');
                    // sendComp(`> Validator: ${title}  hash: ${hash}\n`);

                    await storeJobArtifact(jobId, {
                        cborHex,
                        fileName: artifactName,
                        compiledAt: new Date().toISOString(),
                        fromCache: true,
                        language: "aiken",
                        validators,
                    });
                }

                // if (validators.length > 1) {
                //     sendSSE(res, JSON.stringify({
                //         files: validators.map(v => ({
                //             name:  `${v.title || 'validator'}.plutus`,
                //             jobId,
                //         })),
                //     }), 'files');
                // }

                finish(true);
                endSSE(res);
            });
        } catch (err) {
            sendComp(`> ERROR: ${err.message}\n`);
            finish(false);
            endSSE(res);
        }
    });

    // ── POST /aiken/check ───────────────────────────────────────
    // Lightweight type-check (no CBOR output) — used for live diagnostics.
    // Returns raw aiken check output as plain text.
    app.post("/aiken/check", requireAuth, async (req, res) => {
        const { fileName } = req.body;
        if (!fileName || !fileName.endsWith(".ak"))
            return res.status(400).send("fileName must end with .ak");

        const userId = req.session.user.id;
        const projectDir = userProjectDir(userId);

        try {
            await ensureAikenProject(userId);
            exec(
                `docker exec ${AIKEN_CONTAINER} bash -c ${JSON.stringify(`cd "${projectDir}" && aiken check 2>&1`)}`,
                { maxBuffer: 1024 * 1024 * 5, timeout: 30000 },
                (err, stdout, stderr) => {
                    // Always return the output — even on error (that IS the diagnostic)
                    res.type("text").send(stdout || stderr || "");
                },
            );
        } catch (err) {
            res.type("text").send(err.message);
        }
    });

    // ── GET /aiken/version ──────────────────────────────────────
    app.get("/aiken/version", requireAuth, (_req, res) => {
        exec(
            `docker exec ${AIKEN_CONTAINER} aiken --version 2>/dev/null`,
            (err, out) => res.json({ aiken: err ? "unavailable" : out.trim() }),
        );
    });
}
