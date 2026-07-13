import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const VIDEO_EXTENSIONS = new Set([
  ".avi",
  ".flv",
  ".mkv",
  ".mov",
  ".mp4",
  ".ts",
  ".webm",
]);

const DISPLAY_CAPTURE_KINDS = new Set([
  "display_capture",
  "monitor_capture",
  "screen_capture",
]);

function defaultStatePath() {
  const base = process.env.LOCALAPPDATA ?? os.homedir();
  return path.join(base, "obscli", "recording-state.json");
}

/** OBS exposes the directory and filename format as two separate settings. */
export function parseOutputPath(outputPath, cwd = process.cwd()) {
  if (typeof outputPath !== "string" || outputPath.trim() === "") {
    throw new Error("A non-empty output path is required");
  }

  const resolved = path.resolve(cwd, outputPath.trim());
  const parsed = path.parse(resolved);
  const hasVideoExtension = VIDEO_EXTENSIONS.has(parsed.ext.toLowerCase());
  const filename = hasVideoExtension ? parsed.name : parsed.base;

  if (!filename || filename === "." || filename === "..") {
    throw new Error("The output path must include a file name");
  }
  if (filename.includes("%")) {
    throw new Error(
      "The file name cannot contain '%' because OBS treats it as a filename-format token",
    );
  }

  return {
    requestedPath: resolved,
    directory: parsed.dir,
    filename,
    ignoredExtension: hasVideoExtension ? parsed.ext : undefined,
  };
}

export class ObsRecorder {
  #obs;
  #cwd;
  #statePath;

  constructor(
    obs,
    { cwd = process.cwd(), statePath = defaultStatePath() } = {},
  ) {
    this.#obs = obs;
    this.#cwd = cwd;
    this.#statePath = statePath;
  }

  async start(outputPath) {
    const target = parseOutputPath(outputPath, this.#cwd);
    const status = await this.#obs.call("GetRecordStatus");
    if (status.outputActive) {
      throw new Error("OBS is already recording");
    }

    await this.#recoverStaleState();
    const scene = await this.#assertFullScreenDisplayCapture();
    const [{ recordDirectory }, { parameterValue: filenameFormatting }] =
      await Promise.all([
        this.#obs.call("GetRecordDirectory"),
        this.#obs.call("GetProfileParameter", {
          parameterCategory: "Output",
          parameterName: "FilenameFormatting",
        }),
      ]);

    await fs.mkdir(target.directory, { recursive: true });
    await this.#writeState({
      version: 1,
      recordDirectory,
      filenameFormatting,
    });

    try {
      await this.#obs.call("SetRecordDirectory", {
        recordDirectory: target.directory,
      });
      await this.#obs.call("SetProfileParameter", {
        parameterCategory: "Output",
        parameterName: "FilenameFormatting",
        parameterValue: target.filename,
      });
      await this.#obs.call("StartRecord");
    } catch (error) {
      const warnings = await this.#restoreSavedSettings();
      if (warnings.length > 0) {
        error.message += ` (restore also failed: ${warnings.join("; ")})`;
      }
      throw error;
    }

    return {
      sceneName: scene.sceneName,
      displayCapture: scene.displayCapture,
      requestedPath: target.requestedPath,
      filename: target.filename,
      ignoredExtension: target.ignoredExtension,
    };
  }

  async stop() {
    const status = await this.#obs.call("GetRecordStatus");
    if (!status.outputActive) {
      const hadSavedState = Boolean(await this.#readState());
      const warnings = await this.#restoreSavedSettings();
      if (warnings.length > 0) {
        throw new Error(
          `OBS is not currently recording; restoring saved settings failed: ${warnings.join("; ")}`,
        );
      }
      if (hadSavedState) {
        return { alreadyStopped: true, restoreWarnings: [] };
      }
      throw new Error("OBS is not currently recording");
    }

    const stopped = await this.#obs.call("StopRecord");
    await this.#waitUntilStopped();
    const restoreWarnings = await this.#restoreSavedSettings();
    return {
      outputPath: stopped.outputPath,
      restoreWarnings,
    };
  }

  async #waitUntilStopped() {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const status = await this.#obs.call("GetRecordStatus");
      if (!status.outputActive) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("OBS did not finish stopping the recording within 10 seconds");
  }

  async #assertFullScreenDisplayCapture() {
    const { currentProgramSceneName } = await this.#obs.call(
      "GetCurrentProgramScene",
    );
    const { sceneItems } = await this.#obs.call("GetSceneItemList", {
      sceneName: currentProgramSceneName,
    });
    const displayCapture = sceneItems.find(
      (item) =>
        item.sceneItemEnabled && DISPLAY_CAPTURE_KINDS.has(item.inputKind),
    );

    if (!displayCapture) {
      throw new Error(
        `The current OBS scene '${currentProgramSceneName}' has no enabled Display Capture`,
      );
    }

    return {
      sceneName: currentProgramSceneName,
      displayCapture: displayCapture.sourceName,
    };
  }

  async #recoverStaleState() {
    const state = await this.#readState();
    if (!state) return;
    const warnings = await this.#restoreSavedSettings(state);
    if (warnings.length > 0) {
      throw new Error(`Could not recover prior OBS settings: ${warnings.join("; ")}`);
    }
  }

  async #readState() {
    try {
      return JSON.parse(await fs.readFile(this.#statePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return undefined;
      throw error;
    }
  }

  async #writeState(state) {
    await fs.mkdir(path.dirname(this.#statePath), { recursive: true });
    const temporaryPath = `${this.#statePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(state, null, 2), "utf8");
    await fs.rename(temporaryPath, this.#statePath);
  }

  async #restoreSavedSettings(state = undefined) {
    const saved = state ?? (await this.#readState());
    if (!saved) return [];

    const warnings = [];
    try {
      await this.#obs.call("SetRecordDirectory", {
        recordDirectory: saved.recordDirectory,
      });
    } catch (error) {
      warnings.push(`record directory: ${describeError(error)}`);
    }
    try {
      await this.#obs.call("SetProfileParameter", {
        parameterCategory: "Output",
        parameterName: "FilenameFormatting",
        parameterValue: saved.filenameFormatting,
      });
    } catch (error) {
      warnings.push(`filename format: ${describeError(error)}`);
    }

    if (warnings.length === 0) {
      await fs.rm(this.#statePath, { force: true });
    }
    return warnings;
  }
}

function describeError(error) {
  return error?.message || error?.code || String(error) || "unknown OBS error";
}
