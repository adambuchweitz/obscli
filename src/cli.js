#!/usr/bin/env node

import { connectToObs } from "./connection.js";
import { ObsRecorder } from "./obs-recorder.js";

function usage() {
  return `Usage:
  obscli start <name-or-path>
  obscli stop

Examples:
  obscli start demo
  obscli start recordings/demo
  obscli start "C:\\Users\\me\\Videos\\demo"`;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }
  if (command !== "start" && command !== "stop") {
    throw new Error(usage());
  }
  if (command === "start" && args.length !== 1) {
    throw new Error(`start requires exactly one name or path\n\n${usage()}`);
  }
  if (command === "stop" && args.length !== 0) {
    throw new Error(`stop takes no arguments\n\n${usage()}`);
  }

  const obs = await connectToObs();
  try {
    const recorder = new ObsRecorder(obs);
    if (command === "start") {
      const result = await recorder.start(args[0]);
      const extension = result.ignoredExtension
        ? ` (OBS chooses the actual extension; ${result.ignoredExtension} was not forced)`
        : " (OBS will append its configured video extension)";
      console.log(
        `Recording started: ${result.requestedPath}${extension}\nScene: ${result.sceneName}; source: ${result.displayCapture}`,
      );
    } else {
      const result = await recorder.stop();
      if (result.alreadyStopped) {
        console.log("OBS was already stopped; prior output settings restored");
      } else {
        console.log(`Recording saved: ${result.outputPath}`);
      }
      for (const warning of result.restoreWarnings) {
        console.error(`Warning: could not restore OBS ${warning}`);
      }
    }
  } finally {
    await obs.disconnect();
  }
}

main().catch((error) => {
  console.error(`obscli: ${error.message}`);
  process.exitCode = 1;
});
