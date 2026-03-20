//  SIDEBAR
// ═══════════════════════════════════════════════════
async function refreshFiles() {
    try {
        const r = await fetch(
            `/workspace/files?path=${encodeURIComponent(currentSidebarPath)}`,
        );
        if (r.redirected || r.status === 401)
            return (window.location.href = "/login");
        const items = await r.json();

        document.getElementById("sidebarPath").textContent =
            `~/${currentUsername}${currentSidebarPath ? "/" + currentSidebarPath : ""}`;

        items
            .filter((i) => i.isDirectory)
            .forEach((i) => {
                if (!allDirs.includes(i.fullPath)) allDirs.push(i.fullPath);
            });

        const sorted = [...items].sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });

        let html = "";
        if (currentSidebarPath !== "")
            html += `<div class="file-item back" onclick="sidebarGoBack()">📁 ..</div>`;
        if (sorted.length === 0)
            html += `<div style="padding:14px 12px;font-size:11px;color:#444;font-style:italic;">No files — click ＋ to create one</div>`;

        sorted.forEach((item) => {
            const icon = item.isDirectory
                ? "📁"
                : item.name.endsWith(".hs")
                  ? "λ"
                  : "📄";
            const sp = item.fullPath.replace(/'/g, "\\'");
            const sn = item.name.replace(/'/g, "\\'");
            const act = item.isDirectory
                ? `sidebarNavigate('${sp}')`
                : `selectFile('${sp}','${sn}')`;
            const cBtn =
                !item.isDirectory && item.name.endsWith(".hs")
                    ? `<span class="compile-ico" onclick="event.stopPropagation();runWorkspaceFile('${sp}','${sn}')" title="Compile">▶</span>`
                    : "";
            const delBtn = `<div class="file-actions">
                <button class="file-act-btn" onclick="event.stopPropagation();openDeleteModal('${sp}','${sn}',${item.isDirectory})" title="Delete">🗑</button>
            </div>`;
            html += `<div class="file-item ${item.isDirectory ? "is-dir" : ""} ${item.fullPath === selectedFilePath ? "active" : ""}" onclick="${act}">
                <div class="file-item-label">${icon} ${item.name}</div>${cBtn}${delBtn}
            </div>`;
        });
        document.getElementById("fileList").innerHTML = html;
    } catch (e) {
        document.getElementById("fileList").innerHTML =
            `<div style="padding:10px;color:#f44;font-size:11px;">Connection error</div>`;
    }
}

function sidebarNavigate(fp) {
    currentSidebarPath = fp;
    sessionStorage.setItem(NAV_PATH_KEY, fp);
    refreshFiles();
}
function sidebarGoBack() {
    const parts = currentSidebarPath.split("/").filter(Boolean);
    parts.pop();
    currentSidebarPath = parts.join("/");
    sessionStorage.setItem(NAV_PATH_KEY, currentSidebarPath);
    refreshFiles();
}

async function selectFile(fullPath, fileName) {
    try {
        const r = await fetch(
            `/workspace/file?name=${encodeURIComponent(fullPath)}`,
        );
        if (!r.ok) throw new Error(await r.text());
        const content = await r.text();

        // Use multi-tab system if available
        if (window._openTab) {
            window._openTab(fullPath, fileName, content);
        } else {
            window.editor.setValue(content);
            const ext = fileName.split(".").pop().toLowerCase();
            monaco.editor.setModelLanguage(
                window.editor.getModel(),
                { hs: "haskell", json: "json", md: "markdown" }[ext] ||
                    "plaintext",
            );
        }

        monaco.editor.setModelMarkers(window.editor.getModel(), "ghc", []);
        selectedFilePath = fullPath;
        selectedFileName = fileName;
        sessionStorage.setItem(SEL_FILE_KEY, fullPath);
        sessionStorage.setItem(SEL_NAME_KEY, fileName);

        // Exit template mode — file takes over
        if (templateMode) {
            templateMode = false;
            _preTemplateSnapshot = null;
            document.getElementById("activeFile").style.color = "#a78bfa";
            document.getElementById("templateSelect").value = "";
        }

        document.getElementById("activeFile").textContent = "> " + fileName;
        document.getElementById("runFileBtn").disabled =
            !fileName.endsWith(".hs");
        refreshFiles();
    } catch (e) {
        notify("Error opening file: " + e.message, "error");
    }
}

