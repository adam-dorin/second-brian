import { contextBridge, ipcRenderer } from "electron";

const API = "http://127.0.0.1:8741";
const secret = process.env.MCP_SECRET;

function headers(extra = {}) {
  return {
    "content-type": "application/json",
    ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    ...extra,
  };
}

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: headers(opts.headers),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Brain API ────────────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld("brain", {
  // Thoughts
  capture(data) {
    return api("/thoughts", { method: "POST", body: JSON.stringify(data) });
  },
  recent(params = {}) {
    const q = new URLSearchParams();
    if (params.context) q.set("context", params.context);
    if (params.project) q.set("project", params.project);
    q.set("limit", String(params.limit ?? 15));
    return api(`/thoughts?${q}`);
  },
  search(query, params = {}) {
    const q = new URLSearchParams({ q: query });
    if (params.context) q.set("context", params.context);
    if (params.project) q.set("project", params.project);
    q.set("limit", String(params.limit ?? 10));
    return api(`/thoughts/search?${q}`);
  },
  getThought(id) {
    return api(`/thoughts/${id}`);
  },
  reviewQueue(limit = 10) {
    return api(`/thoughts/review?limit=${limit}`);
  },
  confirm(id) {
    return api(`/thoughts/${id}/confirm`, { method: "PATCH" });
  },
  dispute(id) {
    return api(`/thoughts/${id}/dispute`, { method: "PATCH" });
  },

  // Contexts
  listContexts() {
    return api("/contexts");
  },
  addContext(data) {
    return api("/contexts", { method: "POST", body: JSON.stringify(data) });
  },
  deleteContext(name) {
    return api(`/contexts/${encodeURIComponent(name)}`, { method: "DELETE" });
  },

  // Analysis
  patterns() {
    return api("/patterns");
  },
  digest() {
    return api("/digest");
  },
});

// ─── File system (via IPC) ────────────────────────────────────────────────────
contextBridge.exposeInMainWorld("fs", {
  write: (filePath, content) => ipcRenderer.invoke("fs:write", { filePath, content }),
  read: (filePath) => ipcRenderer.invoke("fs:read", { filePath }),
  showSaveDialog: (defaultName) => ipcRenderer.invoke("dialog:save", { defaultName }),
  showOpenDialog: () => ipcRenderer.invoke("dialog:open"),
});
