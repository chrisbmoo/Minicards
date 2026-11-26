/*
 * Card manager API  —  /admin/api/cards  (called from worker/index.js)
 *
 * GET  → current cards.json (+ its version) and the signed-in editor's email
 * PUT  → save cards.json and any newly uploaded images as one GitHub commit;
 *        Cloudflare Pages then rebuilds and redeploys the site.
 *
 * Every request must carry a valid Cloudflare Access login (Cf-Access-Jwt-Assertion header).
 * Requests without one are refused, even if Access is misconfigured.
 *
 * Environment variables (Worker → Settings → Variables and secrets):
 *   GITHUB_TOKEN        fine-grained token, Contents: read & write on the repo   (secret)
 *   GITHUB_REPO         e.g. chrisbmoo/minicards
 *   GITHUB_BRANCH       e.g. main
 *   ACCESS_TEAM_DOMAIN  e.g. moomedia.cloudflareaccess.com
 *   ACCESS_AUD          the Access application's "Application Audience (AUD) tag"
 */

const CATEGORIES = ["see-and-do", "eat-and-drink", "shopping", "culture", "various"];
const UPLOAD_PATH = /^wp-content\/uploads\/cards\/[a-z0-9][a-z0-9-]*\.(jpg|jpeg|png|webp)$/;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_CARDS = 300;

// ---------------------------------------------------------------- helpers
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const b64urlToJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------- Cloudflare Access
let certCache = { at: 0, keys: null, team: null };

async function accessKeys(team) {
  if (certCache.keys && certCache.team === team && Date.now() - certCache.at < 10 * 60 * 1000) return certCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error("Could not load Access certificates");
  const { keys } = await r.json();
  certCache = { at: Date.now(), keys, team };
  return keys;
}

