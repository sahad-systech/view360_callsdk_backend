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

// -------------------------------------------------------------
// Reject Call API Tests (POST /api/calls/reject)
// -------------------------------------------------------------

test("Reject Call fails with 401 if request has no authenticated user", async () => {
  const req = { user: null, body: { callId: "some-call-id" } };
  const res = createMockRes();

  await callController.reject(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
});

test("Reject Call fails with 400 when callId is missing or empty", async () => {
  for (const invalidCallId of [undefined, null, "", "   "]) {
    const req = { user: { id: "receiver-uuid" }, body: { callId: invalidCallId } };
    const res = createMockRes();

    await callController.reject(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "callId is required");
  }
});

test("Reject Call fails with 404 when call does not exist", async (t) => {
  t.mock.method(Call, "findById", async () => null);

  const req = { user: { id: "receiver-uuid" }, body: { callId: "nonexistent-call-id" } };
  const res = createMockRes();

  await callController.reject(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Call not found");
});

test("Reject Call fails with 403 when caller tries to reject their own call", async (t) => {
  t.mock.method(Call, "findById", async () => ({
    callId: "call-1",
    callerId: "user-alice",
    receiverId: "user-bob",
    status: "ringing",
  }));

  const req = { user: { id: "user-alice" }, body: { callId: "call-1" } };
  const res = createMockRes();

  await callController.reject(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Caller cannot reject their own call");
});

test("Reject Call fails with 403 when unrelated user tries to reject call", async (t) => {
  t.mock.method(Call, "findById", async () => ({
    callId: "call-1",
    callerId: "user-alice",
    receiverId: "user-bob",
    status: "ringing",
  }));

  const req = { user: { id: "user-eve" }, body: { callId: "call-1" } };
  const res = createMockRes();

  await callController.reject(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Only the intended receiver can reject this call");
});

test("Reject Call fails with 400 when call is not in ringing status", async (t) => {
  for (const invalidStatus of ["accepted", "rejected", "cancelled", "ended", "missed"]) {
    t.mock.method(Call, "findById", async () => ({
      callId: "call-1",
      callerId: "user-alice",
      receiverId: "user-bob",
      status: invalidStatus,
    }));

    const req = { user: { id: "user-bob" }, body: { callId: "call-1" } };
    const res = createMockRes();

    await callController.reject(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, new RegExp(`already ${invalidStatus}`));
  }
});

test("Reject Call fails with 409 when concurrent action updates call", async (t) => {
  t.mock.method(Call, "findById", async () => ({
    callId: "call-1",
    callerId: "user-alice",
    receiverId: "user-bob",
    status: "ringing",
  }));
  t.mock.method(Call, "reject", async () => null);

  const req = { user: { id: "user-bob" }, body: { callId: "call-1" } };
  const res = createMockRes();

  await callController.reject(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Call is no longer available to reject");
});

test("Reject Call succeeds with 200, updates status to rejected, and records endedAt", async (t) => {
  const initialCall = {
    callId: "call-reject-1",
    callerId: "caller-user-id",
    receiverId: "receiver-user-id",
    status: "ringing",
  };

  t.mock.method(Call, "findById", async () => initialCall);

  const endedAtTimestamp = new Date().toISOString();
  let rejectCalledWith = null;
  t.mock.method(Call, "reject", async (params) => {
    rejectCalledWith = params;
    return {
      ...initialCall,
      status: "rejected",
      endedAt: endedAtTimestamp,
    };
  });

  const req = { user: { id: "receiver-user-id" }, body: { callId: "call-reject-1" } };
  const res = createMockRes();

  await callController.reject(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, "Call rejected successfully");
  assert.equal(res.body.data.callId, "call-reject-1");
  assert.equal(res.body.data.status, "rejected");
  assert.equal(res.body.data.endedAt, endedAtTimestamp);
  assert.deepEqual(rejectCalledWith, { id: "call-reject-1", receiverId: "receiver-user-id" });
});

test("End-to-end Express route POST /api/calls/reject responds through app pipeline", async (t) => {
  const receiverUser = { id: "receiver-rej-user", name: "Receiver Rej" };

  t.mock.method(User, "findById", async (id) => (id === "receiver-rej-user" ? receiverUser : null));

  t.mock.method(Call, "findById", async () => ({
    callId: "call-rej-101",
    callerId: "caller-rej-user",
    receiverId: "receiver-rej-user",
    status: "ringing",
  }));

  const endedAt = new Date().toISOString();
  t.mock.method(Call, "reject", async () => ({
    callId: "call-rej-101",
    callerId: "caller-rej-user",
    receiverId: "receiver-rej-user",
    status: "rejected",
    endedAt,
  }));

  const response = await dispatchApp({
    method: "POST",
    url: "/api/calls/reject",
    headers: {
      authorization: "Bearer receiver-rej-user",
    },
    body: {
      callId: "call-rej-101",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.message, "Call rejected successfully");
  assert.equal(response.body.data.callId, "call-rej-101");
  assert.equal(response.body.data.status, "rejected");
  assert.equal(response.body.data.endedAt, endedAt);
});

// -------------------------------------------------------------
// End Call API Tests (POST /api/calls/end)
// -------------------------------------------------------------

test("End Call fails with 401 if request has no authenticated user", async () => {
  const req = { user: null, body: { callId: "some-call-id" } };
  const res = createMockRes();

  await callController.endCall(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
});

test("End Call fails with 400 when callId is missing or empty", async () => {
  for (const invalidCallId of [undefined, null, "", "   "]) {
    const req = { user: { id: "user-123" }, body: { callId: invalidCallId } };
    const res = createMockRes();

    await callController.endCall(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "callId is required");
  }
});

test("End Call fails with 404 when call does not exist", async (t) => {
  t.mock.method(Call, "findById", async () => null);

  const req = { user: { id: "user-123" }, body: { callId: "nonexistent-call-id" } };
  const res = createMockRes();

  await callController.endCall(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Call not found");
});

test("End Call fails with 403 when user is neither caller nor receiver", async (t) => {
  t.mock.method(Call, "findById", async () => ({
    callId: "call-1",
    callerId: "user-alice",
    receiverId: "user-bob",
    status: "accepted",
  }));

  const req = { user: { id: "user-eve" }, body: { callId: "call-1" } };
  const res = createMockRes();

  await callController.endCall(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Only call participants can end this call");
});

test("End Call fails with 400 when call is not in accepted status", async (t) => {
  for (const invalidStatus of ["ringing", "rejected", "cancelled", "ended", "missed"]) {
    t.mock.method(Call, "findById", async () => ({
      callId: "call-1",
      callerId: "user-alice",
      receiverId: "user-bob",
      status: invalidStatus,
    }));

    const req = { user: { id: "user-alice" }, body: { callId: "call-1" } };
    const res = createMockRes();

    await callController.endCall(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, new RegExp(`cannot be ended because it is ${invalidStatus}`));
  }
});

test("End Call fails with 409 when concurrent end occurs", async (t) => {
  t.mock.method(Call, "findById", async () => ({
    callId: "call-1",
    callerId: "user-alice",
    receiverId: "user-bob",
    status: "accepted",
  }));
  t.mock.method(Call, "end", async () => null);

  const req = { user: { id: "user-alice" }, body: { callId: "call-1" } };
  const res = createMockRes();

  await callController.endCall(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Call state was updated by another request");
});

test("End Call succeeds with 200 when caller ends call, calculating duration", async (t) => {
  const startedAt = new Date(Date.now() - 65 * 1000).toISOString();
  const endedAt = new Date().toISOString();

  t.mock.method(Call, "findById", async () => ({
    callId: "call-end-1",
    callerId: "user-alice",
    receiverId: "user-bob",
    roomName: "call-call-end-1",
    status: "accepted",
    startedAt,
  }));

  t.mock.method(Call, "end", async ({ id, userId }) => ({
    callId: id,
    callerId: "user-alice",
    receiverId: "user-bob",
    roomName: "call-call-end-1",
    status: "ended",
    createdAt: new Date(Date.now() - 70 * 1000).toISOString(),
    startedAt,
    endedAt,
    duration: 65,
  }));

  const req = { user: { id: "user-alice" }, body: { callId: "call-end-1" } };
  const res = createMockRes();

  await callController.endCall(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, "Call ended successfully");
  assert.equal(res.body.data.callId, "call-end-1");
  assert.equal(res.body.data.status, "ended");
  assert.equal(res.body.data.startedAt, startedAt);
  assert.equal(res.body.data.endedAt, endedAt);
  assert.equal(res.body.data.duration, 65);
});

test("End Call succeeds with 200 when receiver ends call", async (t) => {
  const startedAt = new Date(Date.now() - 120 * 1000).toISOString();
  const endedAt = new Date().toISOString();

  t.mock.method(Call, "findById", async () => ({
    callId: "call-end-2",
    callerId: "user-alice",
    receiverId: "user-bob",
    roomName: "call-call-end-2",
    status: "accepted",
    startedAt,
  }));

  t.mock.method(Call, "end", async () => ({
    callId: "call-end-2",
    callerId: "user-alice",
    receiverId: "user-bob",
    roomName: "call-call-end-2",
    status: "ended",
    createdAt: new Date(Date.now() - 130 * 1000).toISOString(),
    startedAt,
    endedAt,
    duration: 120,
  }));

  const req = { user: { id: "user-bob" }, body: { callId: "call-end-2" } };
  const res = createMockRes();

  await callController.endCall(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, "ended");
  assert.equal(res.body.data.duration, 120);
});

test("End-to-end Express route POST /api/calls/end responds through app pipeline", async (t) => {
  const callerUser = { id: "caller-end-user", name: "Caller End" };

  t.mock.method(User, "findById", async (id) => (id === "caller-end-user" ? callerUser : null));

  t.mock.method(Call, "findById", async () => ({
    callId: "call-e2e-end",
    callerId: "caller-end-user",
    receiverId: "receiver-end-user",
    status: "accepted",
  }));

  const startedAt = new Date(Date.now() - 30 * 1000).toISOString();
  const endedAt = new Date().toISOString();

  t.mock.method(Call, "end", async () => ({
    callId: "call-e2e-end",
    callerId: "caller-end-user",
    receiverId: "receiver-end-user",
    roomName: "call-e2e-room",
    status: "ended",
    createdAt: new Date().toISOString(),
    startedAt,
    endedAt,
    duration: 30,
  }));

  const response = await dispatchApp({
    method: "POST",
    url: "/api/calls/end",
    headers: {
      authorization: "Bearer caller-end-user",
    },
    body: {
      callId: "call-e2e-end",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.message, "Call ended successfully");
  assert.equal(response.body.data.status, "ended");
  assert.equal(response.body.data.duration, 30);
});

// -------------------------------------------------------------
// Get Call Details API Tests (GET /api/calls/:callId)
// -------------------------------------------------------------

test("Get Call Details fails with 401 if request has no authenticated user", async () => {
  const req = { user: null, params: { callId: "some-call-id" } };
  const res = createMockRes();

  await callController.getDetails(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
});

test("Get Call Details fails with 404 when call does not exist", async (t) => {
  t.mock.method(Call, "findById", async () => null);

  const req = { user: { id: "user-123" }, params: { callId: "nonexistent-call-id" } };
  const res = createMockRes();

  await callController.getDetails(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Call not found");
});

test("Get Call Details fails with 403 when user is neither caller nor receiver", async (t) => {
  t.mock.method(Call, "findById", async () => ({
    callId: "call-details-1",
    callerId: "caller-alice",
    receiverId: "receiver-bob",
    status: "accepted",
  }));

  const req = { user: { id: "unrelated-eve" }, params: { callId: "call-details-1" } };
  const res = createMockRes();

  await callController.getDetails(req, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Access denied: You are not a participant in this call");
});

test("Get Call Details succeeds for caller and receiver, returning required fields without secrets", async (t) => {
  const callRecord = {
    callId: "call-details-2",
    callerId: "caller-alice",
    receiverId: "receiver-bob",
    roomName: "call-room-details",
    status: "ended",
    createdAt: "2026-11-20T10:00:00.000Z",
    startedAt: "2026-11-20T10:00:05.000Z",
    endedAt: "2026-11-20T10:01:05.000Z",
    duration: 60,
  };

  t.mock.method(Call, "findById", async () => callRecord);

  // Test caller accessing details
  const reqCaller = { user: { id: "caller-alice" }, params: { callId: "call-details-2" } };
  const resCaller = createMockRes();
  await callController.getDetails(reqCaller, resCaller);

  assert.equal(resCaller.statusCode, 200);
  assert.equal(resCaller.body.success, true);
  assert.deepEqual(resCaller.body.data, {
    callId: "call-details-2",
    callerId: "caller-alice",
    receiverId: "receiver-bob",
    roomName: "call-room-details",
    status: "ended",
    createdAt: "2026-11-20T10:00:00.000Z",
    startedAt: "2026-11-20T10:00:05.000Z",
    endedAt: "2026-11-20T10:01:05.000Z",
    duration: 60,
  });
  assert.equal(resCaller.body.data.livekitSecret, undefined);

  // Test receiver accessing details
  const reqReceiver = { user: { id: "receiver-bob" }, params: { callId: "call-details-2" } };
  const resReceiver = createMockRes();
  await callController.getDetails(reqReceiver, resReceiver);

  assert.equal(resReceiver.statusCode, 200);
  assert.equal(resReceiver.body.success, true);
  assert.equal(resReceiver.body.data.callId, "call-details-2");
});

test("End-to-end Express route GET /api/calls/:callId responds through app pipeline", async (t) => {
  const callerUser = { id: "caller-get-user", name: "Caller Get" };

  t.mock.method(User, "findById", async (id) => (id === "caller-get-user" ? callerUser : null));

  t.mock.method(Call, "findById", async () => ({
    callId: "call-uuid-get",
    callerId: "caller-get-user",
    receiverId: "receiver-get-user",
    roomName: "call-call-uuid-get",
    status: "ringing",
    createdAt: "2026-11-20T12:00:00.000Z",
    startedAt: null,
    endedAt: null,
    duration: null,
  }));

  const response = await dispatchApp({
    method: "GET",
    url: "/api/calls/call-uuid-get",
    headers: {
      authorization: "Bearer caller-get-user",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.callId, "call-uuid-get");
  assert.equal(response.body.data.status, "ringing");
  assert.equal(response.body.data.startedAt, null);
  assert.equal(response.body.data.duration, null);
});

// -------------------------------------------------------------
// Call History API Tests (GET /api/calls/history)
// -------------------------------------------------------------

test("Call History fails with 401 if request has no authenticated user", async () => {
  const req = { user: null, query: {} };
  const res = createMockRes();

  await callController.getHistory(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
});

test("Call History fails with 400 when invalid page or limit is supplied", async () => {
  for (const invalidPage of ["0", "-1", "abc"]) {
    const req = { user: { id: "user-123" }, query: { page: invalidPage } };
    const res = createMockRes();
    await callController.getHistory(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, "page must be a positive integer");
  }

  for (const invalidLimit of ["0", "-5", "101", "xyz"]) {
    const req = { user: { id: "user-123" }, query: { limit: invalidLimit } };
    const res = createMockRes();
    await callController.getHistory(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, "limit must be a positive integer between 1 and 100");
  }
});

test("Call History succeeds with default pagination, returns incoming/outgoing directions", async (t) => {
  const mockUserId = "user-test-hist";

  let findHistoryCalledWith = null;
  t.mock.method(Call, "findHistory", async (params) => {
    findHistoryCalledWith = params;
    return {
      calls: [
        {
          callId: "call-1",
          callerId: mockUserId,
          receiverId: "other-user-1",
          direction: "outgoing",
          status: "ended",
          createdAt: "2026-11-20T12:00:00.000Z",
          startedAt: "2026-11-20T12:00:05.000Z",
          endedAt: "2026-11-20T12:01:05.000Z",
          duration: 60,
        },
        {
          callId: "call-2",
          callerId: "other-user-2",
          receiverId: mockUserId,
          direction: "incoming",
          status: "rejected",
          createdAt: "2026-11-20T11:00:00.000Z",
          startedAt: null,
          endedAt: "2026-11-20T11:00:10.000Z",
          duration: null,
        },
      ],
      pagination: {
        page: 1,
        limit: 20,
        totalRecords: 2,
        totalPages: 1,
      },
    };
  });

  const req = { user: { id: mockUserId }, query: {} };
  const res = createMockRes();

  await callController.getHistory(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, "Call history retrieved successfully");
  assert.deepEqual(findHistoryCalledWith, { userId: mockUserId, page: 1, limit: 20 });
  assert.equal(res.body.data.length, 2);
  assert.equal(res.body.data[0].direction, "outgoing");
  assert.equal(res.body.data[1].direction, "incoming");
  assert.deepEqual(res.body.pagination, {
    page: 1,
    limit: 20,
    totalRecords: 2,
    totalPages: 1,
  });
});

test("End-to-end Express route GET /api/calls/history responds and is not captured by /:callId", async (t) => {
  const historyUser = { id: "history-user-uuid", name: "History User" };

  t.mock.method(User, "findById", async (id) => (id === "history-user-uuid" ? historyUser : null));

  t.mock.method(Call, "findHistory", async ({ userId, page, limit }) => ({
    calls: [],
    pagination: {
      page,
      limit,
      totalRecords: 0,
      totalPages: 0,
    },
  }));

  const response = await dispatchApp({
    method: "GET",
    url: "/api/calls/history?page=2&limit=10",
    headers: {
      authorization: "Bearer history-user-uuid",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.message, "Call history retrieved successfully");
  assert.deepEqual(response.body.pagination, {
    page: 2,
    limit: 10,
    totalRecords: 0,
    totalPages: 0,
  });
});

// -------------------------------------------------------------
// Cancel Call API Tests (POST /api/calls/cancel)
// -------------------------------------------------------------

test("Cancel Call fails with 401 if request has no authenticated user", async () => {
  const req = { user: null, body: { callId: "some-call-id" } };
  const res = createMockRes();

  await callController.cancel(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.success, false);
});

test("Cancel Call fails with 400 when callId is missing or empty", async () => {
  for (const invalidCallId of [undefined, null, "", "   "]) {
    const req = { user: { id: "caller-uuid" }, body: { callId: invalidCallId } };
    const res = createMockRes();

    await callController.cancel(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "callId is required");
  }
});

test("Cancel Call fails with 404 when call does not exist", async (t) => {
  t.mock.method(Call, "findById", async () => null);

  const req = { user: { id: "caller-uuid" }, body: { callId: "nonexistent-call-id" } };
  const res = createMockRes();

  await callController.cancel(req, res);

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Call not found");
});

test("Cancel Call fails with 403 when receiver or unrelated user tries to cancel", async (t) => {
  t.mock.method(Call, "findById", async () => ({
    callId: "call-1",
    callerId: "user-alice",
    receiverId: "user-bob",
    status: "ringing",
  }));

  // Receiver tries to cancel
  const reqReceiver = { user: { id: "user-bob" }, body: { callId: "call-1" } };
  const resReceiver = createMockRes();
  await callController.cancel(reqReceiver, resReceiver);
  assert.equal(resReceiver.statusCode, 403);
  assert.equal(resReceiver.body.message, "Only the caller can cancel this call");

  // Unrelated user tries to cancel
  const reqEve = { user: { id: "user-eve" }, body: { callId: "call-1" } };
  const resEve = createMockRes();
  await callController.cancel(reqEve, resEve);
  assert.equal(resEve.statusCode, 403);
  assert.equal(resEve.body.message, "Only the caller can cancel this call");
});

test("Cancel Call fails with 400 when call is not in ringing status", async (t) => {
  for (const invalidStatus of ["accepted", "rejected", "cancelled", "ended", "missed"]) {
    t.mock.method(Call, "findById", async () => ({
      callId: "call-1",
      callerId: "user-alice",
      receiverId: "user-bob",
      status: invalidStatus,
    }));

    const req = { user: { id: "user-alice" }, body: { callId: "call-1" } };
    const res = createMockRes();

    await callController.cancel(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, new RegExp(`already ${invalidStatus}`));
  }
});

test("Cancel Call fails with 409 when concurrent cancel occurs", async (t) => {
  t.mock.method(Call, "findById", async () => ({
    callId: "call-1",
    callerId: "user-alice",
    receiverId: "user-bob",
    status: "ringing",
  }));
  t.mock.method(Call, "cancel", async () => null);

  const req = { user: { id: "user-alice" }, body: { callId: "call-1" } };
  const res = createMockRes();

  await callController.cancel(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Call is no longer available to cancel");
});

test("Cancel Call succeeds with 200, updates status to cancelled, and records endedAt", async (t) => {
  const initialCall = {
    callId: "call-cancel-1",
    callerId: "caller-alice",
    receiverId: "receiver-bob",
    status: "ringing",
  };

  t.mock.method(Call, "findById", async () => initialCall);

  const endedAtTimestamp = new Date().toISOString();
  let cancelCalledWith = null;
  t.mock.method(Call, "cancel", async (params) => {
    cancelCalledWith = params;
    return {
      ...initialCall,
      status: "cancelled",
      endedAt: endedAtTimestamp,
    };
  });

  const req = { user: { id: "caller-alice" }, body: { callId: "call-cancel-1" } };
  const res = createMockRes();

  await callController.cancel(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, "Call cancelled successfully");
  assert.equal(res.body.data.callId, "call-cancel-1");
  assert.equal(res.body.data.status, "cancelled");
  assert.equal(res.body.data.endedAt, endedAtTimestamp);
  assert.deepEqual(cancelCalledWith, { id: "call-cancel-1", callerId: "caller-alice" });
});

test("End-to-end Express route POST /api/calls/cancel responds through app pipeline", async (t) => {
  const callerUser = { id: "caller-cancel-e2e", name: "Caller Cancel" };

  t.mock.method(User, "findById", async (id) => (id === "caller-cancel-e2e" ? callerUser : null));

  t.mock.method(Call, "findById", async () => ({
    callId: "call-canc-e2e",
    callerId: "caller-cancel-e2e",
    receiverId: "receiver-cancel-e2e",
    status: "ringing",
  }));

  const endedAt = new Date().toISOString();
  t.mock.method(Call, "cancel", async () => ({
    callId: "call-canc-e2e",
    callerId: "caller-cancel-e2e",
    receiverId: "receiver-cancel-e2e",
    status: "cancelled",
    endedAt,
  }));

  const response = await dispatchApp({
    method: "POST",
    url: "/api/calls/cancel",
    headers: {
      authorization: "Bearer caller-cancel-e2e",
    },
    body: {
      callId: "call-canc-e2e",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.message, "Call cancelled successfully");
  assert.equal(response.body.data.callId, "call-canc-e2e");
  assert.equal(response.body.data.status, "cancelled");
  assert.equal(response.body.data.endedAt, endedAt);
});
