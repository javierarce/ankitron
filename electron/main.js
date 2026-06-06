const { app, BrowserWindow, nativeTheme, protocol, shell } = require("electron");
const path = require("node:path");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");

app.setName("AnkiTron");

const isDev = !app.isPackaged;
const DEV_URL = "http://localhost:3000";
const APP_URL = "app://ankitron/";
const SPLASH_PATH = path.join(__dirname, "splash.html");
const ANKICONNECT_URL = "http://127.0.0.1:8765";

// Register the app:// scheme as a standard, secure origin *before* app-ready.
// The packaged build loads from app://ankitron/ instead of http://127.0.0.1:<random-port>/
// so the renderer's origin (and therefore localStorage, IndexedDB, cookies) is
// stable across launches. Without this, the Next server's port changes every
// run and all browser-storage state is silently orphaned.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow = null;
let nextServerOrigin = null;
let spawnedAnki = null;
let ankiWatchdog = null;

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

// Locate the real Anki executable. Anki 25.09+ uses a `uv`-based launcher: the
// .app bundle only contains a bootstrapper, while the actual binary lives in a
// managed venv under AnkiProgramFiles. Older builds shipped the binary directly
// inside the .app. We return whichever exists, preferring the newer layout.
function findAnkiExecutable() {
  const home = os.homedir();
  const candidates = [];
  if (process.platform === "darwin") {
    candidates.push(
      path.join(home, "Library/Application Support/AnkiProgramFiles/.venv/bin/anki"),
      "/Applications/Anki.app/Contents/MacOS/anki"
    );
  } else if (process.platform === "linux") {
    candidates.push(path.join(home, ".local/share/AnkiProgramFiles/.venv/bin/anki"));
  }
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function spawnAnkiHidden() {
  try {
    // QT_QPA_PLATFORM=offscreen runs Anki (a Qt app) with no visible window and
    // no Dock activation, so AnkiConnect's HTTP server comes up on 8765 without
    // the app ever appearing. This replaces the old macOS approach of
    // `open -gja Anki` + a System Events "set visible false" AppleScript, which
    // required the user to grant accessibility control over System Events.
    //
    // The GPU flags are essential, not optional: Anki's UI is QtWebEngine, and
    // its GPU process segfaults within seconds under the offscreen platform on
    // macOS. Forcing software rendering keeps the headless instance stable.
    const env = {
      ...process.env,
      QT_QPA_PLATFORM: "offscreen",
      QTWEBENGINE_CHROMIUM_FLAGS:
        "--disable-gpu --disable-gpu-compositing --disable-software-rasterizer",
    };
    const exe = findAnkiExecutable();
    const child = exe
      ? spawn(exe, [], { detached: true, stdio: "ignore", env })
      : // Linux fallback: rely on `anki` being on PATH if the venv layout isn't found.
        process.platform === "linux"
        ? spawn("anki", [], { detached: true, stdio: "ignore", env })
        : null;
    if (!child) return false;
    child.on("error", () => {});
    child.unref();
    // Remember the instance we launched so we can shut it down on quit. Only set
    // when WE spawn it — if Anki was already running, ensureAnkiRunning() returns
    // before reaching here, so we never adopt (or later kill) the user's own Anki.
    spawnedAnki = child;
    spawnAnkiWatchdog(child.pid);
    return true;
  } catch {
    return false;
  }
}

// Guard against AnkiTron dying WITHOUT running before-quit (force-quit, crash).
// In that case stopSpawnedAnki() never fires, so the headless Anki would keep
// holding port 8765 — and the OS won't reap it for us (macOS has no
// PR_SET_PDEATHSIG; detached children outlive their parent). So we spawn a small
// detached sh watchdog that polls AnkiTron's pid and, once it disappears, kills
// the Anki process group. Being detached, the watchdog survives the crash that
// orphaned Anki and cleans up within a couple of seconds. (A kernel panic needs
// no watchdog: the reboot frees the port anyway.)
function spawnAnkiWatchdog(ankiPid) {
  const script =
    `while kill -0 ${process.pid} 2>/dev/null; do sleep 2; done; ` +
    `kill -TERM -${ankiPid} 2>/dev/null`;
  const wd = spawn("/bin/sh", ["-c", script], { detached: true, stdio: "ignore" });
  wd.on("error", () => {});
  wd.unref();
  ankiWatchdog = wd;
}

// Terminate the headless Anki we launched so it stops holding port 8765 — without
// this, opening Anki normally after AnkiTron quits fails with "Failed to listen on
// port 8765". detached:true made the child a process-group leader, so signalling
// the negative pid takes down the launcher, the aqt process, and audio helpers
// together.
function stopSpawnedAnki() {
  const child = spawnedAnki;
  const wd = ankiWatchdog;
  spawnedAnki = null;
  ankiWatchdog = null;
  // Stop the watchdog first so it doesn't also race to kill the same group.
  if (wd && !wd.killed && wd.pid != null) {
    try {
      wd.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
  if (!child || child.killed || child.pid == null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
}

async function ensureAnkiRunning(maxWaitMs = 15000) {
  if (await isAnkiConnectUp()) return true;
  if (!spawnAnkiHidden()) return false;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isAnkiConnectUp()) return true;
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
  nextServerOrigin = url;
  return url;
}

function registerAppProtocol() {
  protocol.handle("app", async (request) => {
    if (!nextServerOrigin) {
      return new Response("Server not ready", { status: 503 });
    }
    const url = new URL(request.url);
    const target = nextServerOrigin + url.pathname + url.search;

    const init = {
      method: request.method,
      headers: request.headers,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
      init.duplex = "half";
    }
    return fetch(target, init);
  });
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
    let url;
    if (isDev) {
      url = DEV_URL;
    } else {
      await startNextServer();
      registerAppProtocol();
      url = APP_URL;
    }
    await ankiReady;
    await mainWindow.loadURL(url);
  } catch (err) {
    console.error("Failed to load app:", err);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
}

app.whenReady().then(createWindow);

// Shut the headless Anki down when AnkiTron quits so it releases port 8765.
app.on("before-quit", stopSpawnedAnki);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
