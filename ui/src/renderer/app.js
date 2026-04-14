import "./styles/main.css";
import "./styles/editor.css";
import { initEditor } from "./editor.js";
import { initSidebar, populateContextSelects, initContextManager, initDbSelector } from "./sidebar.js";
import { initPanels } from "./panels.js";
import { initContextMenu } from "./contextmenu.js";
import { initSettings } from "./settings.js";

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── App state ────────────────────────────────────────────────────────────────
const state = {
  filePath: null,     // string | null — path if opened from disk
  thoughtId: null,    // number | null — DB id if opened from brain
  isDirty: false,
  currentContext: "",
};

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  const editor = await initEditor({
    container: document.getElementById("editor"),
    onChange(markdown) {
      state.isDirty = true;
      updateWordCount(markdown);
      updateStatus();
    },
  });

  await initSidebar({
    onContextChange(ctx) {
      state.currentContext = ctx;
    },
    onThoughtSelect(thought) {
      editor.setMarkdown(thought.text);
      state.filePath = null;
      state.thoughtId = thought.id;
      state.isDirty = false;
      updateStatus();
      flash(`Loaded thought #${thought.id}`);
    },
  });

  initContextManager({
    onChanged: async () => {
      const contexts = await window.brain.listContexts();
      populateContextSelects(contexts);
    },
  });

  initDbSelector({
    onSwitched() {
      state.thoughtId = null;
      updateStatus();
      window.dispatchEvent(new Event("brain:refresh"));
    },
  });

  initPanels({
    onThoughtLoad(thought) {
      editor.setMarkdown(thought.text);
      state.filePath = null;
      state.thoughtId = thought.id;
      state.isDirty = false;
      updateStatus();
      flash(`Loaded thought #${thought.id}`);
    },
  });

  initContextMenu(editor);
  initSettings();

  // ── Toolbar ────────────────────────────────────────────────────────────────
  document.getElementById("toolbar").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cmd]");
    if (btn) editor.execCommand(btn.dataset.cmd);
  });

  // ── File actions ───────────────────────────────────────────────────────────
  document.getElementById("btn-save-file").addEventListener("click", () => saveFile(editor));
  document.getElementById("btn-open").addEventListener("click", () => openFile(editor));
  document.getElementById("btn-new").addEventListener("click", () => newDoc(editor));

  // ── Save to Brain ─────────────────────────────────────────────────────────
  document.getElementById("btn-save-brain").addEventListener("click", openCaptureModal);
  document.getElementById("btn-modal-close").addEventListener("click", closeCaptureModal);
  document.getElementById("btn-cancel-capture").addEventListener("click", closeCaptureModal);
  document.getElementById("btn-confirm-capture").addEventListener("click", () => saveToBrain(editor));

  // Close modal on backdrop click
  document.getElementById("capture-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeCaptureModal();
  });

  // ── Panel tabs ─────────────────────────────────────────────────────────────
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });

  // ── Editor font size ───────────────────────────────────────────────────────
  const EDITOR_SIZE_KEY = "editor-font-size";
  const EDITOR_SIZE_MIN = 10;
  const EDITOR_SIZE_MAX = 24;

  const milkdownEl = document.querySelector(".milkdown") ?? document.getElementById("editor");

  function getEditorFontSize() {
    return parseInt(localStorage.getItem(EDITOR_SIZE_KEY) ?? "14", 10);
  }

  function setEditorFontSize(size) {
    const clamped = Math.min(EDITOR_SIZE_MAX, Math.max(EDITOR_SIZE_MIN, size));
    localStorage.setItem(EDITOR_SIZE_KEY, String(clamped));
    milkdownEl.style.setProperty("--editor-font-size", `${clamped}px`);
  }

  setEditorFontSize(getEditorFontSize());

  // ── Command registry ──────────────────────────────────────────────────────
  const commands = [
    { id: "save-file",      label: "Save File",              shortcut: "Ctrl+S",       action: () => saveFile(editor) },
    { id: "save-brain",     label: "Save to Brain",          shortcut: "Ctrl+Shift+S", action: openCaptureModal },
    { id: "new-doc",        label: "New Document",           shortcut: "Ctrl+N",       action: () => newDoc(editor) },
    { id: "open-file",      label: "Open File",              shortcut: "Ctrl+O",       action: () => openFile(editor) },
    { id: "font-increase",  label: "Increase Editor Font",   shortcut: "Ctrl+=",       action: () => setEditorFontSize(getEditorFontSize() + 1) },
    { id: "font-decrease",  label: "Decrease Editor Font",   shortcut: "Ctrl+-",       action: () => setEditorFontSize(getEditorFontSize() - 1) },
    { id: "font-reset",     label: "Reset Editor Font",      shortcut: "Ctrl+0",       action: () => setEditorFontSize(14) },
    { id: "palette",        label: "Open Command Palette",   shortcut: "Ctrl+K",       action: openPalette },
  ];

  function dispatchCommand(id) {
    commands.find((c) => c.id === id)?.action();
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeCaptureModal(); closePalette(); return; }

    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;

    const k = e.key.toLowerCase();
    if (k === "s" && e.shiftKey)  { e.preventDefault(); dispatchCommand("save-brain");    return; }
    if (k === "s")                { e.preventDefault(); dispatchCommand("save-file");     return; }
    if (k === "n")                { e.preventDefault(); dispatchCommand("new-doc");       return; }
    if (k === "o")                { e.preventDefault(); dispatchCommand("open-file");     return; }
    if (k === "k")                { e.preventDefault(); paletteEl.hasAttribute("hidden") ? dispatchCommand("palette") : closePalette(); return; }
    if (e.key === "=" || e.key === "+") { e.preventDefault(); dispatchCommand("font-increase"); return; }
    if (e.key === "-" && !e.shiftKey)   { e.preventDefault(); dispatchCommand("font-decrease"); return; }
    if (e.key === "0")            { e.preventDefault(); dispatchCommand("font-reset");    return; }
  });

  // ── Command palette ───────────────────────────────────────────────────────
  const paletteEl   = document.getElementById("cmd-palette");
  const paletteInput = document.getElementById("cmd-palette-input");
  const paletteList  = document.getElementById("cmd-palette-list");

  let paletteSelectedIdx = 0;

  function openPalette() {
    paletteInput.value = "";
    renderPaletteItems("");
    paletteEl.removeAttribute("hidden");
    paletteInput.focus();
  }

  function closePalette() {
    paletteEl.setAttribute("hidden", "");
  }

  function renderPaletteItems(query) {
    const q = query.toLowerCase();
    const filtered = commands.filter((c) => c.id !== "palette" && c.label.toLowerCase().includes(q));
    paletteSelectedIdx = 0;
    paletteList.innerHTML = filtered.length
      ? filtered.map((c, i) => `
          <li class="palette-item${i === 0 ? " palette-item--selected" : ""}" data-id="${c.id}" tabindex="-1">
            <span class="palette-label">${escapeHtml(c.label)}</span>
            <span class="palette-shortcut">${escapeHtml(c.shortcut)}</span>
          </li>`).join("")
      : '<li class="palette-empty">No matching commands</li>';
  }

  function setPaletteSelection(idx) {
    const items = [...paletteList.querySelectorAll(".palette-item")];
    if (!items.length) return;
    paletteSelectedIdx = (idx + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle("palette-item--selected", i === paletteSelectedIdx));
    items[paletteSelectedIdx].scrollIntoView({ block: "nearest" });
    paletteInput.focus();
  }

  paletteInput.addEventListener("input", () => renderPaletteItems(paletteInput.value));

  paletteInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setPaletteSelection(paletteSelectedIdx + 1); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setPaletteSelection(paletteSelectedIdx - 1); }
    if (e.key === "Enter") {
      e.preventDefault();
      const selected = paletteList.querySelector(".palette-item--selected");
      if (selected) { closePalette(); dispatchCommand(selected.dataset.id); }
    }
  });

  paletteList.addEventListener("mousemove", (e) => {
    const item = e.target.closest(".palette-item");
    if (!item) return;
    const items = [...paletteList.querySelectorAll(".palette-item")];
    setPaletteSelection(items.indexOf(item));
  });

  paletteList.addEventListener("click", (e) => {
    const item = e.target.closest(".palette-item");
    if (item) { closePalette(); dispatchCommand(item.dataset.id); }
  });

  paletteEl.addEventListener("click", (e) => {
    if (e.target === paletteEl) closePalette();
  });

  // ── Load initial data ──────────────────────────────────────────────────────
  await loadInitialData();
  checkServerHealth();
  setInterval(checkServerHealth, 10_000);
}

