const { app, BrowserWindow, nativeTheme, shell } = require("electron");
const path = require("node:path");
const net = require("node:net");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

app.setName("AnkiTron");

const isDev = !app.isPackaged;
const DEV_URL = "http://localhost:3000";
const SPLASH_PATH = path.join(__dirname, "splash.html");
const ANKICONNECT_URL = "http://127.0.0.1:8765";

let mainWindow = null;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function isAnkiConnectUp(timeoutMs = 500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(ANKICONNECT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "version", version: 6 }),
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const data = await res.json();
    return typeof data.result === "number";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function spawnAnkiHidden() {
  try {
    if (process.platform === "darwin") {
      if (!fs.existsSync("/Applications/Anki.app")) return false;
      // -g: don't activate, -j: launch hidden, -a: by app name
      const child = spawn("open", ["-gja", "Anki"], { detached: true, stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
      return true;
    }
    if (process.platform === "linux") {
      const child = spawn("anki", [], { detached: true, stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function hideAnkiApp() {
  if (process.platform !== "darwin") return;
  // `open -j` asks for hidden launch, but Anki often un-hides itself once its
  // main window loads. Send an explicit Hide once AnkiConnect is reachable
  // (meaning Anki is done initializing) so the hide actually sticks.
  const child = spawn(
    "osascript",
    ["-e", 'tell application "System Events" to set visible of process "Anki" to false'],
    { stdio: "ignore" }
  );
  child.on("error", () => {});
}

async function ensureAnkiRunning(maxWaitMs = 15000) {
  if (await isAnkiConnectUp()) return true;
  if (!spawnAnkiHidden()) return false;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isAnkiConnectUp()) {
      hideAnkiApp();
      return true;
    }
  }
  return false;
}

async function waitForUrl(url, tries = 80, delay = 125) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function startNextServer() {
  // .next/standalone is shipped via electron-builder's extraResources,
  // unpacked to <resources>/standalone.
  const standaloneDir = path.join(process.resourcesPath, "standalone");
  const port = await getFreePort();

  process.env.PORT = String(port);
  process.env.HOSTNAME = "127.0.0.1";
  process.env.NODE_ENV = "production";

  // The standalone server self-starts on require() and overwrites
  // process.title to "next-server (vX.Y.Z)". Set it back to AnkiTron
  // so macOS keeps showing the right name in the menu bar.
  require(path.join(standaloneDir, "server.js"));
  process.title = "AnkiTron";

  const url = `http://127.0.0.1:${port}`;
  await waitForUrl(url);
  return url;
}

async function createWindow() {
  const isMac = process.platform === "darwin";
  // Match the splash background so there's no white flash before it paints.
  const backgroundColor = nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff";

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "AnkiTron",
    backgroundColor,
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: isMac ? { x: 18, y: 20 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Show the splash immediately so the user sees a spinner instead of a
  // blank window while the embedded Next server boots.
  mainWindow.loadFile(SPLASH_PATH);

  // Bring Anki up in the background so AnkiConnect is reachable by the time
  // the UI loads. Runs in parallel with the Next server boot.
  const ankiReady = ensureAnkiRunning().catch(() => false);

  try {
    const url = isDev ? DEV_URL : await startNextServer();
    await ankiReady;
    await mainWindow.loadURL(url);
  } catch (err) {
    console.error("Failed to load app:", err);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
