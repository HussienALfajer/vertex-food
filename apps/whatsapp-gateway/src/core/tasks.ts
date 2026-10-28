import type { Logger } from '@nestjs/common';
import { describeError } from './log/describe-error.js';

/**
 * The work a service started from a transport event or a timer, which nothing awaits: a failure
 * is logged (by name and code only) instead of ending the process, and tests and shutdown wait
 * for all of it to finish (`settled`).
 */
export class Tasks {
  private readonly running = new Set<Promise<void>>();

  constructor(private readonly logger: Logger) {}

  /** Runs `work`; `what` names it in the log with ids and codes only, never data. */
  run(what: string, work: () => Promise<unknown>): void {
    const task = (async () => {
      try {
        await work();
      } catch (error) {
        this.logger.error(`${what} failed: ${describeError(error)}`);
      }
    })();
    this.running.add(task);
    void task.finally(() => this.running.delete(task));
  }

  /** Resolves once every task, including those started meanwhile, has finished. */
  async settled(): Promise<void> {
    while (this.running.size > 0) await Promise.all(this.running);
  }
}
