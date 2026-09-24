import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { redactMeta } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  correlationId?: string;
  sessionId?: string;
  meta?: Record<string, unknown>;
}

export interface Logger {
  debug: (event: string, meta?: Record<string, unknown>) => void;
  info: (event: string, meta?: Record<string, unknown>) => void;
  warn: (event: string, meta?: Record<string, unknown>) => void;
  error: (event: string, meta?: Record<string, unknown>) => void;
  child: (bindings: { correlationId?: string; sessionId?: string }) => Logger;
}

const MAX_BYTES = 1_000_000;
const MAX_ROTATED_FILES = 3;

let logDirectory: string | null = null;
let activeLogPath: string | null = null;

export function initializeFileLogging(baseDir = path.join(app.getPath('userData'), 'logs')): void {
  fs.mkdirSync(baseDir, { recursive: true });
  logDirectory = baseDir;
  activeLogPath = path.join(baseDir, 'app.log');
}

function rotateIfNeeded(): void {
  if (!activeLogPath || !logDirectory || !fs.existsSync(activeLogPath)) {
    return;
  }
  const stats = fs.statSync(activeLogPath);
  if (stats.size < MAX_BYTES) {
    return;
  }

  for (let index = MAX_ROTATED_FILES - 1; index >= 1; index -= 1) {
    const from = path.join(logDirectory, `app.${index}.log`);
    const to = path.join(logDirectory, `app.${index + 1}.log`);
    if (fs.existsSync(from)) {
      fs.renameSync(from, to);
    }
  }
  fs.renameSync(activeLogPath, path.join(logDirectory, 'app.1.log'));
}

function appendToFile(entry: LogEntry): void {
  if (!activeLogPath) {
    return;
  }
  try {
    rotateIfNeeded();
    fs.appendFileSync(activeLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Never throw from logging.
  }
}

function write(entry: LogEntry): void {
  const line = JSON.stringify(entry);
  switch (entry.level) {
    case 'error':
      console.error(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    default:
      console.log(line);
  }
  appendToFile(entry);
}

function createLogger(bindings: { correlationId?: string; sessionId?: string } = {}): Logger {
  const log = (level: LogLevel, event: string, meta?: Record<string, unknown>) => {
    write({
      timestamp: new Date().toISOString(),
      level,
      event,
      correlationId: bindings.correlationId,
      sessionId: bindings.sessionId,
      meta: redactMeta(meta),
    });
  };

  return {
    debug: (event, meta) => log('debug', event, meta),
    info: (event, meta) => log('info', event, meta),
    warn: (event, meta) => log('warn', event, meta),
    error: (event, meta) => log('error', event, meta),
    child: (childBindings) =>
      createLogger({
        correlationId: childBindings.correlationId ?? bindings.correlationId,
        sessionId: childBindings.sessionId ?? bindings.sessionId,
      }),
  };
}

export const logger = createLogger();

export function getLogDirectory(): string | null {
  return logDirectory;
}
