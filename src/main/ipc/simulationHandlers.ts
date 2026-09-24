import { IpcChannels } from '../../shared/ipc/channels';
import { getAppServices } from '../services/appContext';
import { handleIpc } from './handleIpc';
import { registerIpcHandle } from './registerIpcHandle';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors';

const SimulationConfigPatchSchema = z
  .object({
    autoAdvance: z.boolean().optional(),
    questionDelayMs: z.number().int().min(0).max(60_000).optional(),
    answerDisplayDelayMs: z.number().int().min(0).max(60_000).optional(),
    chunkDelayMs: z.number().int().min(5).max(200).optional(),
  })
  .strict();

export function registerSimulationIpcHandlers(): void {
  registerIpcHandle(IpcChannels.SIMULATION_GET_STATUS, (event) =>
    handleIpc(IpcChannels.SIMULATION_GET_STATUS, event, () =>
      getAppServices().simulation.getStatus(),
    ),
  );

  registerIpcHandle(IpcChannels.SIMULATION_START, (event) =>
    handleIpc(IpcChannels.SIMULATION_START, event, () => getAppServices().simulation.start()),
  );

  registerIpcHandle(IpcChannels.SIMULATION_PAUSE, (event) =>
    handleIpc(IpcChannels.SIMULATION_PAUSE, event, () => getAppServices().simulation.pause()),
  );

  registerIpcHandle(IpcChannels.SIMULATION_RESUME, (event) =>
    handleIpc(IpcChannels.SIMULATION_RESUME, event, () => getAppServices().simulation.resume()),
  );

  registerIpcHandle(IpcChannels.SIMULATION_NEXT, (event) =>
    handleIpc(IpcChannels.SIMULATION_NEXT, event, () => getAppServices().simulation.next()),
  );

  registerIpcHandle(IpcChannels.SIMULATION_RESTART, (event) =>
    handleIpc(IpcChannels.SIMULATION_RESTART, event, () => getAppServices().simulation.restart()),
  );

  registerIpcHandle(IpcChannels.SIMULATION_END, (event) =>
    handleIpc(IpcChannels.SIMULATION_END, event, () => getAppServices().simulation.end()),
  );

  registerIpcHandle(IpcChannels.SIMULATION_UPDATE_CONFIG, (event, payload: unknown) =>
    handleIpc(IpcChannels.SIMULATION_UPDATE_CONFIG, event, () => {
      const parsed = SimulationConfigPatchSchema.safeParse(payload ?? {});
      if (!parsed.success) {
        throw new ValidationError('Invalid simulation config');
      }
      return getAppServices().simulation.updateConfig(parsed.data);
    }),
  );
}
