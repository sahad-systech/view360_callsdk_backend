const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const app = require("../src/app");
const User = require("../src/models/user");
const Call = require("../src/models/call");
const Token = require("../src/models/token");
const authenticate = require("../src/middleware/auth");
const callController = require("../src/controllers/callController");

const net = require("node:net");

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

function dispatchApp({ method, url, headers = {}, body = null }) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const req = new http.IncomingMessage(socket);
    req.method = method;
    req.url = url;

    const payload = body !== null ? JSON.stringify(body) : null;
    req.headers = {
      "content-type": "application/json",
      ...(payload !== null ? { "content-length": String(Buffer.byteLength(payload)) } : {}),
      ...headers,
    };

    const res = new http.ServerResponse(req);
    let rawBody = "";
    res.write = (chunk) => {
      if (chunk) rawBody += chunk;
      return true;
    };
    res.end = (chunk) => {
      if (chunk) rawBody += chunk;
      let parsed = null;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        parsed = rawBody;
      }
      resolve({ statusCode: res.statusCode, body: parsed });
    };

    process.nextTick(() => {
      if (payload !== null) {
        req.push(payload);
      }
      req.push(null);
    });

    app.handle(req, res);
  });
}

test("Auth middleware rejects missing authentication with 401", async () => {
  const req = { headers: {} };
  const res = createMockRes();
  let nextCalled = false;

  await authenticate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
});

test("Auth middleware rejects non-existent user with 401", async (t) => {
  t.mock.method(User, "findById", async () => null);

  const req = { headers: { authorization: "Bearer invalid-user-id" } };
  const res = createMockRes();
  let nextCalled = false;

  await authenticate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Unauthorized: User not found");
});

test("Auth middleware authenticates valid user via Bearer token", async (t) => {
  const mockUser = { id: "caller-uuid-1", name: "Alice", email: "alice@example.com" };
  t.mock.method(User, "findById", async (id) => (id === "caller-uuid-1" ? mockUser : null));

  const req = { headers: { authorization: "Bearer caller-uuid-1" } };
  const res = createMockRes();
  let nextCalled = false;

  await authenticate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.user, mockUser);
});

test("Auth middleware authenticates valid user via JWT Bearer token", async (t) => {
  const mockUser = { id: "caller-uuid-jwt", name: "Bob" };
  t.mock.method(User, "findById", async (id) => (id === "caller-uuid-jwt" ? mockUser : null));

  const payload = Buffer.from(JSON.stringify({ sub: "caller-uuid-jwt" })).toString("base64url");
  const jwt = `header.${payload}.signature`;

  const req = { headers: { authorization: `Bearer ${jwt}` } };
  const res = createMockRes();
  let nextCalled = false;

  await authenticate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.user, mockUser);
});

test("Auth middleware authenticates valid user via x-user-id header", async (t) => {
  const mockUser = { id: "caller-uuid-2", name: "Charlie" };
  t.mock.method(User, "findById", async (id) => (id === "caller-uuid-2" ? mockUser : null));

  const req = { headers: { "x-user-id": "caller-uuid-2" } };
  const res = createMockRes();
  let nextCalled = false;

  await authenticate(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.user, mockUser);
});

