import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  clearObsCrashSentinels,
  ensureObsRunning,
  isObsRunning,
} from "../src/obs-process.js";

test("ensureObsRunning leaves an existing OBS process alone", async () => {
  let findCalls = 0;
  let launchCalls = 0;

  const result = await ensureObsRunning({
    checkRunning: async () => true,
    findExecutable: async () => {
      findCalls += 1;
    },
    clearCrashSentinels: async () => {
      throw new Error("Crash sentinels should not be touched");
    },
    launch: async () => {
      launchCalls += 1;
    },
  });

  assert.deepEqual(result, { started: false });
  assert.equal(findCalls, 0);
  assert.equal(launchCalls, 0);
});

test("ensureObsRunning launches OBS when it is absent", async () => {
  let clearedSentinels = false;
  const launched = [];
  const result = await ensureObsRunning({
    checkRunning: async () => false,
    findExecutable: async () => "C:\\OBS\\obs64.exe",
    clearCrashSentinels: async () => {
      clearedSentinels = true;
    },
    launch: async (executable) => {
      assert.equal(clearedSentinels, true);
      launched.push(executable);
    },
  });

  assert.deepEqual(result, {
    started: true,
    executable: "C:\\OBS\\obs64.exe",
  });
  assert.deepEqual(launched, ["C:\\OBS\\obs64.exe"]);
});

test("isObsRunning recognizes the Windows OBS process", async () => {
  const running = await isObsRunning({
    platform: "win32",
    run: async () => ({
      stdout: '"obs64.exe","1234","Console","1","100,000 K"\r\n',
    }),
  });

  assert.equal(running, true);
});

test("clearObsCrashSentinels removes only OBS crash markers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "obscli-process-test-"));
  const configDirectory = path.join(root, "obs-studio");
  const sentinelDirectory = path.join(configDirectory, ".sentinel");
  const settingsPath = path.join(configDirectory, "global.ini");
  await fs.mkdir(sentinelDirectory, { recursive: true });
  await fs.writeFile(path.join(sentinelDirectory, "run_123"), "");
  await fs.writeFile(settingsPath, "settings");

  await clearObsCrashSentinels({
    platform: "win32",
    env: { OBS_CONFIG_DIRECTORY: configDirectory },
    homeDirectory: path.join(root, "home"),
  });

  await assert.rejects(fs.access(sentinelDirectory), { code: "ENOENT" });
  assert.equal(await fs.readFile(settingsPath, "utf8"), "settings");
});