// ═══════════════════════════════════════════════════
//  SAVE
// ═══════════════════════════════════════════════════
document.getElementById("saveBtn").onclick = async () => {
    if (!selectedFilePath)
        return notify(
            "No file selected. Click a file in the sidebar first.",
            "warn",
        );
    const r = await fetch("/workspace/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            filePath: selectedFilePath,
            content: window.editor.getValue(),
        }),
    });
    if (r.ok) {
        setStatus("Saved ✓", "#34d399");
        setTimeout(() => setStatus("", "#888"), 2000);
    } else setStatus("Save error", "#f87171");
};

// ═══════════════════════════════════════════════════
//  MODAL
// ═══════════════════════════════════════════════════
document.getElementById("newFileBtn").onclick = () => openModal("file");

// ── Modal type state ──
let _modalType = "file";

function setModalType(type) {
    _modalType = type;
    const isAiken = _getLang() === 'aiken';
    document
        .getElementById("toggleFile")
        .classList.toggle("active", type === "file");
    document
        .getElementById("toggleFolder")
        .classList.toggle("active", type === "folder");
    document.getElementById("modalTitle").textContent =
        type === "file" ? "+ New file" : "+ New folder";
    document.getElementById("modalNameLabel").textContent =
        type === "file" ? "File name" : "Folder name";
    document.getElementById("modalConfirmBtn").textContent =
        type === "file" ? "Create file" : "Create folder";

    if (type === "file") {
        if (isAiken) {
            document.getElementById("modalHint").textContent =
                "Lowercase letters, numbers and underscores, end with .ak";
            document.getElementById("modalName").placeholder = "ex: my_validator.ak";
        } else {
            document.getElementById("modalHint").textContent =
                "Must start with uppercase, end with .hs";
            document.getElementById("modalName").placeholder = "ex: MyValidator.hs";
        }
    } else {
        document.getElementById("modalHint").textContent =
            "Lowercase letters, numbers and hyphens only";
        document.getElementById("modalName").placeholder = "ex: contracts";
    }
    document.getElementById("modalName").value = "";
}

function openModal(type = "file") {
    const isAiken = _getLang() === 'aiken';
    const _dirs   = isAiken ? aikenAllDirs : allDirs;
    const _curPath = isAiken ? aikenSidebarPath : currentSidebarPath;
    const sel = document.getElementById("modalDir");
    sel.innerHTML = `<option value="">/ (root)</option>`;
    _dirs.forEach((d) => {
        sel.innerHTML += `<option value="${d}" ${d === _curPath ? "selected" : ""}>${d}/</option>`;
    });
    sel.value = _curPath || "";
    setModalType(type);
    document.getElementById("modalOverlay").classList.add("open");
    setTimeout(() => document.getElementById("modalName").focus(), 100);
}

function closeModal() {
    document.getElementById("modalOverlay").classList.remove("open");
}
document.getElementById("modalOverlay").onclick = (e) => {
    if (e.target.id === "modalOverlay") closeModal();
};

