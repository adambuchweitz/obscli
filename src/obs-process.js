import { execFile as execFileCallback, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

function executableCandidates({
  platform = process.platform,
  env = process.env,
  homeDirectory = os.homedir(),
} = {}) {
  if (platform === "win32") {
    return [
      env.OBS_EXECUTABLE,
      env.ProgramFiles &&
        path.join(env.ProgramFiles, "obs-studio", "bin", "64bit", "obs64.exe"),
      env["ProgramFiles(x86)"] &&
        path.join(env["ProgramFiles(x86)"], "obs-studio", "bin", "64bit", "obs64.exe"),
      env.LOCALAPPDATA &&
        path.join(
          env.LOCALAPPDATA,
          "Programs",
          "obs-studio",
          "bin",
          "64bit",
          "obs64.exe",
        ),
      env.SCOOP &&
        path.join(
          env.SCOOP,
          "apps",
          "obs-studio",
          "current",
          "bin",
          "64bit",
          "obs64.exe",
        ),
      path.join(
        homeDirectory,
        "scoop",
        "apps",
        "obs-studio",
        "current",
        "bin",
        "64bit",
        "obs64.exe",
      ),
    ].filter(Boolean);
  }

  if (platform === "darwin") {
    return [
      env.OBS_EXECUTABLE,
      "/Applications/OBS.app/Contents/MacOS/OBS",
      path.join(homeDirectory, "Applications", "OBS.app", "Contents", "MacOS", "OBS"),
    ].filter(Boolean);
  }

  return [
    env.OBS_EXECUTABLE,
    "/usr/bin/obs",
    "/usr/local/bin/obs",
    "/snap/bin/obs-studio",
  ].filter(Boolean);
}

function configDirectoryCandidates({
  platform = process.platform,
  env = process.env,
  homeDirectory = os.homedir(),
} = {}) {
  const configuredDirectory =
    env.OBS_WEBSOCKET_CONFIG &&
    path.resolve(path.dirname(env.OBS_WEBSOCKET_CONFIG), "..", "..");

  if (platform === "win32") {
    return [
      env.OBS_CONFIG_DIRECTORY,
      configuredDirectory,
      env.APPDATA && path.join(env.APPDATA, "obs-studio"),
      env.SCOOP &&
        path.join(
          env.SCOOP,
          "persist",
          "obs-studio",
          "config",
          "obs-studio",
        ),
      path.join(
        homeDirectory,
        "scoop",
        "persist",
        "obs-studio",
        "config",
        "obs-studio",
      ),
    ].filter(Boolean);
  }

  if (platform === "darwin") {
    return [
      env.OBS_CONFIG_DIRECTORY,
      configuredDirectory,
      path.join(homeDirectory, "Library", "Application Support", "obs-studio"),
    ].filter(Boolean);
  }

  return [
    env.OBS_CONFIG_DIRECTORY,
    configuredDirectory,
    path.join(homeDirectory, ".config", "obs-studio"),
  ].filter(Boolean);
}

export async function findObsExecutable(options = {}) {
  for (const candidate of executableCandidates(options)) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  throw new Error(
    "OBS Studio is not running and its executable could not be found; set OBS_EXECUTABLE to its full path",
  );
}

export async function isObsRunning({
  platform = process.platform,
  run = execFile,
} = {}) {
  if (platform === "win32") {
    const { stdout } = await run("tasklist.exe", [
      "/FI",
      "IMAGENAME eq obs64.exe",
      "/FO",
      "CSV",
      "/NH",
    ]);
    return /^"obs64\.exe",/imu.test(stdout);
  }

  try {
    const { stdout } = await run("pgrep", [
      "-x",
      platform === "darwin" ? "OBS" : "obs",
    ]);
    return stdout.trim().length > 0;
  } catch (error) {
    if (error.code === 1) return false;
    throw error;
  }
}

export async function clearObsCrashSentinels(options = {}) {
  await Promise.all(
    configDirectoryCandidates(options).map((directory) =>
      fs.rm(path.join(directory, ".sentinel"), {
        recursive: true,
        force: true,
      }),
    ),
  );
}

export async function launchObs(executable, { start = spawn } = {}) {
  const child = start(executable, [], {
    cwd: path.dirname(executable),
    detached: true,
    stdio: "ignore",
  });

  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", resolve);
  });
  child.unref();
}

export async function ensureObsRunning({
  checkRunning = isObsRunning,
  findExecutable = findObsExecutable,
  clearCrashSentinels = clearObsCrashSentinels,
  launch = launchObs,
} = {}) {
  if (await checkRunning()) return { started: false };

  const executable = await findExecutable();
  await clearCrashSentinels();
  await launch(executable);
  return { started: true, executable };
}
