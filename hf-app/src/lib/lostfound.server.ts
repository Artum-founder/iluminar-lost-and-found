// Lost & found API: claims, bin votes and item statuses in the site's D1 database.
// Public reads never include contact details; those are only returned to the crew.
import type { D1Database } from "@cloudflare/workers-types";
import { bindings } from "./bindings.server";
import { ITEM_TAGS } from "./page-html";

const TAGS: ReadonlySet<string> = new Set<string>(ITEM_TAGS);
const MAX_BODY = 8000;
const CLAIMS_PER_HOUR = 30;

type Body = Record<string, unknown>;

type PublicClaimRow = {
  id: string;
  tag: string;
  type: string;
  wish: string;
  name: string;
  how: string;
  note: string;
  at: number;
};

type CrewClaimRow = PublicClaimRow & {
  contact: string;
  owner: string;
  ownerContact: string;
};

type VoteRow = { tag: string; bin: number | null; keep: number | null };
type StatusRow = { tag: string; status: string };
type CountRow = { n: number | null };
type HashRow = { hash: string };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

async function readJson(request: Request): Promise<Body | null> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return null;
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Body) : null;
  } catch {
    return null;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.byteLength !== eb.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < ea.byteLength; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

async function isCrew(request: Request, db: D1Database): Promise<boolean> {
  const key = request.headers.get("x-crew-key") ?? "";
  if (key.length < 12 || key.length > 200) return false;
  const hash = await sha256Hex(key.trim());
  const rows = await db.prepare("SELECT hash FROM crew_keys").all<HashRow>();
  let ok = false;
  for (const row of rows.results ?? []) {
    if (constantTimeEqual(hash, row.hash)) ok = true;
  }
  return ok;
}

async function voteCounts(db: D1Database, tag?: string): Promise<Record<string, { bin: number; keep: number }>> {
  const sql =
    "SELECT tag, SUM(CASE WHEN vote = 'bin' THEN 1 ELSE 0 END) AS bin, " +
    "SUM(CASE WHEN vote = 'keep' THEN 1 ELSE 0 END) AS keep FROM votes" +
    (tag ? " WHERE tag = ?" : "") +
    " GROUP BY tag";
  const stmt = tag ? db.prepare(sql).bind(tag) : db.prepare(sql);
  const rows = await stmt.all<VoteRow>();
  const out: Record<string, { bin: number; keep: number }> = {};
  for (const row of rows.results ?? []) out[row.tag] = { bin: Number(row.bin ?? 0), keep: Number(row.keep ?? 0) };
  return out;
}

async function statuses(db: D1Database): Promise<Record<string, string>> {
  const rows = await db.prepare("SELECT tag, status FROM item_status").all<StatusRow>();
  const out: Record<string, string> = {};
  for (const row of rows.results ?? []) out[row.tag] = row.status;
  return out;
}

async function publicState(db: D1Database) {
  const claims = await db
    .prepare(
      "SELECT id, tag, type, wish, name, how, CASE WHEN type = 'want' THEN note ELSE '' END AS note, created_at AS at " +
        "FROM claims WHERE hidden = 0 ORDER BY created_at",
    )
    .all<PublicClaimRow>();
  return { claims: claims.results ?? [], votes: await voteCounts(db), status: await statuses(db) };
}

async function crewState(db: D1Database) {
  const claims = await db
    .prepare(
      "SELECT id, tag, type, wish, name, how, note, contact, owner, owner_contact AS ownerContact, created_at AS at " +
        "FROM claims WHERE hidden = 0 ORDER BY created_at DESC",
    )
    .all<CrewClaimRow>();
  return { claims: claims.results ?? [], votes: await voteCounts(db), status: await statuses(db) };
}

async function postClaim(request: Request, db: D1Database): Promise<Response> {
  const body = await readJson(request);
  if (!body) return json({ error: "Bad request" }, 400);
  // Honeypot field: real visitors never fill it in.
  if (str(body.website, 200)) return json({ ok: true, id: crypto.randomUUID() });

  const tag = str(body.tag, 12);
  if (!TAGS.has(tag)) return json({ error: "Unknown item" }, 400);
  const type = oneOf(body.type, ["mine", "know", "want"] as const, "mine");
  const wish = type === "mine" ? oneOf(body.wish, ["back", "donate", "none"] as const, "back") : "";
  const how = type === "know" ? oneOf(body.how, ["tell", "crew"] as const, "tell") : "";
  const name = str(body.name, 60);
  const contact = str(body.contact, 120);
  const owner = str(body.owner, 80);
  const ownerContact = how === "crew" ? str(body.ownerContact, 120) : "";
  const note = str(body.note, 300);

  if (type === "mine" && !name) return json({ error: "Name missing" }, 400);
  if (type === "mine" && wish === "back" && !contact) return json({ error: "Contact missing" }, 400);
  if (type === "know" && !owner) return json({ error: "Owner missing" }, 400);
  if (type === "know" && how === "crew" && !ownerContact) return json({ error: "Owner contact missing" }, 400);
  if (type === "want" && (!name || !contact)) return json({ error: "Name or contact missing" }, 400);

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const ipHash = await sha256Hex("lost-and-found:" + ip);
  const now = Date.now();
  const recent = await db
    .prepare("SELECT COUNT(*) AS n FROM claims WHERE ip_hash = ? AND created_at > ?")
    .bind(ipHash, now - 3600_000)
    .first<CountRow>();
  if (Number(recent?.n ?? 0) >= CLAIMS_PER_HOUR) return json({ error: "Too many claims" }, 429);

  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO claims (id, tag, type, wish, name, contact, owner, how, owner_contact, note, ip_hash, hidden, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
    )
    .bind(id, tag, type, wish, name, type === "know" ? "" : contact, owner, how, ownerContact, note, ipHash, now)
    .run();
  return json({ ok: true, id });
}

async function postVote(request: Request, db: D1Database): Promise<Response> {
  const body = await readJson(request);
  if (!body) return json({ error: "Bad request" }, 400);
  const tag = str(body.tag, 12);
  if (!TAGS.has(tag)) return json({ error: "Unknown item" }, 400);
  const vote = oneOf(body.vote, ["bin", "keep", "none"] as const, "none");
  const voter = str(body.voter, 64);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(voter)) return json({ error: "Bad voter" }, 400);

  if (vote === "none") {
    await db.prepare("DELETE FROM votes WHERE tag = ? AND voter = ?").bind(tag, voter).run();
  } else {
    await db
      .prepare(
        "INSERT INTO votes (tag, voter, vote, created_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(tag, voter) DO UPDATE SET vote = excluded.vote, created_at = excluded.created_at",
      )
      .bind(tag, voter, vote, Date.now())
      .run();
  }
  const counts = await voteCounts(db, tag);
  return json({ ok: true, votes: counts[tag] ?? { bin: 0, keep: 0 } });
}

