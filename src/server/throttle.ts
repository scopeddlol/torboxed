// A shared token bucket. Every download stream takes tokens before writing a
// chunk, so the combined throughput of all downloads stays under the limit.

export class Throttle {
  private rate = 0; // bytes per second, 0 = unlimited
  private tokens = 0;
  private last = Date.now();

  setRate(bytesPerSec: number) {
    const next = Math.max(0, Math.floor(bytesPerSec));
    if (next === this.rate) return;
    this.rate = next;
    this.tokens = 0;
    this.last = Date.now();
  }

  get limit() {
    return this.rate;
  }

  private refill() {
    const now = Date.now();
    const burst = Math.max(this.rate / 4, 64 * 1024);
    this.tokens = Math.min(burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
  }

  async take(n: number, signal?: AbortSignal): Promise<void> {
    if (!this.rate) return;
    this.refill();
    this.tokens -= n;
    if (this.tokens >= 0) return;
    const waitMs = (-this.tokens / this.rate) * 1000;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, Math.min(waitMs, 5000));
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(signal.reason ?? new Error('aborted'));
        },
        { once: true },
      );
    });
  }
}
