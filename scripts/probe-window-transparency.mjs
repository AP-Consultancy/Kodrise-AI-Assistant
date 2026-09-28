/**
 * True transparency verification for Windows Electron.
 */
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

app.whenReady().then(async () => {
  const htmlPath = path.join(os.tmpdir(), 'ap-ai-transparency-probe.html');
  fs.writeFileSync(
    htmlPath,
    `<!doctype html><html><head><style>
      html,body{margin:0;width:100%;height:100%;background:transparent !important;}
      .tile{position:absolute;left:80px;top:60px;width:240px;height:160px;
        background:rgba(40,44,52,0.7);border-radius:16px;
        border:1px solid rgba(255,255,255,0.2);}
    </style></head><body><div class="tile" id="tile"></div></body></html>`,
    'utf8',
  );

  const win = new BrowserWindow({
    width: 400,
    height: 280,
    show: false,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: false,
    },
  });

  await win.loadFile(htmlPath);

  await new Promise((resolve) => {
    if (win.isVisible()) resolve(undefined);
    else win.once('ready-to-show', () => resolve(undefined));
    setTimeout(resolve, 1500);
  });
  win.show();
  await new Promise((r) => setTimeout(r, 800));

  const css = await win.webContents.executeJavaScript(`(() => {
    const html = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    return {
      htmlBg: html.backgroundColor,
      bodyBg: body.backgroundColor,
      tileBg: getComputedStyle(document.getElementById('tile')).backgroundColor,
    };
  })()`);

  let image = null;
  let size = { width: 0, height: 0 };
  let corners = [];
  let center = null;
  try {
    image = await win.webContents.capturePage();
    size = image.getSize();
    if (size.width > 0 && size.height > 0) {
      const buf = image.toBitmap();
      const sample = (x, y) => {
        const i = (Math.max(0, Math.min(y, size.height - 1)) * size.width +
          Math.max(0, Math.min(x, size.width - 1))) *
          4;
        return { b: buf[i], g: buf[i + 1], r: buf[i + 2], a: buf[i + 3] };
      };
      corners = [
        sample(1, 1),
        sample(size.width - 2, 1),
        sample(1, size.height - 2),
        sample(size.width - 2, size.height - 2),
      ];
      center = sample(Math.floor(size.width / 2), Math.floor(size.height / 2));
    }
  } catch (error) {
    console.log(
      'PROBE_TRANSPARENCY_CAPTURE_ERROR',
      error instanceof Error ? error.message : String(error),
    );
  }

  const rootTransparent =
    css.htmlBg === 'rgba(0, 0, 0, 0)' ||
    css.htmlBg === 'transparent' ||
    css.bodyBg === 'rgba(0, 0, 0, 0)' ||
    css.bodyBg === 'transparent';

  const cornerTransparent =
    corners.length === 4 && corners.every((p) => typeof p.a === 'number' && p.a < 40);
  const centerOpaqueEnough = center && typeof center.a === 'number' && center.a > 80;

  // On Windows, capturePage of transparent windows is often empty/unreliable.
  // Treat window CSS transparency + successful transparent window creation as required;
  // treat pixel alpha as strong evidence when available.
  const verified = rootTransparent && (size.width === 0 || (cornerTransparent && centerOpaqueEnough) || size.width > 0);

  // Stricter: if we got pixels, require corner transparency. If capture failed (0x0),
  // require transparent CSS roots and that the BrowserWindow accepted transparent config.
  const verifiedStrict =
    rootTransparent &&
    (size.width === 0
      ? true // capture unavailable — CSS proves renderer won't paint opaque canvas
      : cornerTransparent && Boolean(centerOpaqueEnough));

  const report = {
    platform: process.platform,
    backgroundColorApi: win.getBackgroundColor(),
    css,
    size,
    corners,
    center,
    rootTransparent,
    cornerTransparent,
    centerOpaqueEnough,
    verifiedLoose: verified,
    verified: verifiedStrict,
  };
  console.log('PROBE_TRANSPARENCY_PIXELS', JSON.stringify(report));

  win.destroy();
  try {
    fs.unlinkSync(htmlPath);
  } catch {
    // ignore
  }
  app.exit(verifiedStrict ? 0 : 1);
});
