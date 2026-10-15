import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyRelease } from "./verify-release.mjs";

// Puts one uploaded version of the site's Worker live, proves it on every
// origin, and puts the previous version back when it cannot (decision 257).
//
//   node scripts/worker-release.mjs deploy <commit> [<version-id>]
//
// The build job uploads a version tagged with its commit and never activates
// it. This is the activation: on a push it gets the build's version id; on a
// dispatch it gets only a commit and picks the newest deployable version
// tagged with it, which is also how an earlier release is put back. Either
// way the version's tag must name the commit, so a mismatched pair fails
// before anything changes.
//
// A version keeps its own assets, so the previous one is a complete
// rollback. It is put back only when the new one fails verification, and the
// run still fails. A failure before the deployment changes nothing.
//
// Needs CLOUDFLARE_API_TOKEN (the Worker's own Editor token) and
// CLOUDFLARE_ACCOUNT_ID. It never handles routes: those were made by hand
// and the token cannot change them.

export const WORKER = "chemistry-sketcher-client";
const COMMIT = /^[a-f0-9]{40}$/;
const VERSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Deployments can only name the last 100 uploaded versions.
const MAX_VERSIONS = 100;

export function cloudflareApi({ token, accountId, fetch: request = fetch }) {
  if (!token || !/^[0-9a-f]{32}$/.test(accountId ?? "")) {
    throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required.");
  }
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER}`;
  return async (method, path, body) => {
    const response = await request(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || json?.success !== true) {
      const errors = (json?.errors ?? []).map((e) => `${e.code} ${e.message}`).join("; ");
      throw new Error(`Cloudflare ${method} ${path} answered ${response.status} ${errors}`.trim());
    }
    return json.result;
  };
}

const tagOf = (version) => version?.annotations?.["workers/tag"];

/** The version to activate, checked against the commit it must carry. */
export async function findVersion(api, commit, versionId) {
  if (!COMMIT.test(commit ?? "")) throw new Error("Expected a full lowercase Git commit SHA.");
  if (versionId) {
    if (!VERSION.test(versionId)) throw new Error(`${versionId} is not a Worker version id.`);
    const version = await api("GET", `/versions/${versionId}`);
    if (tagOf(version) !== commit) {
      throw new Error(`Version ${versionId} is tagged ${tagOf(version) ?? "nothing"}, not ${commit}.`);
    }
    return versionId;
  }
  // `deployable=true` returns every deployable version and ignores pagination.
  const { items = [] } = await api("GET", "/versions?deployable=true");
  for (const item of items.slice(0, MAX_VERSIONS)) {
    // The list may leave annotations out; the single read has them.
    const version = item.annotations ? item : await api("GET", `/versions/${item.id}`);
    if (tagOf(version) === commit) return item.id;
  }
  throw new Error(`No deployable version of ${WORKER} is tagged ${commit}; build it first.`);
}

/** The single version serving 100% now, or null for none or a split. */
export async function liveVersion(api) {
  const { deployments = [] } = await api("GET", "/deployments");
  const versions = deployments[0]?.versions ?? [];
  return versions.length === 1 && versions[0].percentage === 100 ? versions[0].version_id : null;
}

function activate(api, versionId, message) {
  return api("POST", "/deployments", {
    strategy: "percentage",
    versions: [{ version_id: versionId, percentage: 100 }],
    annotations: { "workers/message": message },
  });
}

const reason = (error) => (error instanceof Error ? error.message : String(error));

export async function release(
  commit,
  versionId,
  { api, verify = verifyRelease, log = console.log } = {},
) {
  // One record, updated at every step and attached to whatever is thrown, so
  // rollout.json always says what is serving, not just what failed last.
  const record = { commit, version: versionId ?? null, previous: null, outcome: "not-started" };
  const fail = (message) => Object.assign(new Error(message), { record });

  try {
    record.version = await findVersion(api, commit, versionId);
    record.previous = await liveVersion(api);
  } catch (error) {
    record.failure = reason(error);
    throw fail(record.failure);
  }
  const { version: target, previous } = record;

  try {
    await activate(api, target, `release ${commit}`);
  } catch (error) {
    // A lost answer does not mean the deployment was refused: read back what
    // serves now, and leave the decision to a person.
    record.outcome = "activation-unknown";
    record.failure = reason(error);
    record.live = await liveVersion(api).catch(() => null);
    throw fail(`Activating ${target} did not confirm (${record.failure}). Serving now: ${record.live ?? "unknown"}.`);
  }
  record.outcome = "activated";
  log(`${WORKER}: ${target} (${commit}) serves 100%; previous ${previous ?? "unknown"}`);

  try {
    record.verification = await verify(commit);
    record.outcome = "verified";
    return record;
  } catch (error) {
    record.failure = reason(error);
  }
  if (previous === null || previous === target) {
    record.outcome = "failed-no-rollback";
    throw fail(`${record.failure} No earlier version to put back; ${target} still serves.`);
  }
  try {
    await activate(api, previous, `rollback: ${commit} failed verification`);
  } catch (error) {
    record.outcome = "rollback-failed";
    record.live = await liveVersion(api).catch(() => null);
    throw fail(
      `${record.failure} Putting ${previous} back failed (${reason(error)}). Serving now: ${record.live ?? "unknown"}.`,
    );
  }
  record.live = await liveVersion(api).catch(() => null);
  record.outcome = record.live === previous ? "rolled-back" : "rollback-unconfirmed";
  throw fail(
    record.outcome === "rolled-back"
      ? `${record.failure} Put ${previous} back; it serves 100% again.`
      : `${record.failure} Asked for ${previous} back, but ${record.live ?? "an unknown version"} serves.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, commit, versionId] = process.argv.slice(2);
  let record = { commit, version: versionId ?? null, outcome: "not-started" };
  try {
    if (command !== "deploy") throw new Error("usage: worker-release.mjs deploy <commit> [<version-id>]");
    const api = cloudflareApi({
      token: process.env.CLOUDFLARE_API_TOKEN,
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    });
    record = await release(commit, versionId || undefined, { api });
  } catch (error) {
    record = error?.record ?? { ...record, failure: error?.message };
    console.error(error instanceof Error ? error.message : "Worker release failed.");
    process.exitCode = 1;
  } finally {
    writeFileSync("rollout.json", `${JSON.stringify(record, null, 2)}\n`);
  }
}