// ─── Initial data ─────────────────────────────────────────────────────────────
async function loadInitialData() {
  try {
    const contexts = await window.brain.listContexts();
    populateContextSelects(contexts);
  } catch {
    // server may still be warming up — not fatal
  }
}

// ─── Server health ────────────────────────────────────────────────────────────
async function checkServerHealth() {
  const dot = document.getElementById("status-server");
  try {
    await window.brain.listContexts();
    dot.classList.add("server-ok");
    dot.classList.remove("server-err");
    dot.title = "Server connected";
  } catch {
    dot.classList.remove("server-ok");
    dot.classList.add("server-err");
    dot.title = "Server not reachable";
  }
}

// ─── File operations ──────────────────────────────────────────────────────────
async function saveFile(editor) {
  const markdown = editor.getMarkdown();
  if (!markdown.trim()) {
    flash("Nothing to save.");
    return;
  }

  let filePath = state.filePath;
  if (!filePath) {
    const result = await window.fs.showSaveDialog("untitled.md");
    if (!result.filePath) return;
    filePath = result.filePath;
  }

  try {
    await window.fs.write(filePath, markdown);
    state.filePath = filePath;
    state.isDirty = false;
    updateStatus();
    flash("Saved.");
  } catch (err) {
    flash(`Save failed: ${err.message}`);
  }
}

