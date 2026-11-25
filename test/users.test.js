const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");

const app = require("../src/app");
const User = require("../src/models/user");
const userController = require("../src/controllers/userController");

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
      resolve({ statusCode: res.statusCode, headers: res.getHeaders(), body: parsed });
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

test("User Registration: fails with 400 when name is missing or empty", async () => {
  const req = { body: { email: "test@example.com" } };
  const res = createMockRes();

  await userController.registerUser(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /name is required/i);
});

test("User Registration: fails with 409 when email already exists", async (t) => {
  const origFindById = User.findById;
  t.after(() => {
    User.findById = origFindById;
  });

  User.findById = async (email) => {
    if (email === "duplicate@example.com") {
      return { id: "existing-uuid", name: "Existing", email: "duplicate@example.com" };
    }
    return null;
  };

  const req = { body: { name: "New User", email: "duplicate@example.com" } };
  const res = createMockRes();

  await userController.registerUser(req, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /already exists/i);
});

test("User Registration: succeeds with 201 and creates user", async (t) => {
  const origFindById = User.findById;
  const origCreate = User.create;
  t.after(() => {
    User.findById = origFindById;
    User.create = origCreate;
  });

  User.findById = async () => null;
  User.create = async ({ id, name, email }) => ({
    id: id || "generated-user-uuid",
    name,
    email,
    created_at: new Date().toISOString(),
  });

  const req = { body: { name: "Charlie", email: "charlie@view360.test" } };
  const res = createMockRes();

  await userController.registerUser(req, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.name, "Charlie");
  assert.equal(res.body.data.email, "charlie@view360.test");
  assert.equal(res.body.data.id, "generated-user-uuid");
});

test("User Retrieval: GET /api/users/:id returns 404 if user not found", async (t) => {
  const origFindById = User.findById;
  t.after(() => {
    User.findById = origFindById;
  });

  User.findById = async () => null;

  const req = { params: { id: "non-existent" } };
  const res = createMockRes();

  await userController.getUser(req, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /not found/i);
});

test("User Retrieval: GET /api/users/:id returns 200 with user data", async (t) => {
  const origFindById = User.findById;
  t.after(() => {
    User.findById = origFindById;
  });

  User.findById = async (id) => ({
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
    created_at: "2026-11-25T10:00:00.000Z",
  });

  const req = { params: { id: "user-123" } };
  const res = createMockRes();

  await userController.getUser(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.id, "user-123");
  assert.equal(res.body.data.name, "Test User");
});

test("End-to-end: POST /api/users/register and GET /api/users/:id via Express router", async (t) => {
  const origFindById = User.findById;
  const origCreate = User.create;
  t.after(() => {
    User.findById = origFindById;
    User.create = origCreate;
  });

  let registered = false;
  User.findById = async (identifier) => {
    if (registered && (identifier === "e2e-user-id" || identifier === "e2e@view360.test")) {
      return {
        id: "e2e-user-id",
        name: "E2E User",
        email: "e2e@view360.test",
        created_at: "2026-11-25T12:00:00.000Z",
      };
    }
    return null;
  };

  User.create = async ({ id, name, email }) => {
    registered = true;
    return {
      id: id || "e2e-user-id",
      name,
      email,
      created_at: "2026-11-25T12:00:00.000Z",
    };
  };

  // Test registration endpoint
  const regRes = await dispatchApp({
    method: "POST",
    url: "/api/users/register",
    body: { name: "E2E User", email: "e2e@view360.test" },
  });

  assert.equal(regRes.statusCode, 201);
  assert.equal(regRes.body.success, true);
  assert.equal(regRes.body.data.name, "E2E User");

  // Test get user endpoint
  const getRes = await dispatchApp({
    method: "GET",
    url: "/api/users/e2e-user-id",
  });

  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.success, true);
  assert.equal(getRes.body.data.name, "E2E User");
});
