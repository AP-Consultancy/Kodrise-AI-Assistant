import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import type { QuestionCaptureRegion } from '../../shared/question-capture/types';

export type OverlaySelectionResult =
  | { action: 'selected'; region: QuestionCaptureRegion; previewDataUrl: string | null }
  | { action: 'cancelled' };

const OVERLAY_CHANNEL = 'question-capture:overlay-result';

/**
 * Fullscreen transparent overlay for explicit region selection.
 */
export async function selectCaptureRegion(options?: {
  displayId?: number;
}): Promise<OverlaySelectionResult> {
  const displays = screen.getAllDisplays();
  const display =
    displays.find((d) => d.id === options?.displayId) ??
    screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

  const { x, y, width, height } = display.bounds;

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildOverlayHtml())}`);
  win.show();
  win.focus();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: OverlaySelectionResult) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener(OVERLAY_CHANNEL, onMessage);
      if (!win.isDestroyed()) win.destroy();
      resolve(result);
    };

    const onMessage = (event: Electron.IpcMainEvent, payload: unknown) => {
      if (event.sender !== win.webContents) return;
      const data = payload as {
        type?: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        previewDataUrl?: string | null;
      };
      if (data?.type === 'cancel') {
        finish({ action: 'cancelled' });
        return;
      }
      if (
        data?.type === 'select' &&
        typeof data.x === 'number' &&
        typeof data.y === 'number' &&
        typeof data.width === 'number' &&
        typeof data.height === 'number'
      ) {
        finish({
          action: 'selected',
          region: {
            x: Math.round(data.x + display.bounds.x),
            y: Math.round(data.y + display.bounds.y),
            width: Math.round(data.width),
            height: Math.round(data.height),
            displayId: display.id,
          },
          previewDataUrl: data.previewDataUrl ?? null,
        });
      }
    };

    ipcMain.on(OVERLAY_CHANNEL, onMessage);
    win.on('closed', () => finish({ action: 'cancelled' }));
  });
}

function buildOverlayHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Select Question</title>
<style>
  html,body{margin:0;width:100%;height:100%;overflow:hidden;cursor:crosshair;
    background:rgba(8,10,14,0.28);font-family:Segoe UI,system-ui,sans-serif;user-select:none;}
  #hint{position:fixed;top:24px;left:50%;transform:translateX(-50%);
    padding:10px 16px;border-radius:12px;background:rgba(18,20,24,0.82);
    color:#fff;font-size:14px;z-index:2;border:1px solid rgba(255,255,255,0.12);}
  #box{position:absolute;border:2px solid #7c8cff;background:rgba(124,140,255,0.12);
    box-shadow:0 0 0 9999px rgba(0,0,0,0.35);display:none;z-index:1;}
  #actions{position:fixed;display:none;gap:8px;z-index:3;}
  button{border:1px solid rgba(255,255,255,0.14);background:rgba(20,23,28,0.9);
    color:#fff;border-radius:10px;padding:8px 14px;font-weight:600;cursor:pointer;}
  button.primary{background:#7c8cff;color:#0a0b10;border:0;}
</style>
</head>
<body>
  <div id="hint">Select Question — drag to capture · Esc to cancel</div>
  <div id="box"></div>
  <div id="actions">
    <button type="button" id="retake">Retake</button>
    <button type="button" class="primary" id="analyze">Analyze Question</button>
    <button type="button" id="cancel">Cancel</button>
  </div>
<script>
  function send(payload){
    if (window.companyAI && window.companyAI.questionCaptureOverlay) {
      window.companyAI.questionCaptureOverlay.submit(payload);
    }
  }
  const box = document.getElementById('box');
  const actions = document.getElementById('actions');
  const hint = document.getElementById('hint');
  let start = null;
  let current = null;
  let selecting = true;

  function resetSelection(){
    selecting = true; start = null; current = null;
    box.style.display = 'none'; actions.style.display = 'none'; hint.style.display = 'block';
  }

  document.getElementById('cancel').onclick = () => send({ type: 'cancel' });
  document.getElementById('retake').onclick = () => resetSelection();
  document.getElementById('analyze').onclick = () => {
    if (!current || current.w < 8 || current.h < 8) return;
    send({ type: 'select', x: current.x, y: current.y, width: current.w, height: current.h, previewDataUrl: null });
  };
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') send({ type: 'cancel' }); });
  window.addEventListener('mousedown', (e) => {
    if (!selecting) return;
    start = { x: e.clientX, y: e.clientY };
    current = { x: e.clientX, y: e.clientY, w: 0, h: 0 };
    box.style.display = 'block'; actions.style.display = 'none'; hint.style.display = 'none';
  });
  window.addEventListener('mousemove', (e) => {
    if (!selecting || !start) return;
    const x = Math.min(start.x, e.clientX);
    const y = Math.min(start.y, e.clientY);
    const w = Math.abs(e.clientX - start.x);
    const h = Math.abs(e.clientY - start.y);
    current = { x, y, w, h };
    box.style.left = x + 'px'; box.style.top = y + 'px';
    box.style.width = w + 'px'; box.style.height = h + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!selecting || !current) return;
    if (current.w < 8 || current.h < 8) { resetSelection(); return; }
    selecting = false;
    actions.style.display = 'flex';
    actions.style.left = Math.min(window.innerWidth - 320, current.x) + 'px';
    actions.style.top = Math.min(window.innerHeight - 60, current.y + current.h + 12) + 'px';
  });
</script>
</body>
</html>`;
}
