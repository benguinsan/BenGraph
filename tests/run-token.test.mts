import assert from "node:assert/strict";
import test from "node:test";
import { createRunToken } from "../lib/run-token.mts";

const identity = { sessionId: "sess_original", userId: "user_original", orgId: "org_original" };
const now = 1_800_000_000_000;
function token(expiresAt: number, overrides: Record<string, unknown> = {}): string {
  return `header.${Buffer.from(JSON.stringify({ sid: identity.sessionId, sub: identity.userId, o: { id: identity.orgId }, exp: expiresAt / 1000, ...overrides })).toString("base64url")}.signature`;
}

test("reuses a valid run token and renews once near expiry across concurrent database writes", async (t) => {
  let time = now;
  t.mock.method(Date, "now", () => time);
  const initial = token(now + 60_000);
  const renewed = token(now + 115_000);
  const renew = t.mock.fn(async () => renewed);
  const getToken = createRunToken(initial, identity, renew);
  assert.equal(await getToken(), initial);
  assert.equal(renew.mock.callCount(), 0);
  time += 56_000;
  assert.deepEqual(await Promise.all([getToken(), getToken()]), [renewed, renewed]);
  assert.equal(renew.mock.callCount(), 1);
  time += 10_000;
  assert.equal(await getToken(), renewed);
  assert.equal(renew.mock.callCount(), 1);
});

test("rejects renewed tokens for a different organization, user or session", async (t) => {
  t.mock.method(Date, "now", () => now);
  for (const overrides of [{ o: { id: "org_other" } }, { sub: "user_other" }, { sid: "sess_other" }, { o: null }]) {
    const getToken = createRunToken(token(now + 1000), identity, async () => token(now + 60_000, overrides));
    await assert.rejects(getToken(), /session, user or organization/);
  }
});

test("never sends an expired token or falls back to one after renewal fails", async (t) => {
  t.mock.method(Date, "now", () => now);
  await assert.rejects(createRunToken(token(now - 1000), identity, async () => null)(), /No renewed session token/);
  await assert.rejects(createRunToken(token(now + 1000), identity, async () => token(now - 1000))(), /expired/);
  await assert.rejects(createRunToken(token(now + 1000), identity, async () => "invalid")(), /Invalid run session token/);
  assert.throws(() => createRunToken("invalid", identity, async () => null), /Invalid run session token/);
});
