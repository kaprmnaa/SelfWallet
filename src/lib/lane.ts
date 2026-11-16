const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Pembatas permintaan per penyedia: maksimal `max` permintaan serentak dan jeda minimal `gapMs`
 * antar permintaan. API publik seperti mempool.space membatasi laju (sekitar 10 permintaan/detik)
 * dan menjawab 429; tanpa pembatas, pemindaian puluhan alamat langsung terkena batas itu.
 */
export class Lane {
  private active = 0;
  private waiters: (() => void)[] = [];
  private nextAt = 0;

  constructor(
    private readonly max: number,
    private readonly gapMs: number,
  ) {}

  private async acquire() {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((r) => this.waiters.push(r)); // slot diserahkan oleh release()
  }

  private release() {
    const w = this.waiters.shift();
    if (w) w();
    else this.active--;
  }

  /** Tahan semua permintaan berikutnya selama `ms` (mis. setelah 429). */
  pause(ms: number) {
    this.nextAt = Math.max(this.nextAt, Date.now() + ms);
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      const now = Date.now();
      const start = Math.max(now, this.nextAt);
      this.nextAt = start + this.gapMs;
      if (start > now) await sleep(start - now);
      return await fn();
    } finally {
      this.release();
    }
  }
}