test("Initiate Call fails with 401 if request has no authenticated user", async () => {
  const req = { user: null, body: { receiverId: "receiver-uuid" } };
  const res = createMockRes();

  await callController.initiate(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
});

test("Initiate Call fails with 400 when receiverId is missing or empty", async () => {
  for (const invalidReceiver of [undefined, null, "", "   "]) {
    const req = { user: { id: "caller-uuid" }, body: { receiverId: invalidReceiver } };
    const res = createMockRes();

    await callController.initiate(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "receiverId is required");
  }
});

test("Initiate Call fails with 400 when calling yourself", async () => {
  const req = { user: { id: "user-123" }, body: { receiverId: "user-123" } };
  const res = createMockRes();

  await callController.initiate(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "You cannot call yourself");
});

test("Initiate Call fails with 404 when receiver does not exist", async (t) => {
  t.mock.method(User, "findById", async () => null);

  const req = { user: { id: "caller-uuid" }, body: { receiverId: "nonexistent-user" } };
  const res = createMockRes();

  await callController.initiate(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Receiver not found");
});

test("Initiate Call fails with 500 when database insertion fails", async (t) => {
  t.mock.method(User, "findById", async () => ({ id: "receiver-uuid", name: "Receiver" }));
  t.mock.method(Call, "create", async () => {
    throw new Error("DB connection lost");
  });
  t.mock.method(console, "error", () => {});

  const req = { user: { id: "caller-uuid" }, body: { receiverId: "receiver-uuid" } };
  const res = createMockRes();

  await callController.initiate(req, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.success, false);
});

test("Initiate Call succeeds with 200 and inserts ringing call with unique room name", async (t) => {
  t.mock.method(User, "findById", async () => ({ id: "receiver-uuid", name: "Receiver" }));

  let callCreatedWith = null;
  t.mock.method(Call, "create", async (data) => {
    callCreatedWith = data;
    return {
      callId: data.id,
      callerId: data.callerId,
      receiverId: data.receiverId,
      roomName: data.roomName,
      status: data.status,
    };
  });

  const req = {
    user: { id: "caller-uuid" },
    body: { receiverId: "receiver-uuid", callerId: "should-be-ignored-untrusted-caller" },
  };
  const res = createMockRes();

  await callController.initiate(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, "Call initiated successfully");
  assert.equal(res.body.data.callerId, "caller-uuid"); // Not the untrusted callerId in body
  assert.equal(res.body.data.receiverId, "receiver-uuid");
  assert.equal(res.body.data.status, "ringing");
  assert.equal(res.body.data.roomName, `call-${res.body.data.callId}`);

  assert.equal(callCreatedWith.callerId, "caller-uuid");
  assert.equal(callCreatedWith.receiverId, "receiver-uuid");
  assert.equal(callCreatedWith.status, "ringing");
  assert.equal(callCreatedWith.roomName, `call-${callCreatedWith.id}`);
});

test("End-to-end Express route POST /api/calls/initiate responds through app pipeline", async (t) => {
  const callerUser = { id: "caller-e2e-id", name: "Caller User" };
  const receiverUser = { id: "receiver-e2e-id", name: "Receiver User" };

  t.mock.method(User, "findById", async (id) => {
    if (id === "caller-e2e-id") return callerUser;
    if (id === "receiver-e2e-id") return receiverUser;
    return null;
  });

  t.mock.method(Call, "create", async (data) => ({
    callId: data.id,
    callerId: data.callerId,
    receiverId: data.receiverId,
    roomName: data.roomName,
    status: data.status,
  }));

  const response = await dispatchApp({
    method: "POST",
    url: "/api/calls/initiate",
    headers: {
      authorization: "Bearer caller-e2e-id",
    },
    body: {
      receiverId: "receiver-e2e-id",
      callerId: "malicious-hacker-id",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.message, "Call initiated successfully");
  assert.equal(response.body.data.callerId, "caller-e2e-id");
  assert.equal(response.body.data.receiverId, "receiver-e2e-id");
  assert.equal(response.body.data.status, "ringing");
  assert.match(response.body.data.roomName, /^call-[0-9a-f-]+$/);
});

test("Accept Call fails with 401 if request has no authenticated user", async () => {
  const req = { user: null, body: { callId: "some-call-id" } };
  const res = createMockRes();

  await callController.accept(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
});

test("Accept Call fails with 400 when callId is missing or empty", async () => {
  for (const invalidCallId of [undefined, null, "", "   "]) {
    const req = { user: { id: "receiver-uuid" }, body: { callId: invalidCallId } };
    const res = createMockRes();

    await callController.accept(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "callId is required");
  }
});

test("Accept Call fails with 404 when call does not exist", async (t) => {
  t.mock.method(Call, "findById", async () => null);

  const req = { user: { id: "receiver-uuid" }, body: { callId: "nonexistent-call-id" } };
  const res = createMockRes();

  await callController.accept(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Call not found");
});

test("Accept Call fails with 403 when caller tries to accept their own call", async (t) => {
  t.mock.method(Call, "findById", async () => ({
    callId: "call-1",
    callerId: "user-alice",
    receiverId: "user-bob",
    status: "ringing",
  }));

  const req = { user: { id: "user-alice" }, body: { callId: "call-1" } };
  const res = createMockRes();

  await callController.accept(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Caller cannot accept their own call");
});

test("Accept Call fails with 403 when unrelated user tries to accept call", async (t) => {
  t.mock.method(Call, "findById", async () => ({
    callId: "call-1",
    callerId: "user-alice",
    receiverId: "user-bob",
    status: "ringing",
  }));

  const req = { user: { id: "user-eve" }, body: { callId: "call-1" } };
  const res = createMockRes();

  await callController.accept(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Only the intended receiver can accept this call");
});

test("Accept Call fails with 400 when call is already accepted, rejected, or ended", async (t) => {
  for (const invalidStatus of ["accepted", "rejected", "ended", "missed"]) {
    t.mock.method(Call, "findById", async () => ({
      callId: "call-1",
      callerId: "user-alice",
      receiverId: "user-bob",
      status: invalidStatus,
    }));

    const req = { user: { id: "user-bob" }, body: { callId: "call-1" } };
    const res = createMockRes();

    await callController.accept(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, new RegExp(`already ${invalidStatus}`));
  }
});

test("Accept Call fails with 400 when call is expired (ringing timeout)", async (t) => {
  process.env.RINGING_TIMEOUT_SECONDS = "30";
  const oldDate = new Date(Date.now() - 40 * 1000).toISOString();

  t.mock.method(Call, "findById", async () => ({
    callId: "call-expired",
    callerId: "user-alice",
    receiverId: "user-bob",
    status: "ringing",
    createdAt: oldDate,
  }));

  const req = { user: { id: "user-bob" }, body: { callId: "call-expired" } };
  const res = createMockRes();

  await callController.accept(req, res);

  delete process.env.RINGING_TIMEOUT_SECONDS;
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Call has expired");
});

test("Accept Call fails with 409 when concurrent acceptance wins the race", async (t) => {
  t.mock.method(Call, "findById", async () => ({
    callId: "call-1",
    callerId: "user-alice",
    receiverId: "user-bob",
    status: "ringing",
  }));
  // Concurrently updated by another process:
  t.mock.method(Call, "accept", async () => null);

  const req = { user: { id: "user-bob" }, body: { callId: "call-1" } };
  const res = createMockRes();

  await callController.accept(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Call is no longer available to accept");
});

test("Accept Call succeeds with 200, updates status to accepted, and generates tokens", async (t) => {
  const initialCall = {
    callId: "call-success-1",
    callerId: "caller-user-id",
    receiverId: "receiver-user-id",
    roomName: "call-call-success-1",
    status: "ringing",
    createdAt: new Date().toISOString(),
  };

  t.mock.method(Call, "findById", async () => initialCall);

  let acceptCalledWith = null;
  t.mock.method(Call, "accept", async (params) => {
    acceptCalledWith = params;
    return {
      ...initialCall,
      status: "accepted",
      startedAt: new Date().toISOString(),
    };
  });

  const tokensCreated = [];
  t.mock.method(Token, "create", async ({ roomName, participantName }) => {
    tokensCreated.push({ roomName, participantName });
    return {
      serverUrl: "ws://127.0.0.1:7880",
      roomName,
      participantName,
      token: `signed-jwt-for-${participantName}`,
    };
  });

  const req = { user: { id: "receiver-user-id" }, body: { callId: "call-success-1" } };
  const res = createMockRes();

  await callController.accept(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, "Call accepted successfully");
  assert.equal(res.body.data.callId, "call-success-1");
  assert.equal(res.body.data.roomName, "call-call-success-1");
  assert.equal(res.body.data.serverUrl, "ws://127.0.0.1:7880");
  assert.equal(res.body.data.status, "accepted");

  assert.equal(res.body.data.caller.participantName, "caller-user-id");
  assert.equal(res.body.data.caller.token, "signed-jwt-for-caller-user-id");

  assert.equal(res.body.data.receiver.participantName, "receiver-user-id");
  assert.equal(res.body.data.receiver.token, "signed-jwt-for-receiver-user-id");

  assert.deepEqual(acceptCalledWith, { id: "call-success-1", receiverId: "receiver-user-id" });
  assert.equal(tokensCreated.length, 2);
  assert.equal(tokensCreated[0].roomName, tokensCreated[1].roomName);
});

test("End-to-end Express route POST /api/calls/accept responds through app pipeline", async (t) => {
  const receiverUser = { id: "receiver-e2e-2", name: "Receiver Bob" };

  t.mock.method(User, "findById", async (id) => {
    if (id === "receiver-e2e-2") return receiverUser;
    return null;
  });

  t.mock.method(Call, "findById", async () => ({
    callId: "call-e2e-123",
    callerId: "caller-e2e-1",
    receiverId: "receiver-e2e-2",
    roomName: "call-call-e2e-123",
    status: "ringing",
  }));

  t.mock.method(Call, "accept", async () => ({
    callId: "call-e2e-123",
    callerId: "caller-e2e-1",
    receiverId: "receiver-e2e-2",
    roomName: "call-call-e2e-123",
    status: "accepted",
    startedAt: new Date().toISOString(),
  }));

  t.mock.method(Token, "create", async ({ roomName, participantName }) => ({
    serverUrl: "ws://127.0.0.1:7880",
    roomName,
    participantName,
    token: `e2e-token-${participantName}`,
  }));

  const response = await dispatchApp({
    method: "POST",
    url: "/api/calls/accept",
    headers: {
      authorization: "Bearer receiver-e2e-2",
    },
    body: {
      callId: "call-e2e-123",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.message, "Call accepted successfully");
  assert.equal(response.body.data.callId, "call-e2e-123");
  assert.equal(response.body.data.roomName, "call-call-e2e-123");
  assert.equal(response.body.data.status, "accepted");
  assert.equal(response.body.data.caller.participantName, "caller-e2e-1");
  assert.equal(response.body.data.receiver.participantName, "receiver-e2e-2");
});
