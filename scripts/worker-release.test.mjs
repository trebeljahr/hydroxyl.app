import assert from "node:assert/strict";
import { test } from "node:test";
import { cloudflareApi, findVersion, liveVersion, release } from "./worker-release.mjs";

const SHA = "a".repeat(40);
const OLD = "b".repeat(40);
const V_NEW = "11111111-1111-4111-8111-111111111111";
const V_OLD = "22222222-2222-4222-8222-222222222222";

/** A fake Worker API: versions by id, and the deployments it was sent. */
function fakeApi({ versions = {}, live = V_OLD, listAnnotations = true, failPosts = [] } = {}) {
  const deployments = [{ versions: [{ version_id: live, percentage: 100 }] }];
  const calls = [];
  const api = async (method, path, body) => {
    calls.push(`${method} ${path}`);
    if (method === "GET" && path === "/deployments") return { deployments };
    if (method === "GET" && path === "/versions?deployable=true") {
      return {
        items: Object.entries(versions).map(([id, tag]) =>
          listAnnotations ? { id, annotations: { "workers/tag": tag } } : { id },
        ),
      };
    }
    if (method === "GET" && path.startsWith("/versions/")) {
      const id = path.slice("/versions/".length);
      if (!(id in versions)) throw new Error("Cloudflare GET answered 404");
      return { id, annotations: { "workers/tag": versions[id] } };
    }
    if (method === "POST" && path === "/deployments") {
      const failure = failPosts.shift();
      // "applied" models an answer lost after Cloudflare made the change.
      if (failure === "applied") deployments.unshift({ versions: body.versions });
      if (failure) throw new Error("The operation was aborted due to timeout");
      deployments.unshift({ versions: body.versions });
      return {};
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { api, calls, deployments };
}

test("a version id from the build must be tagged with the commit it claims", async () => {
  const { api } = fakeApi({ versions: { [V_NEW]: OLD } });
  await assert.rejects(findVersion(api, SHA, V_NEW), /tagged b{40}, not a{40}/);
  await assert.rejects(findVersion(api, "latest", V_NEW), /full lowercase/);
  await assert.rejects(findVersion(api, SHA, "../deployments"), /not a Worker version id/);
});

test("a dispatch finds the newest version tagged with the commit, even without list annotations", async () => {
  const { api } = fakeApi({ versions: { [V_NEW]: SHA, [V_OLD]: OLD }, listAnnotations: false });
  assert.equal(await findVersion(api, SHA), V_NEW);
  assert.equal(await findVersion(api, OLD), V_OLD);
  await assert.rejects(findVersion(api, "c".repeat(40)), /No deployable version/);
});

test("a split deployment has no single live version to put back", async () => {
  const { api, deployments } = fakeApi();
  assert.equal(await liveVersion(api), V_OLD);
  deployments.unshift({
    versions: [
      { version_id: V_OLD, percentage: 50 },
      { version_id: V_NEW, percentage: 50 },
    ],
  });
  assert.equal(await liveVersion(api), null);
});

test("a verified release stays live", async () => {
  const { api, deployments } = fakeApi({ versions: { [V_NEW]: SHA } });
  const record = await release(SHA, V_NEW, { api, verify: async () => "ok", log: () => {} });
  assert.equal(record.outcome, "verified");
  assert.equal(record.previous, V_OLD);
  assert.equal(deployments[0].versions[0].version_id, V_NEW);
});

test("a release that fails verification puts the previous version back and still fails", async () => {
  const { api, deployments } = fakeApi({ versions: { [V_NEW]: SHA } });
  await assert.rejects(
    release(SHA, V_NEW, {
      api,
      verify: async () => {
        throw new Error("Public version differs from the expected commit.");
      },
      log: () => {},
    }),
    (error) => {
      assert.equal(error.record.outcome, "rolled-back");
      assert.equal(error.record.live, V_OLD);
      assert.match(error.message, /Put 2{8}-.* back/);
      return true;
    },
  );
  assert.deepEqual(deployments[0].versions, [{ version_id: V_OLD, percentage: 100 }]);
  assert.deepEqual(deployments[1].versions, [{ version_id: V_NEW, percentage: 100 }]);
});

test("a lost activation answer reads back what serves and does not roll back", async () => {
  const { api, deployments } = fakeApi({ versions: { [V_NEW]: SHA }, failPosts: ["applied"] });
  let verified = false;
  await assert.rejects(
    release(SHA, V_NEW, { api, verify: async () => (verified = true), log: () => {} }),
    (error) => {
      assert.equal(error.record.outcome, "activation-unknown");
      assert.equal(error.record.live, V_NEW);
      assert.match(error.message, /Serving now: 1{8}-/);
      return true;
    },
  );
  assert.equal(verified, false);
  assert.equal(deployments.length, 2);
});

test("a failed rollback keeps the verification failure and says what serves", async () => {
  const { api } = fakeApi({ versions: { [V_NEW]: SHA }, failPosts: [undefined, "lost"] });
  await assert.rejects(
    release(SHA, V_NEW, {
      api,
      verify: async () => {
        throw new Error("Public version differs from the expected commit.");
      },
      log: () => {},
    }),
    (error) => {
      assert.equal(error.record.outcome, "rollback-failed");
      assert.equal(error.record.failure, "Public version differs from the expected commit.");
      assert.equal(error.record.live, V_NEW);
      return true;
    },
  );
});

test("nothing changes when the version cannot be found", async () => {
  const { api, calls } = fakeApi({ versions: {} });
  await assert.rejects(release(SHA, V_NEW, { api, verify: async () => "ok", log: () => {} }), (error) => {
    assert.equal(error.record.outcome, "not-started");
    return true;
  });
  assert.ok(!calls.some((call) => call.startsWith("POST")));
});

test("the API client refuses to run without credentials and reports Cloudflare's errors", async () => {
  assert.throws(() => cloudflareApi({ token: "", accountId: "f".repeat(32) }), /required/);
  const api = cloudflareApi({
    token: "t",
    accountId: "f".repeat(32),
    fetch: async (url, init) => {
      assert.match(url, /\/workers\/scripts\/chemistry-sketcher-client\/deployments$/);
      assert.equal(init.headers.Authorization, "Bearer t");
      return new Response(
        JSON.stringify({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }),
        { status: 403 },
      );
    },
  });
  await assert.rejects(api("GET", "/deployments"), /403 10000 Authentication error/);
});
