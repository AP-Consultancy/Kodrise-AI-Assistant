import { BrowserWindow } from 'electron';
import path from 'node:path';
import { getAppServices } from '../services/appContext';
import { registerInterviewIpcHandlers } from '../ipc/interviewHandlers';
import { registerDisplayMediaLoopbackHandler } from '../audio/input/registerDisplayMediaLoopbackHandler';
import { bindWindowMaximizeEvents } from '../ipc/windowHandlers';
import { logger } from '../services/logging';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const DEFAULT_WINDOW_SIZE = { width: 1180, height: 820 };
const MIN_WINDOW_SIZE = { width: 860, height: 600 };

/**
 * Secure BrowserWindow with true transparency (Phase 2O.2).
 *
 * Windows: transparent:true + frame:false + fully transparent backgroundColor.
 * The renderer paints a rounded glass shell with outer margins so the desktop
 * shows through the window corners/edges.
 *
 * Security unchanged: contextIsolation, nodeIntegration:false, sandbox, webSecurity.
 * Capture privacy policy remains separate and is applied after creation.
 */
export function createMainWindow(): BrowserWindow {
  registerInterviewIpcHandlers();

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: DEFAULT_WINDOW_SIZE.width,
    height: DEFAULT_WINDOW_SIZE.height,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    show: false,
    title: 'AP AI Assistance Tool',
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  };

  // Windows: keep resize grip on frameless transparent windows.
  if (process.platform === 'win32') {
    windowOptions.thickFrame = true;
  }

  // macOS: optional vibrancy under the transparent content (does not affect Windows).
  if (process.platform === 'darwin') {
    windowOptions.vibrancy = 'under-window';
    windowOptions.visualEffectState = 'active';
  }

  const mainWindow = new BrowserWindow(windowOptions);

  logger.info('window.created', {
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    platform: process.platform,
  });

  bindWindowMaximizeEvents(mainWindow);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  try {
    getAppServices().capturePolicy.onWindowCreated(mainWindow);
  } catch {
    // Services may be unavailable only in isolated tests; production always initializes first.
  }

  registerDisplayMediaLoopbackHandler(mainWindow);

  return mainWindow;
}
