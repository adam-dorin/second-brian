import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { join } from "path";
import { spawn } from "child_process";
import { readFile, writeFile, existsSync } from "fs";
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

if (existsSync(envPath)) {
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

// Poll http://127.0.0.1:8741/contexts until the server responds or we time out
function waitForServer(timeoutMs = 10000) {
  const start = Date.now();
  return new Promise((resolve) => {
    function probe() {
      const req = http.get("http://127.0.0.1:8741/contexts", (res) => {
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
