const { app, BrowserWindow, Menu, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let serverProcess;
let mainWindow;

const APP_PORT = 3000;

function waitForServer() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30000;

    const check = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${APP_PORT}/api/health`);
        if (response.ok) {
          resolve();
          return;
        }
      } catch {}

      if (Date.now() >= deadline) {
        reject(new Error('The Stratum server did not become ready.'));
      } else {
        setTimeout(check, 250);
      }
    };

    check();
  });
}

function startServer() {
  const nodeExecutable = process.execPath;
  const tsxCli = require.resolve('tsx/dist/cli.mjs');
  const serverEntry = path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'server.ts');

  serverProcess = spawn(nodeExecutable, [tsxCli, serverEntry], {
    cwd: app.isPackaged ? process.resourcesPath : app.getAppPath(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(APP_PORT),
    },
    stdio: 'ignore',
  });

  serverProcess.on('error', (error) => {
    console.error('Unable to start Stratum server:', error);
  });
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.reload(),
        },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://github.com/Kojowusu52/Data_Curator-1'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Stratum',
    backgroundColor: '#f8fafc',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await waitForServer();
  await mainWindow.loadURL(`http://127.0.0.1:${APP_PORT}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  app.setName('Stratum');

  const hasSingleInstanceLock = app.requestSingleInstanceLock();
  if (!hasSingleInstanceLock) {
    app.quit();
    return;
  }

  createMenu();
  startServer();

  try {
    await createWindow();
  } catch (error) {
    console.error(error);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});
