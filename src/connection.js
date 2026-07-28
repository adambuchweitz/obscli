import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import OBSWebSocket from "obs-websocket-js";
import { ensureObsRunning } from "./obs-process.js";

const OBS_STARTUP_TIMEOUT_MS = 30_000;
const OBS_STARTUP_RETRY_MS = 250;

function configCandidates() {
  return [
    process.env.OBS_WEBSOCKET_CONFIG,
    process.env.APPDATA &&
      path.join(
        process.env.APPDATA,
        "obs-studio",
        "plugin_config",
        "obs-websocket",
        "config.json",
      ),
    path.join(
      os.homedir(),
      "scoop",
      "persist",
      "obs-studio",
      "config",
      "obs-studio",
      "plugin_config",
      "obs-websocket",
      "config.json",
    ),
  ].filter(Boolean);
}

async function readObsWebSocketConfig() {
  for (const candidate of configCandidates()) {
    try {
      return JSON.parse(await fs.readFile(candidate, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function connectToObs({
  ensureRunning = ensureObsRunning,
  readConfig = readObsWebSocketConfig,
  createClient = () => new OBSWebSocket(),
  readyCheck = (obs) => obs.call("GetRecordStatus"),
  now = Date.now,
  wait = delay,
  startupTimeout = OBS_STARTUP_TIMEOUT_MS,
  startupRetry = OBS_STARTUP_RETRY_MS,
} = {}) {
  const { started } = await ensureRunning();
  const config = await readConfig();
  if (config && !config.server_enabled) {
    throw new Error("OBS WebSocket is disabled; enable it under Tools > WebSocket Server Settings");
  }

  const port = config?.server_port ?? 4455;
  const url = process.env.OBS_WEBSOCKET_URL ?? `ws://127.0.0.1:${port}`;
  const password = process.env.OBS_WEBSOCKET_PASSWORD ?? config?.server_password;
  if (config?.auth_required && !password) {
    throw new Error(
      "OBS WebSocket requires a password; set OBS_WEBSOCKET_PASSWORD or OBS_WEBSOCKET_CONFIG",
    );
  }

  const deadline = now() + startupTimeout;
  do {
    const obs = createClient();
    try {
      await obs.connect(url, password, { eventSubscriptions: 0 });
      await readyCheck(obs);
      return obs;
    } catch (error) {
      if (!started || now() >= deadline) throw error;
      try {
        await obs.disconnect();
      } catch {
        // The socket may not have connected yet.
      }
    }
    await wait(startupRetry);
  } while (true);
}
