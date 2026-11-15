import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

export interface LockState { pid: number; heartbeat: string; }

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireLock(path: string, pid = process.pid, now = new Date(), alive = isProcessAlive): { acquired: boolean; recovered: boolean; existingPid: number | null } {
  const current = readLock(path);
  if (current && current.pid !== pid && alive(current.pid)) {
    return { acquired: false, recovered: false, existingPid: current.pid };
  }
  const recovered = Boolean(current && current.pid !== pid);
  if (current && current.pid !== pid) {
    try { unlinkSync(path); } catch { /* another process recovered first */ }
  }
  const next: LockState = { pid, heartbeat: now.toISOString() };
  try {
    writeFileSync(path, JSON.stringify(next), { flag: "wx" });
    return { acquired: true, recovered, existingPid: current?.pid ?? null };
  } catch (err) {
    const raced = readLock(path);
    if ((err as NodeJS.ErrnoException).code === "EEXIST" && raced && raced.pid !== pid) {
      return { acquired: false, recovered: false, existingPid: raced.pid };
    }
    throw err;
  }
}

export function touchLock(path: string, pid = process.pid, now = new Date()): void {
  writeFileSync(path, JSON.stringify({ pid, heartbeat: now.toISOString() }));
}

export function releaseLock(path: string, pid = process.pid): void {
  const current = readLock(path);
  if (current?.pid === pid && existsSync(path)) unlinkSync(path);
}

export function readLock(path: string): LockState | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LockState;
    return Number.isInteger(parsed.pid) ? parsed : null;
  } catch {
    return null;
  }
}

export function heartbeatAgeSeconds(iso: string, nowMs = Date.now()): number {
  return (nowMs - Date.parse(iso)) / 1000;
}
