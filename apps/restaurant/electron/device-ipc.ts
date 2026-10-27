import {
  approveInputSchema,
  type BridgeResult,
  deviceChannels,
  lockReasonSchema,
  reenableInputSchema,
  registerInputSchema,
  signInInputSchema,
} from './bridge.js';
import type { DeviceService } from './device-service.js';

type Handler = (input: unknown) => Promise<unknown>;

const invalid: BridgeResult = { ok: false, code: 'VALIDATION_FAILED' };

/**
 * The main process's side of `bridge.ts`: one handler per invoked channel, each parsing what the
 * untrusted renderer sent before the service sees it.
 */
export function deviceHandlers(service: DeviceService): Record<string, Handler> {
  return {
    [deviceChannels.status]: async () => service.status(),
    [deviceChannels.register]: async (input) => {
      const parsed = registerInputSchema.safeParse(input);
      return parsed.success ? service.register(parsed.data) : invalid;
    },
    [deviceChannels.signIn]: async (input) => {
      const parsed = signInInputSchema.safeParse(input);
      return parsed.success ? service.signIn(parsed.data) : invalid;
    },
    [deviceChannels.lock]: async (input) => {
      const parsed = lockReasonSchema.safeParse(input);
      await service.lock(parsed.success ? parsed.data : 'locked');
    },
    [deviceChannels.accessToken]: () => service.accessToken(),
    [deviceChannels.refresh]: () => service.refresh(),
    [deviceChannels.approve]: async (input) => {
      const parsed = approveInputSchema.safeParse(input);
      return parsed.success ? service.approve(parsed.data) : invalid;
    },
    [deviceChannels.reenablePin]: async (input) => {
      const parsed = reenableInputSchema.safeParse(input);
      return parsed.success ? service.reenablePin(parsed.data) : invalid;
    },
    [deviceChannels.dismissWipe]: () => service.dismissWipe(),
  };
}
