# obscli

A tiny CLI with exactly two operations:

```powershell
obscli start <name-or-path>
obscli stop
```

`start` verifies that OBS's current scene has an enabled Display Capture, sets
the requested directory and base filename, and starts recording. `stop` stops
the recording, prints the exact saved path reported by OBS, and restores the
previous OBS directory and filename format.

OBS controls the video container. For example, if you request `demo.mp4` while
OBS is configured for MKV, OBS saves `demo.mkv`.

## Install

```powershell
npm install
npm link
```

`obscli` starts OBS Studio automatically when it is not already running and
waits for it to accept commands. Automated launches clear OBS's stale crash
sentinels so an earlier unclean shutdown cannot leave startup blocked on the
safe-mode prompt. OBS must have **Tools > WebSocket Server Settings > Enable
WebSocket server** turned on. `obscli` discovers the executable, password, and
port from a standard or Scoop OBS installation. You can override discovery
with:

```powershell
$env:OBS_EXECUTABLE = "C:\path\to\obs64.exe"
$env:OBS_WEBSOCKET_URL = "ws://127.0.0.1:4455"
$env:OBS_WEBSOCKET_PASSWORD = "your-password"
```

## Use

```powershell
obscli start demo
obscli start recordings/demo
obscli start "C:\Users\me\Videos\demo"
obscli stop
```

Relative paths are resolved from the current directory. The target directory
is created if needed.

The commands run as separate processes. To restore the prior OBS output
settings reliably, `start` stores only those settings (never the password) in
`%LOCALAPPDATA%\obscli\recording-state.json`; `stop` removes that file after a
successful restore.

## Verify

```powershell
npm test
obscli --help
```

Protocol reference: [obs-websocket 5.x](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md).