async function confirmCreate() {
    const dir  = document.getElementById("modalDir").value;
    const name = document.getElementById("modalName").value.trim();
    const isAiken = _getLang() === 'aiken';

    if (_modalType === "folder") {
        if (!name) return notify("Enter a folder name", "warn");
        if (!/^[a-zA-Z0-9_-]+$/.test(name))
            return notify("Folder: letters, numbers, - and _ only", "warn");

        const fp      = dir ? `${dir}/${name}` : name;
        const endpoint = isAiken ? "/aiken/workspace/mkdir" : "/workspace/mkdir";
        const r = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dirPath: fp }),
        });
        if (!r.ok)
            return notify("Error creating folder: " + (await r.text()), "error");

        if (isAiken) {
            aikenAllDirs.push(fp);
            closeModal();
            aikenSidebarPath = fp;
            sessionStorage.setItem(AIKEN_NAV_KEY, fp);
            await refreshAikenFiles();
        } else {
            allDirs.push(fp);
            closeModal();
            currentSidebarPath = fp;
            sessionStorage.setItem(NAV_PATH_KEY, fp);
            await refreshFiles();
        }
        notify(`Folder "${name}" created`, "ok", 3000);

    } else if (isAiken) {
        // ── Aiken file ──────────────────────────────────────────
        if (!name) return notify("Enter a file name", "warn");
        if (!name.endsWith(".ak"))
            return notify("The file must end with .ak", "warn");
        if (!/^[a-z][a-z0-9_]*\.ak$/.test(name))
            return notify("Aiken files: lowercase, numbers and underscores only", "warn");

        const modName = name.replace(".ak", "");
        const fp      = dir ? `${dir}/${name}` : name;
        const content =
`// ${modName} — Aiken validator

use aiken/transaction.{ScriptContext}

pub fn spend(
  _datum: Data,
  _redeemer: Data,
  _ctx: ScriptContext,
) -> Bool {
  True
}
`;
        const r = await fetch("/aiken/workspace/create", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ filePath: fp, content }),
        });
        if (!r.ok)
            return notify("Error creating file: " + (await r.text()), "error");

        closeModal();
        aikenSidebarPath = dir;
        sessionStorage.setItem(AIKEN_NAV_KEY, dir);
        await refreshAikenFiles();
        await selectAikenFile(fp, name);

    } else {
        // ── Plutus / Haskell file ───────────────────────────────
        if (!name) return notify("Enter a file name", "warn");
        if (!name.endsWith(".hs"))
            return notify("The file must end with .hs", "warn");
        if (!/^[A-Z]/.test(name))
            return notify(
                "The name must start with an uppercase letter (Haskell convention)",
                "warn",
            );
        const mod = name.replace(".hs", "");
        const fp  = dir ? `${dir}/${name}` : name;
        const content = `{-# LANGUAGE DataKinds #-}
{-# LANGUAGE NoImplicitPrelude #-}
{-# LANGUAGE TemplateHaskell #-}
{-# LANGUAGE ScopedTypeVariables #-}
{-# LANGUAGE TypeApplications #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE OverloadedStrings #-}

module ${mod} where

import qualified PlutusTx
import PlutusTx.Prelude
import Plutus.V2.Ledger.Api

{-# INLINABLE mkValidator #-}
mkValidator :: BuiltinData -> BuiltinData -> BuiltinData -> ()
mkValidator _ _ _ = ()
`;
        const r = await fetch("/workspace/create", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ filePath: fp, content }),
        });
        if (!r.ok)
            return notify("Error creating file: " + (await r.text()), "error");

        closeModal();
        currentSidebarPath = dir;
        sessionStorage.setItem(NAV_PATH_KEY, dir);
        await refreshFiles();
        await selectFile(fp, name);
    }
}

document.getElementById("modalName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmCreate();
    if (e.key === "Escape") closeModal();
});

// ── Delete modal ──
let _deleteTarget = null;

function openDeleteModal(fullPath, name, isDir) {
    _deleteTarget = { fullPath, name, isDir };
    document.getElementById("deleteMsg").textContent =
        `Are you sure you want to delete ${isDir ? "folder" : "file"} "${name}"?` +
        (isDir ? "\n\nThis will delete all files inside." : "");
    document.getElementById("deleteOverlay").classList.add("open");
}

function closeDeleteModal() {
    document.getElementById("deleteOverlay").classList.remove("open");
    _deleteTarget = null;
}
document.getElementById("deleteOverlay").onclick = (e) => {
    if (e.target.id === "deleteOverlay") closeDeleteModal();
};

async function confirmDelete() {
    if (!_deleteTarget) return;
    const { fullPath, name, isDir } = _deleteTarget;
    closeDeleteModal();

    const r = await fetch("/workspace/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemPath: fullPath, isDirectory: isDir }),
    });

    if (!r.ok) return notify("Delete failed: " + (await r.text()), "error");

    // If the deleted file was open, clear editor
    if (!isDir && selectedFilePath === fullPath) {
        selectedFilePath = null;
        selectedFileName = null;
        sessionStorage.removeItem(SEL_FILE_KEY);
        sessionStorage.removeItem(SEL_NAME_KEY);
        if (window.editor)
            window.editor.setValue(
                "-- Select or create a file in the sidebar\n",
            );
        document.getElementById("activeFile").textContent = "";
        document.getElementById("runFileBtn").disabled = true;
    }
    // If deleted folder was the current nav path, go back to root
    if (isDir && currentSidebarPath.startsWith(fullPath)) {
        currentSidebarPath = "";
        sessionStorage.setItem(NAV_PATH_KEY, "");
    }
    allDirs = allDirs.filter((d) => !d.startsWith(fullPath));
    await refreshFiles();
    notify(`"${name}" deleted`, "ok", 3000);
}

// ── Expose workspace state and functions globally ──
// Required by ide-ai.js (loaded after this file)
Object.defineProperty(window, "currentSidebarPath", {
    get: () => currentSidebarPath,
    set: (v) => {
        currentSidebarPath = v;
    },
});
window.selectFile = selectFile;
window.refreshFiles = refreshFiles;


