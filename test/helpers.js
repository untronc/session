// テストで使うもの：架空の店の設定、決まった「今」、表を空にする、ログインの Cookie、偽物の Google カレンダー、メールの記録
import { env } from "cloudflare:test";
import { vi } from "vitest";
import { sign } from "../src/auth.js";
import { createWorker } from "../src/worker.js";
import site from "./site.fixture.js";

export { site };
// 2026-10-19（月）12:00 日本時間
export const NOW = new Date("2026-10-19T03:00:00Z");
export const ORIGIN = "https://s.example.jp";

export async function reset() {
  // FK があるので、指す側の表から先に消す
  for (const t of ["booking_changes", "slot_changes", "payments", "bookings", "slots", "slot_rules", "courses", "services", "settings", "admin_users", "daily_counts", "access_log"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
}

/** 偽物の Google カレンダー。予定（events）と、外の予定（busy）を持つ。busy には入れた予定も出る（本物と同じ） */
export function fakeCalendar(outside = []) {
  const events = new Map();
  let n = 0;
  return {
    events,
    outside,
    async busy(ids, from, to) {
      if (!ids.length) return [];
      return [...outside, ...[...events.values()].map((e) => ({ start: e.start, end: e.end }))].filter((b) => b.start < to && b.end > from);
    },
    async create(_cid, { summary, start, end }) {
      const id = "ev" + ++n;
      events.set(id, { summary, start, end });
      return id;
    },
    async addMeet(_cid, id) {
      const e = events.get(id);
      e.meet = "https://meet.google.com/aaa-bbbb-" + id;
      return e.meet;
    },
    async move(_cid, id, { start, end }) { Object.assign(events.get(id), { start, end }); },
    async retitle(_cid, id, summary) { events.get(id).summary = summary; },
    async remove(_cid, id) { events.delete(id); },
    async list() { return [{ id: "primary", name: "運用者", primary: true }]; },
  };
}

/** Resend への送信を記録する（本物には送らない） */
export function catchMail() {
  const sent = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).startsWith("https://api.resend.com/")) {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: "m" + sent.length }), { status: 200 });
    }
    throw new Error("想定していない通信：" + url);
  });
  return sent;
}

export function makeWorker(cal, now = NOW) {
  return createWorker(site, { now: () => now, calendar: () => cal });
}

/** 管理画面の利用者を1人入れて、ログインの Cookie を返す */
export async function login(email = "operator@example.com", sub = "sub-op", name = "運用者") {
  const at = new Date().toISOString();
  await env.DB.prepare("INSERT INTO admin_users (id, email, google_sub, display_name, active, created_at, created_by, updated_at, updated_by) VALUES (?,?,?,?,1,?,?,?,?)")
    .bind(crypto.randomUUID(), email, sub, name, at, sub, at, sub)
    .run();
  return "ybk_s=" + encodeURIComponent(await sign(env.SESSION_SECRET, { sub, exp: Date.now() + 3600000 }));
}

/** 管理画面の API を呼ぶ */
export async function admin(worker, cookie, path, body) {
  const init = body === undefined ? { headers: { Cookie: cookie } } : { method: "POST", headers: { Cookie: cookie, Origin: ORIGIN }, body: JSON.stringify(body) };
  return (await worker.fetch(new Request(ORIGIN + "/admin/api/" + path, init), env)).json();
}

/** 予約画面の API */
export async function api(worker, query) {
  return (await worker.fetch(new Request(ORIGIN + "/api?" + query), env)).json();
}
export async function bookApi(worker, body) {
  return (await worker.fetch(new Request(ORIGIN + "/api", { method: "POST", headers: { Origin: ORIGIN }, body: JSON.stringify({ action: "book", ...body }) }), env)).json();
}

/** セッション1つ（90分）とコース2つを入れる */
export async function seedCatalog(worker, cookie) {
  const s = await admin(worker, cookie, "service", { name: "試験のセッション", minutes: 90, surveyUrl: "https://forms.example.jp/survey", sortOrder: 1 });
  const a = await admin(worker, cookie, "course", { serviceId: s.id, name: "インストール付き", description: "一緒に入れる", price: 6600, sortOrder: 1 });
  const b = await admin(worker, cookie, "course", { serviceId: s.id, name: "QA付き", description: "質問の時間", price: 6600, sortOrder: 2 });
  return { serviceId: s.id, courseA: a.id, courseB: b.id };
}
