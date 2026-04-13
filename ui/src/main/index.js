import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { join } from "path";
import { spawn } from "child_process";
import { readFile, writeFile, existsSync, writeFileSync } from "fs";
import { readFileSync } from "fs";
import { promisify } from "util";
import http from "http";

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);

// ─── Resolve project root (dev vs packaged) ───────────────────────────────────
// In dev:       UI_ROOT = …/ui,  PROJECT_ROOT = …/second-brian
// In packaged:  resources are in process.resourcesPath/app (via extraResources)
const UI_ROOT = app.getAppPath();
const IS_PACKAGED = app.isPackaged;
const PROJECT_ROOT = IS_PACKAGED ? join(process.resourcesPath, "app") : join(UI_ROOT, "..");
const envPath = join(PROJECT_ROOT, ".env");

const ENV_DEFAULTS = `# Second Brain – configuration
# Edit via the ⚙ Settings button in the app, or directly in this file.
# Changes take effect after restarting the app.

# Port the local server listens on (must match the UI's API base URL)
PORT=8741

# Bind address – keep 127.0.0.1 for local-only access
HOST=127.0.0.1

# Anthropic API key – required for the Weekly Digest feature
# Get one at https://console.anthropic.com
ANTHROPIC_API_KEY=

# Optional: absolute path to the SQLite database file
# Leave blank to use the default (brain.sqlite next to package.json)
# BRAIN_DB_PATH=

# Optional: bearer token for the remote /mcp HTTP endpoint
# Leave blank (or commented out) to disable remote MCP access
# MCP_SECRET=
`;

if (!existsSync(envPath)) {
  writeFileSync(envPath, ENV_DEFAULTS, "utf8");
}

for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 0) continue;
  const k = t.slice(0, i).trim();
  const v = t
    .slice(i + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (k && !(k in process.env)) process.env[k] = v;
}

// ─── State ────────────────────────────────────────────────────────────────────
let mainWindow = null;
let serverProcess = null;
let serverReady = false;

// ─── Server spawn ─────────────────────────────────────────────────────────────
function startServer() {
  const serverPath = join(PROJECT_ROOT, "src", "server.js");

  serverProcess = spawn("node", [serverPath], {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (d) => {
    const text = d.toString();
    console.log("[server]", text.trim());
    // Fastify/pino logs "Server listening" when ready
    if (!serverReady && text.includes("listening")) {
      serverReady = true;
    }
  });
  serverProcess.stderr.on("data", (d) => {
    const msg = d.toString().trim();
    if (!msg.includes("[warn]") && !msg.includes("ExperimentalWarning")) {
      console.error("[server]", msg);
    }
  });
  serverProcess.on("exit", (code) => console.log(`[server] exited (${code})`));
}

// Poll the server's /contexts endpoint until it responds or we time out.
// PORT and HOST are read from process.env (already populated from .env above).
function waitForServer(timeoutMs = 10000) {
  const port = process.env.PORT ?? "8741";
  const host = process.env.HOST ?? "127.0.0.1";
  const start = Date.now();
  return new Promise((resolve) => {
    function probe() {
      const req = http.get(`http://${host}:${port}/contexts`, (res) => {
        res.resume(); // drain response body
        serverReady = true;
        resolve();
      });
      req.setTimeout(500, () => {
        req.destroy();
      });
      req.on("error", () => {
        if (Date.now() - start >= timeoutMs) {
          console.warn("[main] server did not become ready in time — opening anyway");
          resolve();
        } else {
          setTimeout(probe, 300);
        }
      });
    }
    probe();
  });
}

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  const port = process.env.PORT ?? "8741";
  const host = process.env.HOST ?? "127.0.0.1";
  const apiOrigin = `http://${host}:${port}`;

  // Override CSP header so it always matches the actual server origin,
  // regardless of what is baked into the static index.html meta tag.
  const { session } = require("electron");
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          `default-src 'self'; connect-src ${apiOrigin} ws://localhost:*; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:`,
        ],
      },
    });
  });

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: "#0f1117",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Allow renderer to fetch from the local Fastify server (127.0.0.1:8741)
      // without CORS/CSP restrictions. Safe for a local-only desktop tool.
      webSecurity: false,
    },
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // Reset any persisted zoom and lock it at 1 (100%)
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.setZoomFactor(1);
    mainWindow.webContents.setZoomLevel(0);
  });

  // Disable pinch-to-zoom / Ctrl+scroll zoom
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);

  // Prevent Ctrl+/- keyboard zoom
  mainWindow.webContents.on("before-input-event", (_e, input) => {
    if (input.control || input.meta) {
      if (input.key === "+" || input.key === "-" || input.key === "=" || input.key === "0") {
        _e.preventDefault();
      }
    }
  });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  startServer();
  await waitForServer(8000);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

// ─── IPC handlers ─────────────────────────────────────────────────────────────
ipcMain.handle("fs:write", async (_e, { filePath, content }) => {
  await writeFileAsync(filePath, content, "utf8");
  return { success: true };
});

ipcMain.handle("fs:read", async (_e, { filePath }) => {
  const content = await readFileAsync(filePath, "utf8");
  return { content };
});

ipcMain.handle("dialog:save", async (_e, { defaultName }) => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName ?? "untitled.md",
    filters: [
      { name: "Markdown", extensions: ["md", "markdown"] },
      { name: "Text", extensions: ["txt"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  return { filePath: canceled ? null : filePath };
});

ipcMain.handle("dialog:open", async () => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "txt"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  return { filePath: canceled || !filePaths.length ? null : filePaths[0] };
});

ipcMain.handle("shell:openExternal", (_e, url) => {
  shell.openExternal(url);
});

// ─── Env file read / write ────────────────────────────────────────────────────
// Returns { vars: { KEY: { value, comment } }[], raw: string }
// where comment is the inline or preceding-line comment, if any.
ipcMain.handle("env:read", () => {
  const raw = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  // Parse into an ordered list so the editor can preserve file order
  const lines = raw.split("\n");
  const vars = [];
  let pendingComment = "";

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      pendingComment = "";
      continue;
    }
    if (t.startsWith("#")) {
      pendingComment = pendingComment ? pendingComment + "\n" + t.slice(1).trim() : t.slice(1).trim();
      continue;
    }
    const i = t.indexOf("=");
    if (i < 0) {
      pendingComment = "";
      continue;
    }
    const key = t.slice(0, i).trim();
    const val = t
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    vars.push({ key, value: val, comment: pendingComment });
    pendingComment = "";
  }
  return { vars, raw };
});

// Receives { vars: Array<{ key, value }> } — rewrites the .env with those pairs
ipcMain.handle("env:save", (_e, { vars }) => {
  // Validate: keys must be uppercase alphanumeric + underscore only
  for (const { key } of vars) {
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
      throw new Error(`Invalid env key: ${key}`);
    }
  }
  const lines = vars
    .filter(({ key }) => key.trim())
    .map(({ key, value }) => {
      const needsQuotes = /\s|#/.test(value);
      return `${key.trim()}=${needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value}`;
    });
  writeFileSync(envPath, lines.join("\n") + "\n", "utf8");
  return { success: true };
});
