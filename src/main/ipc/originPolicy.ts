/**
 * Pure IPC origin policy (Electron-free for unit tests).
 * Dev: Vite localhost / 127.0.0.1 or file://
 * Prod: file:// only
 */
export function isTrustedIpcOrigin(url: string, isPackaged: boolean): boolean {
  if (!url) {
    return true;
  }
  if (isPackaged) {
    return url.startsWith('file://');
  }
  return (
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url) || url.startsWith('file://')
  );
}