async function openFile(editor) {
  if (state.isDirty && !confirm("Discard unsaved changes?")) return;
  const result = await window.fs.showOpenDialog();
  if (!result.filePath) return;

  try {
    const { content } = await window.fs.read(result.filePath);
    editor.setMarkdown(content);
    state.filePath = result.filePath;
    state.thoughtId = null;
    state.isDirty = false;
    updateStatus();
    flash("File opened.");
  } catch (err) {
    flash(`Open failed: ${err.message}`);
  }
}

function newDoc(editor) {
  if (state.isDirty && !confirm("Discard unsaved changes?")) return;
  editor.setMarkdown("");
  state.filePath = null;
  state.thoughtId = null;
  state.isDirty = false;
  updateStatus();
}

// ─── Capture modal ────────────────────────────────────────────────────────────
function openCaptureModal() {
  // Sync context select with sidebar selection
  const sel = document.getElementById("capture-context");
  if (state.currentContext && [...sel.options].some((o) => o.value === state.currentContext)) {
    sel.value = state.currentContext;
  }
  // Update modal title to reflect update vs create
  document.getElementById("modal-title").textContent = state.thoughtId
    ? `Update Thought #${state.thoughtId}`
    : "Save to Brain";
  document.getElementById("btn-confirm-capture").textContent = state.thoughtId ? "Update" : "Save";
  document.getElementById("capture-modal").removeAttribute("hidden");
  document.getElementById("capture-context").focus();
}

function closeCaptureModal() {
  document.getElementById("capture-modal").setAttribute("hidden", "");
}

async function saveToBrain(editor) {
  const text = editor.getMarkdown().trim();
  if (!text) {
    flash("Nothing to save.");
    closeCaptureModal();
    return;
  }

  const context = document.getElementById("capture-context").value || undefined;
  const project = document.getElementById("capture-project").value.trim() || undefined;
  const topicsRaw = document.getElementById("capture-topics").value;
  const topics = topicsRaw
    ? topicsRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : undefined;
  const source_type = document.getElementById("capture-source").value;

  const btn = document.getElementById("btn-confirm-capture");
  btn.textContent = "Saving…";
  btn.disabled = true;

  try {
    let thought;
    if (state.thoughtId) {
      thought = await window.brain.updateThought(state.thoughtId, { text, context, project, topics, source_type });
      closeCaptureModal();
      flash(`Updated thought #${thought.id}`);
    } else {
      thought = await window.brain.capture({ text, context, project, topics, source_type });
      state.thoughtId = thought.id;
      closeCaptureModal();
      flash(`Saved to brain as #${thought.id}`);
      // Reset form fields only on create
      document.getElementById("capture-project").value = "";
      document.getElementById("capture-topics").value = "";
    }
    state.isDirty = false;
    updateStatus();
    window.dispatchEvent(new Event("brain:refresh"));
  } catch (err) {
    flash(`Error: ${err.message}`);
  } finally {
    btn.textContent = state.thoughtId ? "Update" : "Save";
    btn.disabled = false;
  }
}

// ─── Status bar ───────────────────────────────────────────────────────────────
function updateStatus() {
  let name;
  if (state.filePath) {
    name = state.filePath.split(/[\\/]/).pop();
  } else if (state.thoughtId) {
    name = `Thought #${state.thoughtId}`;
  } else {
    name = "Untitled";
  }
  document.getElementById("status-file").textContent = name + (state.isDirty ? " ●" : "");
}

function updateWordCount(markdown) {
  const words = markdown.trim() ? markdown.trim().split(/\s+/).length : 0;
  document.getElementById("status-words").textContent = `${words} word${words !== 1 ? "s" : ""}`;
}

let flashTimer = null;
function flash(msg) {
  const el = document.getElementById("status-msg");
  el.textContent = msg;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    el.textContent = "";
  }, 3500);
}

init().catch(console.error);
