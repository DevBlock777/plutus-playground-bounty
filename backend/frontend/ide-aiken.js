/**
 * ide-aiken.js — Frontend Aiken integration
 *
 * Chargé après ide-compile.js dans index.html.
 *
 * Responsabilités :
 *   1. Switcher de langage (Plutus ↔ Aiken)
 *   2. Appeler /aiken/init à la connexion pour initialiser le projet
 *   3. runAikenCode() — POST /aiken/compile + stream SSE
 *   4. Badge de version Aiken
 *   5. Bouton ＋ pour créer un fichier .ak via la modale existante
 */

// ─────────────────────────────────────────────────────────────────
//  État global du langage
//  Déclaré ici — lu par ide-workspace.js (setModalType, confirmCreate,
//  openModal) qui est chargé AVANT ce fichier.
// ─────────────────────────────────────────────────────────────────

// currentLang est déclaré var (pas let/const) pour être accessible
// depuis ide-workspace.js chargé avant ce fichier.
var currentLang = sessionStorage.getItem('ide_lang') || 'plutus';

// ─────────────────────────────────────────────────────────────────
//  setLanguage
// ─────────────────────────────────────────────────────────────────

function setLanguage(lang) {
    currentLang = lang;
    sessionStorage.setItem('ide_lang', lang);

    // Panneaux sidebar
    const plutusPanel = document.getElementById('plutusSidebarPanel');
    const aikenPanel  = document.getElementById('aikenSidebarPanel');
    if (plutusPanel) plutusPanel.style.display = lang === 'plutus' ? '' : 'none';
    if (aikenPanel)  aikenPanel.style.display  = lang === 'aiken'  ? '' : 'none';

    // Boutons de langue
    document.querySelectorAll('.lang-btn').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.lang === lang)
    );

    // Bouton ▶
    const runBtn = document.getElementById('runFileBtn');
    if (runBtn) {
        if (lang === 'aiken') {
            runBtn.textContent = '▶ Build';
            runBtn.title       = 'Build Aiken contract (aiken build)';
            runBtn.disabled    = !(typeof aikenSelectedFileName !== 'undefined' &&
                                   aikenSelectedFileName?.endsWith('.ak'));
        } else {
            runBtn.textContent = '▶ Compile';
            runBtn.title       = 'Compile Haskell / PlutusTx';
            runBtn.disabled    = !(typeof selectedFileName !== 'undefined' &&
                                   selectedFileName?.endsWith('.hs'));
        }
    }

    // Prompt terminal
    const prompt = document.querySelector('.terminal-prompt');
    if (prompt) prompt.textContent = lang === 'aiken' ? 'aiken ❯' : 'plutus ❯';

    // Côté Aiken : récupérer la version + rafraîchir le sidebar
    if (lang === 'aiken') {
        fetchAikenVersion();
        if (typeof refreshAikenFiles === 'function') refreshAikenFiles();
    }
}

// ─────────────────────────────────────────────────────────────────
//  Initialisation au chargement de la page
// ─────────────────────────────────────────────────────────────────

window.addEventListener('load', () => {

    // 1. Remplacer le handler du bouton ▶ pour dispatcher selon le langage
    const runBtn = document.getElementById('runFileBtn');
    const origOnclick = runBtn.onclick;

    runBtn.onclick = () => {
        if (currentLang === 'aiken') {
            if (!aikenSelectedFilePath)
                return notify('Sélectionne un fichier .ak dans le sidebar Aiken.', 'warn');
            // Sauvegarder puis compiler
            fetch('/aiken/workspace/save', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    filePath: aikenSelectedFilePath,
                    content:  window.editor.getValue(),
                }),
            }).then(() => runAikenCode({ fileName: aikenSelectedFilePath }));
        } else {
            if (origOnclick) origOnclick();
        }
    };

    // 2. Appliquer l'état de langue initial
    setLanguage(currentLang);

    // 3. Si on est en mode Aiken, appeler /aiken/init pour s'assurer
    //    que le projet est initialisé (aiken new) avant le premier listing.
    //    On le fait aussi en mode Plutus pour que le projet soit prêt quand
    //    l'user switche — c'est non-bloquant.
    _aikenInit();
});

// ─────────────────────────────────────────────────────────────────
//  _aikenInit — appelle GET /aiken/init une fois par session
// ─────────────────────────────────────────────────────────────────

async function _aikenInit() {
    try {
        const r = await fetch('/aiken/init');
        if (r.ok) {
            console.log('[Aiken] Project ready.');
            // Si l'utilisateur est déjà sur l'onglet Aiken, rafraîchir le sidebar
            if (currentLang === 'aiken' && typeof refreshAikenFiles === 'function') {
                refreshAikenFiles();
            }
        } else {
            console.warn('[Aiken] init returned', r.status);
        }
    } catch (err) {
        console.error('[Aiken] init error:', err.message);
    }
}

// ─────────────────────────────────────────────────────────────────
//  runAikenCode — stream SSE depuis /aiken/compile
// ─────────────────────────────────────────────────────────────────