/** Returns the signed-in email, or null if the request has no valid Access login. */
export async function verifyAccess(request, env) {
  const team = (env.ACCESS_TEAM_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const aud = env.ACCESS_AUD || "";
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!team || !aud || !token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = b64urlToJson(parts[0]);
    payload = b64urlToJson(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;

  const jwk = (await accessKeys(team)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;
  if (payload.iss !== `https://${team}`) return null;
  if (!payload.exp || payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;
  return payload.email || null;
}

// ---------------------------------------------------------------- GitHub
function gh(env) {
  const repo = env.GITHUB_REPO, branch = env.GITHUB_BRANCH || "main";
  if (!env.GITHUB_TOKEN || !repo) throw new Error("GitHub is not configured (GITHUB_TOKEN / GITHUB_REPO)");
  const call = async (method, url, body) => {
    const r = await fetch(`https://api.github.com/repos/${repo}${url}`, {
      method,
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "minicards-card-manager",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = r.status === 204 ? null : await r.json().catch(() => null);
    if (!r.ok) {
      const err = new Error(`GitHub ${method} ${url}: ${r.status} ${data && data.message ? data.message : ""}`);
      err.status = r.status;
      throw err;
    }
    return data;
  };
  return { call, branch };
}

async function readCards(env) {
  const { call, branch } = gh(env);
  const f = await call("GET", `/contents/cards.json?ref=${encodeURIComponent(branch)}`);
  return { data: JSON.parse(b64ToUtf8(f.content)), sha: f.sha };
}

// ---------------------------------------------------------------- validation
function cleanCards(cards, uploadedSrcs, knownSrcs) {
  if (!Array.isArray(cards) || cards.length > MAX_CARDS) throw new Error("Card list is missing or too long");
  const slugs = new Set(), ids = new Set();
  const img = (v, label, required) => {
    if (v == null) {
      if (required) throw new Error(`${label} is missing`);
      return null;
    }
    const src = String(v.src || "");
    if (!/^\/wp-content\/uploads\/[\w\-./]+\.(jpe?g|png|webp|gif)$/i.test(src) || src.includes(".."))
      throw new Error(`${label} has an invalid image path`);
    if (!uploadedSrcs.has(src) && !knownSrcs.has(src))
      throw new Error(`${label} was not uploaded — please choose the image again`);
    const w = Number(v.width) || null, h = Number(v.height) || null;
    return { src, width: w, height: h };
  };
  return cards.map((c, i) => {
    const title = String(c.title || "").trim().slice(0, 120);
    if (!title) throw new Error(`Card ${i + 1} needs a title`);
    const slug = String(c.slug || "");
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 80) throw new Error(`"${title}" has an invalid web address`);
    if (slugs.has(slug)) throw new Error(`Two cards use the web address "${slug}"`);
    slugs.add(slug);
    let id = Number(c.id);
    if (!Number.isInteger(id) || id <= 0 || ids.has(id)) id = null;
    if (id) ids.add(id);
    const categories = CATEGORIES.filter((x) => (c.categories || []).includes(x));
    return {
      id, slug, title,
      front: img(c.front, `Front image for "${title}"`, true),
      back: img(c.back, `Back image for "${title}"`, false),
      categories,
      hidden: !!c.hidden,
    };
  }).map((c, _, all) => {
    if (!c.id) { // give new cards a unique id
      let max = Math.max(3000, ...all.map((x) => x.id || 0), ...[...ids]);
      c.id = max + 1;
      ids.add(c.id);
    }
    return c;
  });
}

// ---------------------------------------------------------------- handlers
export async function onRequestGet({ request, env }) {
  const email = await verifyAccess(request, env);
  if (!email) return json({ error: "Not signed in" }, 401);
  try {
    const { data, sha } = await readCards(env);
    return json({ email, cards: data.cards, version: sha });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}

export async function onRequestPut({ request, env }) {
  const email = await verifyAccess(request, env);
  if (!email) return json({ error: "Not signed in" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }

  // uploads
  const uploads = Array.isArray(body.uploads) ? body.uploads : [];
  const uploadedSrcs = new Set();
  for (const u of uploads) {
    if (!UPLOAD_PATH.test(String(u.path || ""))) return json({ error: `Invalid upload path ${u.path}` }, 400);
    if (typeof u.base64 !== "string" || u.base64.length * 0.75 > MAX_UPLOAD_BYTES)
      return json({ error: `Image ${u.path} is too large (max 5 MB)` }, 400);
    uploadedSrcs.add("/" + u.path);
  }

  try {
    const { call, branch } = gh(env);
    const current = await readCards(env);
    if (body.version && body.version !== current.sha)
      return json({ error: "The cards were changed somewhere else since you opened this page. Reload to get the latest version, then make your changes again." }, 409);

    // images may only be ones already used by a card, or uploaded in this save
    const knownSrcs = new Set();
    for (const c of current.data.cards || []) for (const i of [c.front, c.back]) if (i && i.src) knownSrcs.add(i.src);
    let cards;
    try {
      cards = cleanCards(body.cards, uploadedSrcs, knownSrcs);
    } catch (e) {
      return json({ error: e.message }, 400);
    }

    const newJson = JSON.stringify({ ...current.data, cards }, null, 2) + "\n";
    const blobs = [];
    for (const u of uploads) {
      const b = await call("POST", "/git/blobs", { content: u.base64, encoding: "base64" });
      blobs.push({ path: u.path, mode: "100644", type: "blob", sha: b.sha });
    }
    const jb = await call("POST", "/git/blobs", { content: utf8ToB64(newJson), encoding: "base64" });
    blobs.push({ path: "cards.json", mode: "100644", type: "blob", sha: jb.sha });

    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ref = await call("GET", `/git/ref/heads/${encodeURIComponent(branch)}`);
      const parent = await call("GET", `/git/commits/${ref.object.sha}`);
      const tree = await call("POST", "/git/trees", { base_tree: parent.tree.sha, tree: blobs });
      const commit = await call("POST", "/git/commits", {
        message: `Cards updated via admin by ${email}`,
        tree: tree.sha,
        parents: [ref.object.sha],
      });
      try {
        await call("PATCH", `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha, force: false });
        const after = await readCards(env).catch(() => null);
        return json({ ok: true, commit: commit.sha, version: after ? after.sha : null, cards });
      } catch (e) {
        lastErr = e;
        if (e.status !== 422) throw e; // 422 = branch moved on; retry on top of it
      }
    }
    throw lastErr;
  } catch (e) {
    return json({ error: "Saving failed: " + e.message }, 502);
  }
}

export async function onRequest({ request }) {
  return json({ error: `Method ${request.method} not allowed` }, 405);
}
