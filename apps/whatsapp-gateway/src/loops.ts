import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { whatsappPolicy } from '@vertex-food/contracts';
import type { Config } from './core/config/config.js';
import { CONFIG } from './core/config/config.module.js';
import { Tasks } from './core/tasks.js';
import { QueueListener } from './sending/queue-listener.js';
import { SendingService } from './sending/sending.service.js';
import { SessionsService } from './sessions/sessions.service.js';
import { SweepService } from './sweep/sweep.service.js';

/** Whether the gateway runs its loops; tests drive each step themselves instead. */
export const RUN_LOOPS = Symbol('RunLoops');

/**
 * The gateway's loops (spec S03, "Jobs"): the lease tick every 10 s, the sender on `NOTIFY` and
 * every 2 s, the sweep every minute. Not pg-boss: the gateway runs on its own. They stop before
 * the sessions close and release their leases.
 */
@Injectable()
export class Loops implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger('Loops');
  private readonly tasks = new Tasks(this.logger);
  private readonly timers: NodeJS.Timeout[] = [];
  private listener: QueueListener | undefined;

  constructor(
    @Inject(RUN_LOOPS) private readonly enabled: boolean,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(SendingService) private readonly sending: SendingService,
    @Inject(SweepService) private readonly sweep: SweepService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.enabled) return;
    const every = (seconds: number, what: string, work: () => Promise<unknown>) =>
      this.timers.push(setInterval(() => this.tasks.run(what, work), seconds * 1000));
    every(whatsappPolicy.lease.renewSeconds, 'Lease tick', () => this.sessions.tick());
    every(whatsappPolicy.claimPollSeconds, 'Claim poll', async () => this.sending.wake());
    every(whatsappPolicy.sweepSeconds, 'Sweep', () => this.sweep.run());
    this.listener = new QueueListener(
      this.config.databaseUrl,
      () => this.sending.wake(),
      this.logger,
    );
    await this.listener.start();
    this.tasks.run('Lease tick', () => this.sessions.tick());
  }

  async beforeApplicationShutdown(): Promise<void> {
    for (const timer of this.timers) clearInterval(timer);
    await this.listener?.stop();
    await this.tasks.settled();
  }
}
