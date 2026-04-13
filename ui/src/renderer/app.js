import "./styles/main.css";
import "./styles/editor.css";
import { initEditor } from "./editor.js";
import { initSidebar, populateContextSelects } from "./sidebar.js";
import { initPanels } from "./panels.js";
import { initContextMenu } from "./contextmenu.js";

// ─── App state ────────────────────────────────────────────────────────────────
const state = {
  filePath: null,
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
      state.isDirty = false;
      updateStatus();
      flash(`Loaded thought #${thought.id}`);
    },
  });

  initPanels({
    onThoughtLoad(thought) {
      editor.setMarkdown(thought.text);
      state.filePath = null;
      state.isDirty = false;
      updateStatus();
      flash(`Loaded thought #${thought.id}`);
    },
  });

  initContextMenu(editor);

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

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (e.key === "s" && e.shiftKey) {
        e.preventDefault();
        openCaptureModal();
        return;
      }
      if (e.key === "s") {
        e.preventDefault();
        saveFile(editor);
        return;
      }
      if (e.key === "n") {
        e.preventDefault();
        newDoc(editor);
        return;
      }
      if (e.key === "o") {
        e.preventDefault();
        openFile(editor);
        return;
      }
    }
    if (e.key === "Escape") closeCaptureModal();
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
    const thought = await window.brain.capture({ text, context, project, topics, source_type });
    closeCaptureModal();
    flash(`Saved to brain as #${thought.id}`);
    window.dispatchEvent(new Event("brain:refresh"));

    // Reset form fields
    document.getElementById("capture-project").value = "";
    document.getElementById("capture-topics").value = "";
  } catch (err) {
    flash(`Error: ${err.message}`);
  } finally {
    btn.textContent = "Save";
    btn.disabled = false;
  }
}

// ─── Status bar ───────────────────────────────────────────────────────────────
function updateStatus() {
  const name = state.filePath ? state.filePath.split(/[\\/]/).pop() : "Untitled";
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
