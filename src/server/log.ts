import type { LogEntry } from '../shared/types';

const MAX = 1000;

class Logger {
  private entries: LogEntry[] = [];

  private push(level: LogEntry['level'], msg: string) {
    const entry = { t: Date.now(), level, msg };
    this.entries.push(entry);
    if (this.entries.length > MAX) this.entries.splice(0, this.entries.length - MAX);
    const line = `[${new Date(entry.t).toISOString()}] ${level.toUpperCase().padEnd(5)} ${msg}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }

  info(msg: string) {
    this.push('info', msg);
  }
  warn(msg: string) {
    this.push('warn', msg);
  }
  error(msg: string) {
    this.push('error', msg);
  }
  list(): LogEntry[] {
    return this.entries.slice();
  }
  clear() {
    this.entries = [];
  }
}

export const log = new Logger();

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
