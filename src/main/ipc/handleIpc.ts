import type { IpcMainInvokeEvent } from 'electron';
import { toSafeErrorPayload } from '../../shared/errors';
import type { IpcResult } from '../../shared/ipc/types';
import { logger } from '../services/logging';
import { assertTrustedIpcSender } from './senderValidation';

export async function handleIpc<T>(
  channel: string,
  event: IpcMainInvokeEvent,
  run: () => Promise<T> | T,
): Promise<IpcResult<T>> {
  try {
    assertTrustedIpcSender(event);
    const data = await run();
    return { ok: true, data };
  } catch (error) {
    const safe = toSafeErrorPayload(error);
    logger.warn('ipc.handler_failed', {
      channel,
      code: safe.code,
      message: safe.message,
    });
    return { ok: false, error: safe };
  }
}
