import type { HubHello } from '@vertex-food/contracts';

// Hub discovery (spec S04 rule 30): a client asks every hub-capable PC of its pairing
// (`GET /hub/hello`) and follows the one that says it is the hub with the highest epoch. A client
// never becomes a hub itself (ADR 0035).

export type HelloAnswer = { address: string; hello: HubHello };

/** The PC to send commands to, or null while none answers as the hub. */
export function chooseHub(answers: readonly HelloAnswer[]): HelloAnswer | null {
  let best: HelloAnswer | null = null;
  for (const answer of answers) {
    if (answer.hello.role !== 'hub') continue;
    if (
      !best ||
      answer.hello.epoch > best.hello.epoch ||
      (answer.hello.epoch === best.hello.epoch && answer.hello.deviceId < best.hello.deviceId)
    ) {
      best = answer;
    }
  }
  return best;
}