// ═══════════════════════════════════════════════════
//  AIKEN WORKSPACE  (mirrors Plutus workspace API but
//  targets /aiken/workspace/* endpoints)
// ═══════════════════════════════════════════════════

// currentLang is declared in ide-aiken.js which loads AFTER this file.
// Use a safe getter so code in this file never throws a ReferenceError.
function _getLang() {
    return (typeof currentLang !== 'undefined') ? currentLang : 'plutus';
}

var aikenSidebarPath = '';
var aikenSelectedFilePath = null;
var aikenSelectedFileName = null;
var aikenAllDirs = [];

const AIKEN_NAV_KEY  = 'aiken_nav_path';
const AIKEN_SEL_KEY  = 'aiken_sel_file';
const AIKEN_NAME_KEY = 'aiken_sel_name';

async function refreshAikenFiles() {
    const panel = document.getElementById('aikenFileList');
    if (!panel) return;
    try {
        const r = await fetch(`/aiken/workspace/files?path=${encodeURIComponent(aikenSidebarPath)}`);
        if (r.redirected || r.status === 401) return (window.location.href = '/login');
        const items = await r.json();

        document.getElementById('aikenSidebarPath').textContent =
            `~/${currentUsername}${aikenSidebarPath ? '/' + aikenSidebarPath : ''} [aiken]`;

        items.filter(i => i.isDirectory).forEach(i => {
            if (!aikenAllDirs.includes(i.fullPath)) aikenAllDirs.push(i.fullPath);
        });

        const sorted = [...items].sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });

        let html = '';
        if (aikenSidebarPath !== '')
            html += `<div class="file-item back" onclick="aikenSidebarGoBack()">📁 ..</div>`;
        if (sorted.length === 0)
            html += `<div style="padding:14px 12px;font-size:11px;color:#444;font-style:italic;">No files — click ＋ to create one</div>`;

        sorted.forEach(item => {
            const icon = item.isDirectory ? '📁' : item.name.endsWith('.ak') ? '🔷' : '📄';
            const sp   = item.fullPath.replace(/'/g, "\\'");
            const sn   = item.name.replace(/'/g, "\\'");
            const act  = item.isDirectory ? `aikenSidebarNavigate('${sp}')` : `selectAikenFile('${sp}','${sn}')`;
            const cBtn = !item.isDirectory && item.name.endsWith('.ak')
                ? `<span class="compile-ico" onclick="event.stopPropagation();runAikenWorkspaceFile('${sp}','${sn}')" title="Build">▶</span>`
                : '';
            const delBtn = `<div class="file-actions">
                <button class="file-act-btn" onclick="event.stopPropagation();openAikenDeleteModal('${sp}','${sn}',${item.isDirectory})" title="Delete">🗑</button>
            </div>`;
            html += `<div class="file-item ${item.isDirectory ? 'is-dir' : ''} ${item.fullPath === aikenSelectedFilePath ? 'active' : ''}" onclick="${act}">
                <div class="file-item-label">${icon} ${item.name}</div>${cBtn}${delBtn}
            </div>`;
        });
        panel.innerHTML = html;
    } catch (e) {
        document.getElementById('aikenFileList').innerHTML =
            `<div style="padding:10px;color:#f44;font-size:11px;">Connection error</div>`;
    }
}

function aikenSidebarNavigate(fp) {
    aikenSidebarPath = fp;
    sessionStorage.setItem(AIKEN_NAV_KEY, fp);
    refreshAikenFiles();
}
function aikenSidebarGoBack() {
    const parts = aikenSidebarPath.split('/').filter(Boolean);
    parts.pop();
    aikenSidebarPath = parts.join('/');
    sessionStorage.setItem(AIKEN_NAV_KEY, aikenSidebarPath);
    refreshAikenFiles();
}

