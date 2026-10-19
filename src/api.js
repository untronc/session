// 予約画面から呼ぶ API
//   GET  /api?action=slots   出しているセッション・コースと、空いている枠
//   GET  /api?action=ping
//   POST /api  本文 JSON {action:'book', courseId, slotId, name, googleEmail, contactEmail, agree, privacyAgree} / {action:'log', items:[...]}
import { book, publicSlots } from "./booking.js";

export function apiHeaders(site, origin) {
  const h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Vary: "Origin" };
  if (origin && site.allowedOrigins.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export async function handleApi(site, request, env, now, cal) {
  const origin = request.headers.get("Origin") || "";
  const headers = apiHeaders(site, origin);
  const out = (obj) => new Response(JSON.stringify(obj), { headers });
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type" } });
  }
  try {
    if (request.method === "GET") {
      const p = Object.fromEntries(new URL(request.url).searchParams);
      if (p.action === "slots") return out(await publicSlots(site, env, cal, now));
      if (p.action === "ping") return out({ ok: true, at: now.toISOString() });
      return out({ ok: false, error: "unknown action" });
    }
    if (request.method === "POST") {
      // 書き込みは、許可した住所の画面からだけ受ける
      if (!site.allowedOrigins.includes(origin)) return new Response(JSON.stringify({ ok: false, error: "forbidden" }), { status: 403, headers });
      let body;
      try { body = JSON.parse((await request.text()) || "{}"); } catch { return out({ ok: false, error: "壊れた入力です" }); }
      if (body.action === "book") return out(await book(site, env, cal, body, now));
      if (body.action === "log") return out(await log(env.DB, body, now));
      return out({ ok: false, error: "unknown action" });
    }
    return new Response("Method not allowed", { status: 405, headers });
  } catch (err) {
    // 入力のまちがいは、最初の文 error に加えて、項目ごとの文 errors も返す
    return out({ ok: false, error: String(err?.message ?? err), ...(err?.errors ? { errors: err.errors } : {}) });
  }
}

/** 操作ログ（個人情報は受け取らない。宿泊の予約システムと同じ） */
async function log(db, body, now) {
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 50);
  if (!items.length) return { ok: true, n: 0 };
  const at = now.toISOString();
  const s = (v, n) => String(v ?? "").slice(0, n);
  await db.batch(
    items.map((it) =>
      db
        .prepare("INSERT INTO access_log (id, received_at, client_at, visit_id, action, result, ms, error, detail, width, created_at, created_by, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,'guest',?,'guest')")
        .bind(crypto.randomUUID(), at, s(it.at, 30), s(it.sid, 20), s(it.ev, 20), it.ok ? "成功" : "エラー", Number(it.ms) || null, s(it.err, 300), s(it.info, 200), s(it.w, 10), at, at)
    )
  );
  return { ok: true, n: items.length };
}
