import path from 'node:path';
import { app } from 'electron';
import { JsonFilePublicConfigStore } from './JsonFilePublicConfigStore';
import { logger } from '../logging';

/**
 * Persists NON-SECRET public configuration under Electron userData.
 * Path: `<userData>/config/public-config.json`
 * Secrets must never be written here.
 */
export class FilePublicConfigStore extends JsonFilePublicConfigStore {
  constructor(baseDir = path.join(app.getPath('userData'), 'config')) {
    super(baseDir, logger);
  }
}
