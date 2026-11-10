import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const token = (payload: string) => `header.${Buffer.from(payload).toString("base64url")}.signature`;

test("CLI rejects invalid or expired token lifetimes before any database request", async (t) => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ id: "existing-analysis", status: "complete", created: false }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${address.port}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-key" };
    const invalid = [
      { name: "malformed JWT", value: "invalid", error: /Invalid CARTOGRAPH_ACCESS_TOKEN/ },
      { name: "malformed payload", value: token("not json"), error: /Invalid CARTOGRAPH_ACCESS_TOKEN/ },
      ...["{}", "null", "[]", '{"exp":"123"}', '{"exp":null}', '{"exp":1e400}', '{"exp":0}', '{"exp":-1}'].map(payload => ({
        name: payload, value: token(payload), error: /CARTOGRAPH_ACCESS_TOKEN.*exp.*positive finite number/,
      })),
      { name: "expired", value: token('{"exp":1}'), error: /CARTOGRAPH_ACCESS_TOKEN has expired/ },
    ];
    for (const entry of invalid) {
      await t.test(entry.name, async () => {
        await assert.rejects(run(process.execPath, ["--experimental-strip-types", "scripts/analyse-repo.mts", "https://github.com/owner/repo"], {
          cwd: new URL("..", import.meta.url), env: { ...env, CARTOGRAPH_ACCESS_TOKEN: entry.value },
        }), error => {
          assert.ok(error instanceof Error && "stderr" in error && "code" in error);
          assert.equal(error.code, 1);
          assert.match(String(error.stderr), entry.error);
          assert.ok(!String(error.stderr).includes(entry.value), "error must not expose the token");
          return true;
        });
        assert.equal(requests, 0);
      });
    }
    await t.test("valid token warns about lifetime and still runs", async () => {
      const { stdout, stderr } = await run(process.execPath, ["--experimental-strip-types", "scripts/analyse-repo.mts", "https://github.com/owner/repo"], {
        cwd: new URL("..", import.meta.url),
        env: { ...env, CARTOGRAPH_ACCESS_TOKEN: token(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300 })) },
      });
      assert.match(stderr, /token expires in \d+s.*cannot renew.*limit the run/i);
      assert.match(stdout, /Existing analysis existing-analysis: complete/);
      assert.equal(requests, 1);
    });
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
