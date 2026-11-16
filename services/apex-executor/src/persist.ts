/**
 * Crash-safe snapshot. Write a temp file, fsync it, rename, then fsync the
 * directory when the platform can.
 *
 * Linux and other POSIX hosts: directory fsync is required. Any error from
 * that step throws (fail closed). Durability is "full".
 *
 * Windows (process.platform === "win32"): opening or fsyncing a directory is
 * unsupported. Only EPERM, EISDIR, EBADF, and EINVAL from that step are
 * tolerated, and only on win32. The temp file is still fsynced before rename,
 * but that is file-level durability ("file-only"), not power-loss durability
 * of the rename. Corrupt snapshots and failed temp writes, temp fsyncs, and
 * renames throw on every platform.
 */

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname } from "node:path";

export type DurabilityLevel = "full" | "file-only";

export const FILE_ONLY_DURABILITY_WARNING =
  "Windows file-level fsync only: directory fsync is unsupported, so rename durability across power loss is not guaranteed. Windows is dev/test only; production is a Linux VM with systemd.";

const UNSUPPORTED_DIRECTORY_FSYNC = new Set(["EPERM", "EISDIR", "EBADF", "EINVAL"]);

export interface PersistFs {
  mkdirSync: typeof mkdirSync;
  openSync: typeof openSync;
  writeSync: typeof writeSync;
  fsyncSync: typeof fsyncSync;
  closeSync: typeof closeSync;
  renameSync: typeof renameSync;
}

export interface AtomicWriteOptions {
  fs?: Partial<PersistFs>;
  platform?: NodeJS.Platform;
  warn?: (message: string) => void;
}

const realFs: PersistFs = { mkdirSync, openSync, writeSync, fsyncSync, closeSync, renameSync };

let fileOnlyWarningEmitted = false;

export function directoryFsyncSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "win32";
}

export function durabilityLevel(platform: NodeJS.Platform = process.platform): DurabilityLevel {
  return directoryFsyncSupported(platform) ? "full" : "file-only";
}

/** One-time operator warning. POSIX platforms are silent. */
export function warnFileOnlyDurability(
  warn: (message: string) => void = (message) => console.warn(message),
  platform: NodeJS.Platform = process.platform,
): void {
  if (directoryFsyncSupported(platform) || fileOnlyWarningEmitted) return;
  fileOnlyWarningEmitted = true;
  warn(FILE_ONLY_DURABILITY_WARNING);
}

export function resetDurabilityWarningForTests(): void {
  fileOnlyWarningEmitted = false;
}

function isUnsupportedDirectoryFsyncError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && UNSUPPORTED_DIRECTORY_FSYNC.has(code);
}

function fsyncDirectory(dir: string, platform: NodeJS.Platform, fs: PersistFs, warn: (message: string) => void): void {
  if (platform !== "win32") {
    const dirFd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
    return;
  }

  // Windows cannot fsync a directory. Attempt it anyway so an unexpected
  // error still fails closed, but do not report POSIX rename durability.
  let dirFd: number | undefined;
  try {
    dirFd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(dirFd);
    } catch (error) {
      if (!isUnsupportedDirectoryFsyncError(error)) throw error;
    }
  } catch (error) {
    if (!isUnsupportedDirectoryFsyncError(error)) throw error;
  } finally {
    if (dirFd != null) {
      try {
        fs.closeSync(dirFd);
      } catch (error) {
        if (!isUnsupportedDirectoryFsyncError(error)) throw error;
      }
    }
  }
  warnFileOnlyDurability(warn, platform);
}

export function atomicWrite(path: string, body: string, options: AtomicWriteOptions = {}): void {
  const fs: PersistFs = { ...realFs, ...options.fs };
  const platform = options.platform ?? process.platform;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  fs.mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, body);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, path);
  fsyncDirectory(dirname(path), platform, fs, warn);
}

export function readRequiredJson(path: string): unknown {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("executor state corrupt; fail closed");
  }
  return parsed;
}
