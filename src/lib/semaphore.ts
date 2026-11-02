/**
 * Counting semaphore for bounding concurrent work. FIFO fair: waiters acquire
 * in arrival order.
 */
export class Semaphore {
  private running = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  get depth(): number {
    return this.running;
  }

  async acquire(): Promise<() => void> {
    if (this.running < this.max) {
      this.running += 1;
      return () => this.release();
    }
    // Slot transfers directly from releaser to waiter (running unchanged),
    // so a newcomer can never sneak past the queue and exceed max.
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    return () => this.release();
  }

  private release(): void {
    const next = this.waiters.shift();
    if (!next) this.running -= 1;
    else next();
  }
}
