/**
 * Cloudflare Worker that proxies the Cub Scouts calendar between the static
 * site and a private GitHub Gist.
 *
 *   GET  /         -> returns the calendar JSON  (public, no auth)
 *   POST /verify   -> { password }               -> 200 if correct, else 401
 *   POST /         -> { password, data }         -> writes data to the Gist
 *
 * The GitHub token and the editor password live here as secrets, never in the
 * frontend. Configure these (see worker/README.md):
 *   Secrets : GITHUB_TOKEN, ADMIN_PASSWORD
 *   Vars    : GIST_ID, GIST_FILENAME (default "calendar.json"),
 *             ALLOWED_ORIGIN (your Pages origin, or "*" )
 */

const GITHUB_API = "https://api.github.com";

// ALLOWED_ORIGIN may be "*" or a comma-separated allowlist of origins. When it
// is an allowlist we echo back the caller's Origin if it matches.
function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGIN || "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let allow = "*";
  if (!allowed.includes("*")) {
    const origin = request.headers.get("Origin");
    allow = origin && allowed.includes(origin) ? origin : allowed[0];
  }
  return {
    "Access-Control-Allow-Origin": allow,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...corsHeaders(request, env),
    },
  });
}

/** Length-safe-ish string comparison to avoid trivial timing leaks. */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function githubHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "scouts-calendar-worker",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function readGist(env) {
  const filename = env.GIST_FILENAME || "calendar.json";
  const res = await fetch(`${GITHUB_API}/gists/${env.GIST_ID}`, {
    headers: githubHeaders(env),
  });
  if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
  const gist = await res.json();
  const file = gist.files?.[filename];
  if (!file) return { categories: [], events: [] };
  // Large files may be truncated; fetch the raw_url in that case.
  const content = file.truncated
    ? await (await fetch(file.raw_url, { headers: githubHeaders(env) })).text()
    : file.content;
  try {
    return JSON.parse(content);
  } catch {
    return { categories: [], events: [] };
  }
}

async function writeGist(env, data) {
  const filename = env.GIST_FILENAME || "calendar.json";
  const res = await fetch(`${GITHUB_API}/gists/${env.GIST_ID}`, {
    method: "PATCH",
    headers: { ...githubHeaders(env), "content-type": "application/json" },
    body: JSON.stringify({
      files: { [filename]: { content: JSON.stringify(data, null, 2) } },
    }),
  });
  if (!res.ok) throw new Error(`GitHub write failed (${res.status})`);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);

    try {
      if (request.method === "GET") {
        return json(await readGist(env), 200, request, env);
      }

      if (request.method === "POST") {
        const body = await request.json().catch(() => ({}));

        if (!safeEqual(body.password, env.ADMIN_PASSWORD)) {
          return json({ error: "Unauthorized" }, 401, request, env);
        }

        if (url.pathname.replace(/\/$/, "") === "/verify") {
          return json({ ok: true }, 200, request, env);
        }

        if (!body.data || typeof body.data !== "object") {
          return json({ error: "Missing data" }, 400, request, env);
        }
        await writeGist(env, body.data);
        return json({ ok: true }, 200, request, env);
      }

      return json({ error: "Method not allowed" }, 405, request, env);
    } catch (err) {
      return json({ error: String(err?.message || err) }, 502, request, env);
    }
  },
};
