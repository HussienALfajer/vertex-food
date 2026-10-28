/**
 * The hub's writer lock (spec S04 rule 5): every change of the journal and the hub state on a PC
 * runs through it, one at a time and in order. A failed step does not block the next one.
 */
export class WriterLock {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work, work);
    this.tail = next.catch(() => undefined);
    return next;
  }
}
