import { desktopCapturer, type BrowserWindow } from 'electron';
import { logger } from '../../services/logging';

/**
 * Wires documented Electron display-media loopback for Windows Meeting/System Audio.
 * Only grants loopback when the renderer explicitly requests display media (user Start Interview).
 * Does not hide the app, inject into other processes, or bypass sharing/recording controls.
 */
export function registerDisplayMediaLoopbackHandler(mainWindow: BrowserWindow): void {
  if (process.platform !== 'win32') {
    return;
  }

  try {
    mainWindow.webContents.session.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 0, height: 0 },
        });
        const primary = sources[0];
        if (!primary) {
          logger.warn('audio.input.capability', {
            mode: 'meeting_audio',
            supported: false,
            reason: 'no_display_source',
          });
          callback({});
          return;
        }
        logger.info('audio.input.capability', {
          mode: 'meeting_audio',
          supported: true,
          platform: 'windows',
          path: 'display_media_loopback',
        });
        // Electron Windows: audio: 'loopback' is the documented system-audio path.
        callback({ video: primary, audio: 'loopback' });
      } catch (error) {
        logger.warn('audio.input.error', {
          message: error instanceof Error ? error.message : 'display_media_handler_failed',
        });
        callback({});
      }
    });
  } catch (error) {
    logger.warn('audio.input.capability', {
      mode: 'meeting_audio',
      supported: false,
      reason: error instanceof Error ? error.message : 'handler_unavailable',
    });
  }
}
