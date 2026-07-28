import assert from "node:assert/strict";
import test from "node:test";
import { connectToObs } from "../src/connection.js";

test("connectToObs retries while a newly launched OBS instance starts", async () => {
  let attempts = 0;
  let clock = 0;
  const clients = [];

  const obs = await connectToObs({
    ensureRunning: async () => ({ started: true }),
    readConfig: async () => undefined,
    createClient: () => {
      const client = {
        async connect() {
          attempts += 1;
        },
        async call() {
          if (attempts < 3) throw new Error("OBS is not ready");
        },
        async disconnect() {},
      };
      clients.push(client);
      return client;
    },
    now: () => clock,
    wait: async (milliseconds) => {
      clock += milliseconds;
    },
    startupTimeout: 1_000,
    startupRetry: 100,
  });

  assert.equal(attempts, 3);
  assert.equal(obs, clients.at(-1));
});

test("connectToObs does not retry a connection failure when OBS was already running", async () => {
  let attempts = 0;

  await assert.rejects(
    connectToObs({
      ensureRunning: async () => ({ started: false }),
      readConfig: async () => undefined,
      createClient: () => ({
        async connect() {
          attempts += 1;
          throw new Error("WebSocket disabled");
        },
        async call() {},
      }),
    }),
    /WebSocket disabled/,
  );

  assert.equal(attempts, 1);
});