async function setStatus(request: Request, db: D1Database): Promise<Response> {
  const body = await readJson(request);
  if (!body) return json({ error: "Bad request" }, 400);
  const tag = str(body.tag, 12);
  if (!TAGS.has(tag)) return json({ error: "Unknown item" }, 400);
  const status = oneOf(body.status, ["going", "home", "rescued", "free", "clear"] as const, "clear");
  if (status === "clear") {
    await db.prepare("DELETE FROM item_status WHERE tag = ?").bind(tag).run();
  } else {
    await db
      .prepare(
        "INSERT INTO item_status (tag, status, updated_at) VALUES (?, ?, ?) " +
          "ON CONFLICT(tag) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at",
      )
      .bind(tag, status, Date.now())
      .run();
  }
  return json({ ok: true });
}

async function hideClaim(request: Request, db: D1Database): Promise<Response> {
  const body = await readJson(request);
  if (!body) return json({ error: "Bad request" }, 400);
  const id = str(body.id, 64);
  if (!id) return json({ error: "Bad request" }, 400);
  await db.prepare("UPDATE claims SET hidden = 1 WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

/** Handles /api/* for the lost and found. Returns null for paths it does not own. */
export async function handleLostFoundApi(request: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/")) return null;
  const db = bindings().DB;
  if (!db) return json({ error: "Database not ready" }, 503);
  const path = url.pathname;
  const method = request.method;
  try {
    if (path === "/api/state" && method === "GET") return json(await publicState(db));
    if (path === "/api/claim" && method === "POST") return await postClaim(request, db);
    if (path === "/api/vote" && method === "POST") return await postVote(request, db);
    if (path === "/api/crew" || path.startsWith("/api/crew/")) {
      if (!(await isCrew(request, db))) return json({ error: "Wrong crew key" }, 401);
      if (path === "/api/crew" && method === "GET") return json(await crewState(db));
      if (path === "/api/crew/status" && method === "POST") return await setStatus(request, db);
      if (path === "/api/crew/claim-delete" && method === "POST") return await hideClaim(request, db);
    }
    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error("lost-and-found api error", err instanceof Error ? err.message : "unknown");
    return json({ error: "Something went wrong" }, 500);
  }
}