async function selectAikenFile(fullPath, fileName) {
    try {
        const r = await fetch(`/aiken/workspace/file?name=${encodeURIComponent(fullPath)}`);
        if (!r.ok) throw new Error(await r.text());
        const content = await r.text();

        if (window._openTab) {
            window._openTab(fullPath, fileName, content, 'aiken');
        } else {
            window.editor.setValue(content);
        }

        // Activate Aiken syntax highlighting and clear stale markers
        if (window.monaco && window.editor) {
            const model = window.editor.getModel();
            monaco.editor.setModelLanguage(model, 'aiken');
            monaco.editor.setModelMarkers(model, 'ghc',   []);
            monaco.editor.setModelMarkers(model, 'aiken', []);
        }

        aikenSelectedFilePath = fullPath;
        aikenSelectedFileName = fileName;
        sessionStorage.setItem(AIKEN_SEL_KEY,  fullPath);
        sessionStorage.setItem(AIKEN_NAME_KEY, fileName);

        document.getElementById('activeFile').textContent = '> ' + fileName + ' [aiken]';
        document.getElementById('runFileBtn').disabled    = !fileName.endsWith('.ak');
        refreshAikenFiles();
    } catch (e) {
        notify('Error opening file: ' + e.message, 'error');
    }
}

// ── Aiken save button wiring ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) {
        const origOnclick = saveBtn.onclick;
        saveBtn.onclick = async () => {
            // If the active file is an Aiken file, use the Aiken save endpoint
            if (aikenSelectedFilePath && document.getElementById('activeFile').textContent.includes('[aiken]')) {
                const r = await fetch('/aiken/workspace/save', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ filePath: aikenSelectedFilePath, content: window.editor.getValue() }),
                });
                if (r.ok) {
                    setStatus('Saved ✓', '#34d399');
                    setTimeout(() => setStatus('', '#888'), 2000);
                } else setStatus('Save error', '#f87171');
            } else if (origOnclick) {
                origOnclick();
            }
        };
    }
});

// ── Delete modal for Aiken ───────────────────────────────────────
let _aikenDeleteTarget = null;

function openAikenDeleteModal(fullPath, name, isDir) {
    _aikenDeleteTarget = { fullPath, name, isDir };
    document.getElementById('deleteMsg').textContent =
        `Are you sure you want to delete ${isDir ? 'folder' : 'file'} "${name}"?` +
        (isDir ? '\n\nThis will delete all files inside.' : '');
    document.getElementById('deleteOverlay').classList.add('open');
    // Override the confirm action
    document.getElementById('deleteConfirmBtn').onclick = confirmAikenDelete;
}

async function confirmAikenDelete() {
    if (!_aikenDeleteTarget) return;
    const { fullPath, name, isDir } = _aikenDeleteTarget;
    document.getElementById('deleteOverlay').classList.remove('open');
    _aikenDeleteTarget = null;

    const r = await fetch('/aiken/workspace/delete', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ itemPath: fullPath, isDirectory: isDir }),
    });
    if (!r.ok) return notify('Delete failed: ' + (await r.text()), 'error');

    if (!isDir && aikenSelectedFilePath === fullPath) {
        aikenSelectedFilePath = null;
        aikenSelectedFileName = null;
        if (window.editor) window.editor.setValue('// Select or create an Aiken file\n');
        document.getElementById('activeFile').textContent = '';
        document.getElementById('runFileBtn').disabled = true;
    }
    if (isDir && aikenSidebarPath.startsWith(fullPath)) {
        aikenSidebarPath = '';
        sessionStorage.setItem(AIKEN_NAV_KEY, '');
    }
    aikenAllDirs = aikenAllDirs.filter(d => !d.startsWith(fullPath));
    await refreshAikenFiles();
    notify(`"${name}" deleted`, 'ok', 3000);
}

// ── New Aiken file helper ────────────────────────────────────────
async function createAikenFile(dir, name) {
    if (!name.endsWith('.ak')) return notify('File must end with .ak', 'warn');
    const fp      = dir ? `${dir}/${name}` : name;
    const modName = name.replace('.ak', '');
    const content = `// ${modName} — Aiken validator\n\nuse aiken/transaction.{Transaction, OutputReference, ScriptContext}\n\npub fn spend(\n  _datum: Data,\n  _redeemer: Data,\n  _ctx: ScriptContext,\n) -> Bool {\n  True\n}\n`;
    const r = await fetch('/aiken/workspace/create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ filePath: fp, content }),
    });
    if (!r.ok) return notify('Error creating file: ' + (await r.text()), 'error');
    await refreshAikenFiles();
    await selectAikenFile(fp, name);
}

// Expose globally
window.refreshAikenFiles    = refreshAikenFiles;
window.selectAikenFile      = selectAikenFile;
window.runAikenWorkspaceFile = (fp, fn) => {
    selectAikenFile(fp, fn).then(() => {
        if (window.runAikenCode) window.runAikenCode({ fileName: fp });
    });
};