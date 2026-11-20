const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createHmac } = require("node:crypto");

process.env.LIVEKIT_API_KEY = "test-key";
process.env.LIVEKIT_API_SECRET = "test-secret-for-local-tests-only-123456";
process.env.LIVEKIT_URL = "wss://livekit.example.test";

const app = require("../src/app");
const Token = require("../src/models/token");
let server;
let baseUrl;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
}));

test("health endpoint reports readiness", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("token endpoint returns a signed one-hour token with room permissions", async () => {
  const response = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomName: "demo", participantName: "alice" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ["participantName", "roomName", "serverUrl", "token"]);
  assert.equal(body.serverUrl, process.env.LIVEKIT_URL);
  assert.equal(body.participantName, "alice");
  assert.equal(body.roomName, "demo");
  const [header, payload, signature] = body.token.split(".");
  assert.equal(JSON.parse(Buffer.from(header, "base64url")).alg, "HS256");
  assert.equal(signature, createHmac("sha256", process.env.LIVEKIT_API_SECRET)
    .update(`${header}.${payload}`).digest("base64url"));
  const claims = JSON.parse(Buffer.from(payload, "base64url"));
  assert.equal(claims.iss, "test-key");
  assert.equal(claims.sub, "alice");
  assert.equal(claims.exp - claims.nbf, 3600);
  assert.deepEqual(claims.video, {
    roomJoin: true, room: "demo", canPublish: true,
    canSubscribe: true, canPublishData: true,
  });
});

test("missing fields and absent request body return 400", async () => {
  for (const body of [undefined, {}, { roomName: "demo" }, { participantName: "alice" }]) {
    const response = await fetch(`${baseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "roomName and participantName are required",
    });
  }
});

test("token generation failures return the public error response", async (t) => {
  t.mock.method(Token, "create", async () => { throw new Error("Internal failure"); });
  t.mock.method(console, "error", () => {});
  const response = await fetch(`${baseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomName: "demo", participantName: "alice" }),
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Token generation failed" });
});
