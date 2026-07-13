import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ObsRecorder, parseOutputPath } from "../src/obs-recorder.js";

test("parseOutputPath resolves a relative name and lets OBS choose the extension", () => {
  const target = parseOutputPath("recordings/demo.mp4", "C:\\workspace");
  assert.equal(target.directory, "C:\\workspace\\recordings");
  assert.equal(target.filename, "demo");
  assert.equal(target.ignoredExtension, ".mp4");
});

test("separate start and stop instances restore the saved OBS settings", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "obscli-test-"));
  const statePath = path.join(root, "state.json");
  const calls = [];
  const responses = {
    GetRecordStatus: [
      { outputActive: false },
      { outputActive: true },
      { outputActive: false },
    ],
    GetCurrentProgramScene: [{ currentProgramSceneName: "Screen" }],
    GetSceneItemList: [{ sceneItems: [{
      sourceName: "Display Capture",
      inputKind: "monitor_capture",
      sceneItemEnabled: true,
    }] }],
    GetRecordDirectory: [{ recordDirectory: "C:\\Users\\me\\Videos" }],
    GetProfileParameter: [{ parameterValue: "%CCYY-%MM-%DD %hh-%mm-%ss" }],
    SetRecordDirectory: [{}, {}],
    SetProfileParameter: [{}, {}],
    StartRecord: [{}],
    StopRecord: [{ outputPath: path.join(root, "demo.mkv") }],
  };
  const obs = {
    async call(type, data) {
      calls.push([type, data]);
      const queue = responses[type];
      if (!queue?.length) throw new Error(`Unexpected call: ${type}`);
      return queue.shift();
    },
  };

  const started = await new ObsRecorder(obs, { cwd: root, statePath }).start(
    "captures/demo",
  );
  assert.equal(started.filename, "demo");
  await fs.access(statePath);

  const stopped = await new ObsRecorder(obs, { cwd: root, statePath }).stop();
  assert.equal(stopped.outputPath, path.join(root, "demo.mkv"));
  assert.deepEqual(stopped.restoreWarnings, []);
  await assert.rejects(fs.access(statePath), { code: "ENOENT" });
  assert.deepEqual(calls.at(-2), ["SetRecordDirectory", {
    recordDirectory: "C:\\Users\\me\\Videos",
  }]);
  assert.deepEqual(calls.at(-1), ["SetProfileParameter", {
    parameterCategory: "Output",
    parameterName: "FilenameFormatting",
    parameterValue: "%CCYY-%MM-%DD %hh-%mm-%ss",
  }]);
});

test("start refuses a scene without an enabled Display Capture", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "obscli-test-"));
  const obs = {
    async call(type) {
      if (type === "GetRecordStatus") return { outputActive: false };
      if (type === "GetCurrentProgramScene") {
        return { currentProgramSceneName: "Camera" };
      }
      if (type === "GetSceneItemList") return { sceneItems: [] };
      throw new Error(`Unexpected call: ${type}`);
    },
  };

  await assert.rejects(
    new ObsRecorder(obs, { statePath: path.join(root, "state.json") }).start("demo"),
    /no enabled Display Capture/,
  );
});
