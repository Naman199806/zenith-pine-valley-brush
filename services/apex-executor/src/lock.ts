/**
 * One writer per lock file. O_EXCL creates it. The fd stays open.
 * A second process is refused while the recorded pid is alive, including after
 * this process restarts only if the previous pid is still alive.
 * Recovery renames the file only when that pid is provably dead.
 */

import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";

/**
 * ESRCH is the only code that proves the pid is gone.
 * Windows process.kill(pid, 0) raises EPERM when the process exists but
 * cannot be signaled. EPERM, EINVAL, and a missing code stay "alive" so a
 * lock is never stolen (fail closed).
 */
export function pidAliveFromKillError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code !== "ESRCH";
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return pidAliveFromKillError(error);
  }
}

function readOwner(lockPath: string): number | "unreadable" | "missing" {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown };
    if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 1) return "unreadable";
    return parsed.pid;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    return "unreadable";
  }
}

export function acquireWriterLock(lockPath: string): number {
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid }));
      fsyncSync(fd);
      return fd;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = readOwner(lockPath);
      if (owner === "missing") continue;
      if (owner === "unreadable") throw new Error("lock owner not provably dead; refusing to steal");
      if (isPidAlive(owner)) throw new Error("one active writer already holds this account");
      try {
        renameSync(lockPath, `${lockPath}.dead.${owner}`);
      } catch {
        continue;
      }
    }
  }
  throw new Error("one active writer already holds this account");
}

export function releaseWriterLock(lockPath: string, fd: number | null): void {
  if (fd != null) {
    try {
      closeSync(fd);
    } catch {
      /* already closed */
    }
  }
  if (readOwner(lockPath) === process.pid) unlinkSync(lockPath);
}
