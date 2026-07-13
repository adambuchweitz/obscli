import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import OBSWebSocket from "obs-websocket-js";

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

export async function connectToObs() {
  const config = await readObsWebSocketConfig();
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

  const obs = new OBSWebSocket();
  await obs.connect(url, password, { eventSubscriptions: 0 });
  return obs;
}
