import assert from "node:assert/strict";
import { closeSync, fsyncSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  atomicWrite,
  directoryFsyncSupported,
  durabilityLevel,
  FILE_ONLY_DURABILITY_WARNING,
  readRequiredJson,
  resetDurabilityWarningForTests,
} from "../src/persist.ts";

const WINDOWS_DIRECTORY_CODES = ["EPERM", "EISDIR", "EBADF", "EINVAL"] as const;
const OTHER_DIRECTORY_CODES = ["EIO", "ENOSPC", "ENOENT"] as const;

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

type Stage = "write" | "file-fsync" | "rename" | "dir-open" | "dir-fsync";

function instrumented(options: { fail?: { stage: Stage; code: string }; order?: string[] }) {
  const dirFds = new Set<number>();
  let next = 1_000_000;
  const note = (stage: string) => options.order?.push(stage);
  const maybeFail = (stage: Stage) => {
    if (options.fail?.stage === stage) throw errno(options.fail.code);
  };
  return {
    openSync(path: string, flags?: string | number) {
      if (flags === "r") {
        note("dir-open");
        maybeFail("dir-open");
        const fd = next++;
        dirFds.add(fd);
        return fd;
      }
      note("file-open");
      return openSync(path, flags);
    },
    writeSync(fd: number, body: string) {
      note("write");
      maybeFail("write");
      return writeSync(fd, body);
    },
    fsyncSync(fd: number) {
      if (dirFds.has(fd)) {
        note("dir-fsync");
        maybeFail("dir-fsync");
        return;
      }
      note("file-fsync");
      maybeFail("file-fsync");
      fsyncSync(fd);
    },
    closeSync(fd: number) {
      if (dirFds.has(fd)) {
        note("dir-close");
        dirFds.delete(fd);
        return;
      }
      note("file-close");
      closeSync(fd);
    },
    renameSync(from: string, to: string) {
      note("rename");
      maybeFail("rename");
      renameSync(from, to);
    },
  };
}

test("real atomic write roundtrips and a corrupt snapshot is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "persist-real-"));
  const path = join(dir, "state.json");
  try {
    assert.equal(readRequiredJson(path), null);
    atomicWrite(path, JSON.stringify({ ok: true }));
    assert.deepEqual(readRequiredJson(path), { ok: true });
    writeFileSync(path, "{");
    assert.throws(() => readRequiredJson(path), /executor state corrupt; fail closed/);
    assert.equal(readFileSync(path, "utf8"), "{");
    assert.equal(directoryFsyncSupported(), process.platform !== "win32");
    assert.equal(durabilityLevel(), process.platform === "win32" ? "file-only" : "full");
    assert.equal(directoryFsyncSupported("linux"), true);
    assert.equal(directoryFsyncSupported("darwin"), true);
    assert.equal(directoryFsyncSupported("win32"), false);
    assert.equal(durabilityLevel("linux"), "full");
    assert.equal(durabilityLevel("win32"), "file-only");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("temp file fsync happens before rename on linux and windows", () => {
  const dir = mkdtempSync(join(tmpdir(), "persist-order-"));
  try {
    for (const platform of ["linux", "win32"] as const) {
      const order: string[] = [];
      atomicWrite(join(dir, `${platform}.json`), JSON.stringify({ ok: true }), {
        platform,
        warn: () => {},
        fs: instrumented({ order }),
      });
      assert.ok(order.indexOf("file-fsync") >= 0);
      assert.ok(order.indexOf("file-fsync") < order.indexOf("rename"));
      assert.ok(order.indexOf("rename") < order.indexOf("dir-fsync"));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("temp write, temp fsync, and rename failures throw on every platform", () => {
  const dir = mkdtempSync(join(tmpdir(), "persist-fail-"));
  try {
    for (const platform of ["linux", "win32"] as const) {
      for (const stage of ["write", "file-fsync", "rename"] as const) {
        const code = stage === "rename" ? "EPERM" : "EIO";
        const order: string[] = [];
        assert.throws(
          () => atomicWrite(join(dir, `${platform}-${stage}.json`), "x", {
            platform,
            warn: () => {},
            fs: instrumented({ order, fail: { stage, code } }),
          }),
          (error: unknown) => (error as NodeJS.ErrnoException).code === code,
        );
        if (stage !== "rename") assert.equal(order.includes("rename"), false);
        assert.equal(order.includes("dir-fsync"), false);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("directory fsync errors fail closed when the platform is not win32", () => {
  const dir = mkdtempSync(join(tmpdir(), "persist-posix-"));
  const path = join(dir, "state.json");
  try {
    for (const code of [...WINDOWS_DIRECTORY_CODES, ...OTHER_DIRECTORY_CODES]) {
      for (const stage of ["dir-open", "dir-fsync"] as const) {
        assert.throws(
          () => atomicWrite(path, "posix", {
            platform: "linux",
            warn: () => {},
            fs: instrumented({ fail: { stage, code } }),
          }),
          (error: unknown) => (error as NodeJS.ErrnoException).code === code,
          `linux ${stage} ${code}`,
        );
        assert.throws(
          () => atomicWrite(path, "posix", {
            platform: "darwin",
            warn: () => {},
            fs: instrumented({ fail: { stage, code } }),
          }),
          (error: unknown) => (error as NodeJS.ErrnoException).code === code,
          `darwin ${stage} ${code}`,
        );
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("windows tolerates only unsupported directory fsync errors and stays file-only", () => {
  const dir = mkdtempSync(join(tmpdir(), "persist-win-"));
  const path = join(dir, "state.json");
  try {
    resetDurabilityWarningForTests();
    const notes: string[] = [];
    const warn = (message: string) => notes.push(message);
    for (const code of WINDOWS_DIRECTORY_CODES) {
      for (const stage of ["dir-open", "dir-fsync"] as const) {
        atomicWrite(path, JSON.stringify({ code, stage }), {
          platform: "win32",
          warn,
          fs: instrumented({ fail: { stage, code } }),
        });
        assert.deepEqual(readRequiredJson(path), { code, stage });
      }
    }
    assert.equal(notes.length, 1);
    assert.equal(notes[0], FILE_ONLY_DURABILITY_WARNING);
    atomicWrite(path, JSON.stringify({ again: true }), {
      platform: "win32",
      warn,
      fs: instrumented({}),
    });
    assert.equal(notes.length, 1);
    assert.equal(durabilityLevel("win32"), "file-only");
    assert.equal(directoryFsyncSupported("win32"), false);
    for (const code of OTHER_DIRECTORY_CODES) {
      for (const stage of ["dir-open", "dir-fsync"] as const) {
        assert.throws(
          () => atomicWrite(path, "nope", {
            platform: "win32",
            warn,
            fs: instrumented({ fail: { stage, code } }),
          }),
          (error: unknown) => (error as NodeJS.ErrnoException).code === code,
          `win32 ${stage} ${code}`,
        );
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
