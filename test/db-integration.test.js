const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const crypto = require("node:crypto");

const app = require("../src/app");
const db = require("../src/config/database");

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

const userAId = crypto.randomUUID();
const userBId = crypto.randomUUID();
const userCId = crypto.randomUUID();

before(async () => {
  // Create test users in real PostgreSQL database
  await db.query(
    `INSERT INTO users (id, name, email) VALUES
      ($1, 'Alice Test', 'alice-test@example.com'),
      ($2, 'Bob Test', 'bob-test@example.com'),
      ($3, 'Charlie Test', 'charlie-test@example.com')
     ON CONFLICT (id) DO NOTHING;`,
    [userAId, userBId, userCId]
  );
});

after(async () => {
  // Clean up test calls and users
  await db.query(`DELETE FROM calls WHERE caller_id IN ($1, $2, $3) OR receiver_id IN ($1, $2, $3);`, [
    userAId,
    userBId,
    userCId,
  ]);
  await db.query(`DELETE FROM users WHERE id IN ($1, $2, $3);`, [userAId, userBId, userCId]);
  await db.pool.end();
});

test("Real PostgreSQL: Complete Lifecycle (Initiate -> Accept -> End)", async () => {
  // 1. User A initiates call to User B
  const initRes = await dispatchApp({
    method: "POST",
    url: "/api/calls/initiate",
    headers: { authorization: `Bearer ${userAId}` },
    body: { receiverId: userBId },
  });

  assert.equal(initRes.statusCode, 200);
  assert.equal(initRes.body.success, true);
  const callId = initRes.body.data.callId;
  assert.equal(initRes.body.data.status, "ringing");

  // 2. User C (unrelated) tries to accept -> 403
  const cAcceptRes = await dispatchApp({
    method: "POST",
    url: "/api/calls/accept",
    headers: { authorization: `Bearer ${userCId}` },
    body: { callId },
  });
  assert.equal(cAcceptRes.statusCode, 403);

  // 3. User A (caller) tries to accept own call -> 403
  const aAcceptRes = await dispatchApp({
    method: "POST",
    url: "/api/calls/accept",
    headers: { authorization: `Bearer ${userAId}` },
    body: { callId },
  });
  assert.equal(aAcceptRes.statusCode, 403);

  // 4. User B (intended receiver) accepts call -> 200
  const bAcceptRes = await dispatchApp({
    method: "POST",
    url: "/api/calls/accept",
    headers: { authorization: `Bearer ${userBId}` },
    body: { callId },
  });
  assert.equal(bAcceptRes.statusCode, 200);
  assert.equal(bAcceptRes.body.success, true);
  assert.equal(bAcceptRes.body.data.status, "accepted");
  assert.ok(bAcceptRes.body.data.caller.token);
  assert.ok(bAcceptRes.body.data.receiver.token);
  assert.equal(bAcceptRes.body.data.caller.participantName, userAId);
  assert.equal(bAcceptRes.body.data.receiver.participantName, userBId);

  // 5. Try to accept already accepted call -> 400
  const reAcceptRes = await dispatchApp({
    method: "POST",
    url: "/api/calls/accept",
    headers: { authorization: `Bearer ${userBId}` },
    body: { callId },
  });
  assert.equal(reAcceptRes.statusCode, 400);

  // 6. User C tries to end call -> 403
  const cEndRes = await dispatchApp({
    method: "POST",
    url: "/api/calls/end",
    headers: { authorization: `Bearer ${userCId}` },
    body: { callId },
  });
  assert.equal(cEndRes.statusCode, 403);

  // 7. User A ends accepted call -> 200
  const aEndRes = await dispatchApp({
    method: "POST",
    url: "/api/calls/end",
    headers: { authorization: `Bearer ${userAId}` },
    body: { callId },
  });
  assert.equal(aEndRes.statusCode, 200);
  assert.equal(aEndRes.body.success, true);
  assert.equal(aEndRes.body.data.status, "ended");
  assert.ok(aEndRes.body.data.endedAt);
  assert.notEqual(aEndRes.body.data.duration, null);

  // 8. Try to end already ended call -> 400
  const reEndRes = await dispatchApp({
    method: "POST",
    url: "/api/calls/end",
    headers: { authorization: `Bearer ${userBId}` },
    body: { callId },
  });
  assert.equal(reEndRes.statusCode, 400);
});

