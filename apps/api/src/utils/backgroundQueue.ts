/** Process-wide ingestion queue. Requests enqueue shared work and read cache immediately. */
export class BackgroundQueue {
  private jobs = new Map<string, () => Promise<void>>();
  private active = new Set<string>();
  private cooldown = new Map<string, number>();
  constructor(
    private concurrency = 2,
    private capacity = 96,
    private retryMs = 30_000
  ) {}

  enqueue(key: string, job: () => Promise<void>): boolean {
    if (this.jobs.has(key) || this.active.has(key)) return true;
    if (
      (this.cooldown.get(key) ?? 0) > Date.now() ||
      this.jobs.size + this.active.size >= this.capacity
    )
      return false;
    this.cooldown.delete(key);
    this.jobs.set(key, job);
    this.drain();
    return true;
  }

  private drain() {
    while (this.active.size < this.concurrency && this.jobs.size) {
      const [key, job] = this.jobs.entries().next().value!;
      this.jobs.delete(key);
      this.active.add(key);
      void Promise.resolve()
        .then(job)
        .catch(() => {
          this.cooldown.set(key, Date.now() + this.retryMs);
          while (this.cooldown.size > this.capacity)
            this.cooldown.delete(this.cooldown.keys().next().value!);
        })
        .finally(() => {
          this.active.delete(key);
          this.drain();
        });
    }
  }

  stats() {
    return { queued: this.jobs.size, active: this.active.size, cooling: this.cooldown.size };
  }
}