async function runAikenCode(body) {
    const runBtn = document.getElementById('runFileBtn');
    runBtn.disabled = true;
    setStatus('Building…', '#f0a500');

    ['logs', 'std', 'cbor'].forEach(id => {
        document.getElementById(id).textContent = '';
    });
    if (typeof _setValidatorAddr === 'function') _setValidatorAddr(null);

    // Clear previous Aiken markers at build start
    if (window.monaco && window.editor)
        monaco.editor.setModelMarkers(window.editor.getModel(), 'aiken', []);

    let hasError = false;
    let fullLog  = '';

    try {
        const res     = await fetch('/aiken/compile', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
        });
        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let   buf     = '';

        function processLines(b) {
            const lines = b.split('\n');
            const rem   = lines.pop();
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const { type, output } = JSON.parse(line.slice(6));

                    if (type === 'jobId') {
                        const badge = document.getElementById('jobIdBadge');
                        if (badge) {
                            badge.textContent   = `#${output.slice(0, 8)}`;
                            badge.title         = output;
                            badge.dataset.jobId = output;
                            badge.style.display = 'inline-flex';
                        }

                    } else if (type === 'compilation') {
                        switchTab('logs');
                        const logsEl = document.getElementById('logs');
                        logsEl.textContent += output;
                        logsEl.scrollTop    = logsEl.scrollHeight;
                        fullLog += output;
                        if (/\berror\b/i.test(output) || output.includes('Build failed'))
                            hasError = true;

                    } else if (type === 'cbor') {
                        document.getElementById('cbor').textContent = output;
                        switchTab('cbor');

                    } else if (type === 'download') {
                        const dl = document.getElementById('downloadBtn');
                        dl.dataset.url = output;
                        dl.disabled    = false;

                    } else if (type === 'files') {
                        try {
                            const { files } = JSON.parse(output);
                            if (files && files.length > 1 && typeof showMultiFilePanel === 'function')
                                showMultiFilePanel(files);
                        } catch (_) {}

                    } else {
                        const stdEl = document.getElementById('std');
                        stdEl.textContent += output;
                        stdEl.scrollTop    = stdEl.scrollHeight;
                    }
                } catch (_) {}
            }
            return rem;
        }

        while (true) {
            const { done, value } = await reader.read();
            if (done) { if (buf.trim()) processLines(buf + '\n'); break; }
            buf += decoder.decode(value, { stream: true });
            buf  = processLines(buf);
        }

        // ── Inject error markers into Monaco after build ──
        if (window.setAikenMarkers) window.setAikenMarkers(fullLog);

        setStatus(
            hasError ? 'Build failed' : 'Success ✓',
            hasError ? '#f87171'      : '#34d399',
        );

    } catch (err) {
        document.getElementById('logs').textContent += `\nNetwork error: ${err.message}`;
        setStatus('Network error', '#f87171');
    }

    // Réactiver le bouton
    runBtn.disabled = !(aikenSelectedFileName?.endsWith('.ak'));
}

window.runAikenCode = runAikenCode;

// ─────────────────────────────────────────────────────────────────
//  Live diagnostics — `aiken check` on save (debounced 1.5s)
//
//  Calls POST /aiken/check (lightweight, no CBOR output).
//  The backend runs `aiken check` and returns the raw output as text.
//  We parse that with setAikenMarkers for instant squiggles.
// ─────────────────────────────────────────────────────────────────

let _aikenCheckTimer = null;

function scheduleAikenCheck() {
    if (!aikenSelectedFilePath) return;
    clearTimeout(_aikenCheckTimer);
    _aikenCheckTimer = setTimeout(_runAikenCheck, 1500);
}

async function _runAikenCheck() {
    if (!aikenSelectedFilePath) return;
    try {
        // Auto-save current editor content first
        await fetch('/aiken/workspace/save', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                filePath: aikenSelectedFilePath,
                content:  window.editor.getValue(),
            }),
        });

        const r = await fetch('/aiken/check', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ fileName: aikenSelectedFilePath }),
        });
        if (!r.ok) return;
        const output = await r.text();
        if (window.setAikenMarkers) window.setAikenMarkers(output);
    } catch (_) {
        // Live check is best-effort — never show an error to the user
    }
}

// Wire the debounce to Monaco content changes
// (editor is created inside require() in ide-core.js, so we wait for it)
function _wireAikenLiveCheck() {
    if (!window.editor) {
        setTimeout(_wireAikenLiveCheck, 300);
        return;
    }
    window.editor.onDidChangeModelContent(() => {
        if (_getLang() === 'aiken') scheduleAikenCheck();
    });
}
_wireAikenLiveCheck();

// ─────────────────────────────────────────────────────────────────
//  fetchAikenVersion
// ─────────────────────────────────────────────────────────────────

async function fetchAikenVersion() {
    try {
        const r    = await fetch('/aiken/version');
        const data = await r.json();
        const badge = document.getElementById('versionBadge');
        if (badge && data.aiken && data.aiken !== 'unavailable') {
            badge.textContent = data.aiken.split('\n')[0].trim();
            badge.title       = data.aiken;
        }
    } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────
//  Bouton ＋ Aiken : ouvre la modale existante en mode Aiken
// ─────────────────────────────────────────────────────────────────

window.openAikenNewFileModal = function () {
    // Réutilise la modale existante — setModalType lira currentLang === 'aiken'
    if (typeof openModal === 'function') openModal('file');
};