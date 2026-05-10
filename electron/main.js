const { app, BrowserWindow, nativeTheme, shell } = require("electron");
const path = require("node:path");
const net = require("node:net");

app.setName("AnkiTron");

const isDev = !app.isPackaged;
const DEV_URL = "http://localhost:3000";
const SPLASH_PATH = path.join(__dirname, "splash.html");

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
  // process.title to "next-server (vX.Y.Z)" — restore it so macOS keeps
  // showing AnkiTron in the menu bar / Activity Monitor.
  const previousTitle = process.title;
  require(path.join(standaloneDir, "server.js"));
  process.title = previousTitle;

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

  try {
    const url = isDev ? DEV_URL : await startNextServer();
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