test("Real PostgreSQL: Reject Lifecycle (Initiate -> Reject)", async () => {
  // 1. User A initiates call to User B
  const initRes = await dispatchApp({
    method: "POST",
    url: "/api/calls/initiate",
    headers: { authorization: `Bearer ${userAId}` },
    body: { receiverId: userBId },
  });
  const callId = initRes.body.data.callId;

  // 2. Caller A tries to reject -> 403
  const aRejectRes = await dispatchApp({
    method: "POST",
    url: "/api/calls/reject",
    headers: { authorization: `Bearer ${userAId}` },
    body: { callId },
  });
  assert.equal(aRejectRes.statusCode, 403);

  // 3. User B rejects -> 200
  const bRejectRes = await dispatchApp({
    method: "POST",
    url: "/api/calls/reject",
    headers: { authorization: `Bearer ${userBId}` },
    body: { callId },
  });
  assert.equal(bRejectRes.statusCode, 200);
  assert.equal(bRejectRes.body.success, true);
  assert.equal(bRejectRes.body.data.status, "rejected");
  assert.ok(bRejectRes.body.data.endedAt);

  // 4. Try to accept rejected call -> 400
  const bAcceptRes = await dispatchApp({
    method: "POST",
    url: "/api/calls/accept",
    headers: { authorization: `Bearer ${userBId}` },
    body: { callId },
  });
  assert.equal(bAcceptRes.statusCode, 400);
});

test("Real PostgreSQL: Cancel Lifecycle (Initiate -> Cancel)", async () => {
  // 1. User A initiates call to User B
  const initRes = await dispatchApp({
    method: "POST",
    url: "/api/calls/initiate",
    headers: { authorization: `Bearer ${userAId}` },
    body: { receiverId: userBId },
  });
  const callId = initRes.body.data.callId;

  // 2. Receiver B tries to cancel -> 403
  const bCancelRes = await dispatchApp({
    method: "POST",
    url: "/api/calls/cancel",
    headers: { authorization: `Bearer ${userBId}` },
    body: { callId },
  });
  assert.equal(bCancelRes.statusCode, 403);

  // 3. Caller A cancels -> 200
  const aCancelRes = await dispatchApp({
    method: "POST",
    url: "/api/calls/cancel",
    headers: { authorization: `Bearer ${userAId}` },
    body: { callId },
  });
  assert.equal(aCancelRes.statusCode, 200);
  assert.equal(aCancelRes.body.success, true);
  assert.equal(aCancelRes.body.data.status, "cancelled");
  assert.ok(aCancelRes.body.data.endedAt);

  // 4. Try to cancel again -> 400
  const reCancelRes = await dispatchApp({
    method: "POST",
    url: "/api/calls/cancel",
    headers: { authorization: `Bearer ${userAId}` },
    body: { callId },
  });
  assert.equal(reCancelRes.statusCode, 400);

  // 5. Try to accept cancelled call -> 400
  const acceptRes = await dispatchApp({
    method: "POST",
    url: "/api/calls/accept",
    headers: { authorization: `Bearer ${userBId}` },
    body: { callId },
  });
  assert.equal(acceptRes.statusCode, 400);
});

test("Real PostgreSQL: Details & Call History with pagination and participant scoping", async () => {
  // User A views history
  const aHistoryRes = await dispatchApp({
    method: "GET",
    url: "/api/calls/history?page=1&limit=10",
    headers: { authorization: `Bearer ${userAId}` },
  });

  assert.equal(aHistoryRes.statusCode, 200);
  assert.equal(aHistoryRes.body.success, true);
  assert.ok(aHistoryRes.body.data.length >= 3);
  assert.equal(aHistoryRes.body.pagination.page, 1);
  assert.equal(aHistoryRes.body.pagination.limit, 10);
  assert.ok(aHistoryRes.body.pagination.totalRecords >= 3);

  // Verify all records for A are either outgoing or incoming with userAId
  for (const c of aHistoryRes.body.data) {
    if (c.callerId === userAId) {
      assert.equal(c.direction, "outgoing");
    } else {
      assert.equal(c.receiverId, userAId);
      assert.equal(c.direction, "incoming");
    }
  }

  // User B views history
  const bHistoryRes = await dispatchApp({
    method: "GET",
    url: "/api/calls/history?page=1&limit=10",
    headers: { authorization: `Bearer ${userBId}` },
  });
  assert.equal(bHistoryRes.statusCode, 200);
  for (const c of bHistoryRes.body.data) {
    if (c.callerId === userBId) {
      assert.equal(c.direction, "outgoing");
    } else {
      assert.equal(c.receiverId, userBId);
      assert.equal(c.direction, "incoming");
    }
  }

  // User C views history -> 0 calls (User C never called or was called)
  const cHistoryRes = await dispatchApp({
    method: "GET",
    url: "/api/calls/history",
    headers: { authorization: `Bearer ${userCId}` },
  });
  assert.equal(cHistoryRes.statusCode, 200);
  assert.equal(cHistoryRes.body.data.length, 0);
  assert.equal(cHistoryRes.body.pagination.totalRecords, 0);

  // Test Details API
  const firstCallId = aHistoryRes.body.data[0].callId;

  // User C (unrelated) tries to get details -> 403
  const cDetailsRes = await dispatchApp({
    method: "GET",
    url: `/api/calls/${firstCallId}`,
    headers: { authorization: `Bearer ${userCId}` },
  });
  assert.equal(cDetailsRes.statusCode, 403);

  // User A gets details -> 200
  const aDetailsRes = await dispatchApp({
    method: "GET",
    url: `/api/calls/${firstCallId}`,
    headers: { authorization: `Bearer ${userAId}` },
  });
  assert.equal(aDetailsRes.statusCode, 200);
  assert.equal(aDetailsRes.body.data.callId, firstCallId);
  assert.ok(aDetailsRes.body.data.roomName);
  assert.equal(aDetailsRes.body.data.livekitSecret, undefined);
});


