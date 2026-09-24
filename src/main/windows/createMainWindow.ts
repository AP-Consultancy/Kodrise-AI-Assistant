import { BrowserWindow } from 'electron';
import path from 'node:path';
import { getAppServices } from '../services/appContext';
import { registerInterviewIpcHandlers } from '../ipc/interviewHandlers';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const DEFAULT_WINDOW_SIZE = { width: 1180, height: 820 };
const MIN_WINDOW_SIZE = { width: 860, height: 600 };

/**
 * Secure BrowserWindow defaults.
 *
 * sandbox: true — compatible with contextIsolation + preload path loading.
 * Capture privacy policy is applied via CapturePolicyHost after creation.
 */
export function createMainWindow(): BrowserWindow {
  // Bind before the renderer can invoke document upload.
  registerInterviewIpcHandlers();

  const mainWindow = new BrowserWindow({
    width: DEFAULT_WINDOW_SIZE.width,
    height: DEFAULT_WINDOW_SIZE.height,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    show: false,
    title: 'AP AI Assistance Tool',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

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

  return mainWindow;
}
