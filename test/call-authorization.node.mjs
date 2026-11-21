import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createCallAuthorization } from "../server/call-authorization.ts";

const ownerToken = "test-owner-token-for-local-tests-only";
const phone = "+12025550123";
const authorization = `Bearer ${ownerToken}`;
const configured = { enabled: true, ownerToken, allowedNumbers: phone };

test("mock calls stay usable without owner configuration", () => {
  const authorize = createCallAuthorization({ enabled: false });
  assert.equal(authorize(undefined, [phone]), undefined);
});

test("real dispatch fails closed without a strong owner token or recipient configuration", () => {
  for (const options of [
    { enabled: true, allowedNumbers: phone },
    { ...configured, ownerToken: "too-short" },
    { ...configured, allowedNumbers: "" }
  ]) {
    assert.equal(createCallAuthorization(options)(authorization, [phone])?.status, 503);
  }
});

test("missing, wrong and oversized credentials cannot dispatch real calls", () => {
  const authorize = createCallAuthorization(configured);
  for (const header of [undefined, "Bearer wrong", `Bearer ${"x".repeat(513)}`, ownerToken]) {
    assert.equal(authorize(header, [phone])?.status, 401);
  }
  assert.equal(authorize(authorization, [phone]), undefined);
});

test("the complete mission and callback destination must be allowlisted", () => {
  const authorize = createCallAuthorization(configured);
  assert.equal(authorize(authorization, [phone, "+12025550124"])?.status, 403);
  assert.equal(authorize(authorization, ["+12025550124"])?.status, 403);
  assert.equal(authorize(authorization, [] )?.status, 403);
  assert.equal(authorize(authorization, [phone]), undefined);
});

test("one shared limit counts business calls and callbacks, with event-driven expiry", () => {
  let now = 0;
  const authorize = createCallAuthorization({ ...configured, now: () => now });
  assert.equal(authorize(authorization, Array(5).fill(phone)), undefined);
  assert.equal(authorize(authorization, Array(4).fill(phone)), undefined);
  assert.equal(authorize(authorization, [phone]), undefined);
  assert.deepEqual(authorize(authorization, [phone]), {
    status: 429,
    error: "Real-call limit reached. Try again after the current window ends.",
    retryAfter: 600
  });
  now = 600_000;
  assert.equal(authorize(authorization, [phone]), undefined);
});

test("rejected credentials and destinations do not consume the owner call limit", () => {
  const authorize = createCallAuthorization(configured);
  for (let i = 0; i < 20; i++) {
    authorize(undefined, [phone]);
    authorize(authorization, ["+12025550124"]);
  }
  assert.equal(authorize(authorization, Array(5).fill(phone)), undefined);
  assert.equal(authorize(authorization, Array(5).fill(phone)), undefined);
});

test("both provider dispatch routes invoke the shared guard before creating calls", () => {
  const server = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
  for (const [route, end] of [
    ["/api/missions/run", "// Voice callback:"],
    ["/api/missions/callback", "const webRoot"]
  ]) {
    const handler = server.slice(server.indexOf(`app.post("${route}"`), server.indexOf(end));
    assert.ok(handler.indexOf("authorizeCalls(") >= 0);
    assert.ok(handler.indexOf("authorizeCalls(") < handler.indexOf("calls.createAndWait("));
    assert.ok(handler.indexOf("authorizeCalls(") < handler.indexOf("if (!realCallsEnabled)"));
  }
});