test("Real PostgreSQL: FCM Tokens & Multi-Device Support", async () => {
  const tokenAndroid = "fcm-android-token-12345";
  const tokenIOS = "fcm-ios-token-67890";

  // 1. User B registers an Android device
  const regRes1 = await dispatchApp({
    method: "POST",
    url: "/api/users/fcm-token",
    headers: { authorization: `Bearer ${userBId}` },
    body: {
      fcmToken: tokenAndroid,
      deviceType: "android",
      deviceId: "pixel-7-pro",
    },
  });

  assert.equal(regRes1.statusCode, 200);
  assert.equal(regRes1.body.success, true);
  assert.equal(regRes1.body.data.userId, userBId);
  assert.equal(regRes1.body.data.fcmToken, tokenAndroid);
  assert.equal(regRes1.body.data.deviceType, "android");
  assert.equal(regRes1.body.data.deviceId, "pixel-7-pro");

  // 2. User B registers a second device (iOS)
  const regRes2 = await dispatchApp({
    method: "POST",
    url: "/api/users/fcm-token",
    headers: { authorization: `Bearer ${userBId}` },
    body: {
      fcmToken: tokenIOS,
      deviceType: "ios",
      deviceId: "iphone-15-pro",
    },
  });

  assert.equal(regRes2.statusCode, 200);
  assert.equal(regRes2.body.data.fcmToken, tokenIOS);

  // 3. Query DB to verify both devices are stored for User B
  const dbCheck = await db.query(
    "SELECT id, fcm_token, device_type, device_id FROM user_fcm_tokens WHERE user_id = $1 ORDER BY device_type;",
    [userBId]
  );
  assert.equal(dbCheck.rows.length, 2);
  assert.equal(dbCheck.rows[0].device_type, "android");
  assert.equal(dbCheck.rows[1].device_type, "ios");

  // 4. Re-registering the same token updates it without duplicating
  const updateRes = await dispatchApp({
    method: "POST",
    url: "/api/users/fcm-token",
    headers: { authorization: `Bearer ${userBId}` },
    body: {
      fcmToken: tokenAndroid,
      deviceType: "android",
      deviceId: "pixel-7-pro-updated",
    },
  });
  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.body.data.deviceId, "pixel-7-pro-updated");

  const dbCheckAfterUpdate = await db.query(
    "SELECT COUNT(*)::int as count FROM user_fcm_tokens WHERE user_id = $1;",
    [userBId]
  );
  assert.equal(dbCheckAfterUpdate.rows[0].count, 2);

  // 5. User A tries to delete User B's token -> 404
  const wrongDeleteRes = await dispatchApp({
    method: "DELETE",
    url: "/api/users/fcm-token",
    headers: { authorization: `Bearer ${userAId}` },
    body: { fcmToken: tokenAndroid },
  });
  assert.equal(wrongDeleteRes.statusCode, 404);

  // 6. User B deletes Android token -> 200
  const deleteRes1 = await dispatchApp({
    method: "DELETE",
    url: "/api/users/fcm-token",
    headers: { authorization: `Bearer ${userBId}` },
    body: { fcmToken: tokenAndroid },
  });
  assert.equal(deleteRes1.statusCode, 200);
  assert.equal(deleteRes1.body.success, true);

  // 7. User B deletes iOS token -> 200
  const deleteRes2 = await dispatchApp({
    method: "DELETE",
    url: "/api/users/fcm-token",
    headers: { authorization: `Bearer ${userBId}` },
    body: { fcmToken: tokenIOS },
  });
  assert.equal(deleteRes2.statusCode, 200);

  const dbCheckEmpty = await db.query(
    "SELECT COUNT(*)::int as count FROM user_fcm_tokens WHERE user_id = $1;",
    [userBId]
  );
  assert.equal(dbCheckEmpty.rows[0].count, 0);
});
