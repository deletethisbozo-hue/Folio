const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");
const { pathToFileURL } = require("node:url");

let mainWindow = null;

function firstMatchingFile(root, names) {
  if (!root || !fs.existsSync(root)) return null;
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (wanted.has(entry.name.toLowerCase())) return full;
    }
  }
  return null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 4242;
      server.close(() => resolve(port));
    });
  });
}

function waitForServer(url, attempts = 100) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tryOnce = () => {
      n += 1;
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) return resolve();
        if (n >= attempts) return reject(new Error(`Folio server returned ${res.statusCode}`));
        setTimeout(tryOnce, 100);
      });
      req.on("error", () => {
        if (n >= attempts) return reject(new Error("Folio server did not start."));
        setTimeout(tryOnce, 100);
      });
      req.setTimeout(1000, () => req.destroy());
    };
    tryOnce();
  });
}

async function startFolio() {
  const requestedPort = Number(process.env.FOLIO_E2E_PORT || 0);
  const port = requestedPort > 0 ? requestedPort : await freePort();
  const appRoot = app.getAppPath();

  process.env.PORT = String(port);
  process.env.HOST = "127.0.0.1";
  process.env.FOLIO_ROOT = appRoot;
  process.env.FOLIO_RESOURCE_ROOT = app.isPackaged
    ? path.join(process.resourcesPath, "app-resources")
    : appRoot;
  process.env.FOLIO_WRITABLE_ROOT = app.getPath("userData");
  process.env.BOOK_FORMATTER_NO_OPEN = "1";

  if (app.isPackaged) {
    const pandoc = path.join(process.resourcesPath, "pandoc", "pandoc.exe");
    if (fs.existsSync(pandoc)) process.env.PANDOC_BIN = pandoc;

    const chromium = firstMatchingFile(path.join(process.resourcesPath, "chromium"), [
      "chrome-headless-shell.exe",
      "chrome.exe",
    ]);
    if (chromium) process.env.PUPPETEER_EXECUTABLE_PATH = chromium;
  }

  const serverEntry = path.join(appRoot, "dist-server", "server.mjs");
  await import(pathToFileURL(serverEntry).href);

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(`${baseUrl}/api/health`);

  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    title: "Folio",
    width: 1480,
    height: 920,
    minWidth: 1000,
    minHeight: 650,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#efefed",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(baseUrl);
}

const gotLock = app.requestSingleInstanceLock();
app.setName("Folio");
if (process.env.FOLIO_E2E_DEBUG_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.FOLIO_E2E_DEBUG_PORT);
}
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId("com.folio.bookformatter");
    return startFolio();
  }).catch((error) => {
    dialog.showErrorBox(
      "Folio could not start",
      `${error instanceof Error ? error.message : String(error)}\n\nTry downloading the Windows release again.`,
    );
    app.quit();
  });

  app.on("window-all-closed", () => app.quit());
}
