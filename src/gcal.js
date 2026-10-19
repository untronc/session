// Google カレンダー（運用者のアカウント）。空き（freeBusy）を見る・予定を入れる・Meet の URL を付ける・動かす・消す（基本設計書 4節）
// 予定の題や中身は読まない。お客様の名前とメールは予定に書かない。お客様を参加者に入れない
// 許可は、運用者が1回ログインして得た更新トークン（Worker の秘密の値 GOOGLE_CAL_REFRESH_TOKEN）。クライアントは宿泊の予約システムとは別のプロジェクト（GOOGLE_CAL_CLIENT_ID・GOOGLE_CAL_CLIENT_SECRET）
// 秘密の値が無いとき（手元・テスト環境を用意する前）は null を返す。呼ぶ側は「カレンダー無し」として動き、記録に残す
import { formatLocal, toRfc3339 } from "./calc.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

export function googleCalendar(env, fetcher = fetch) {
  if (!env.GOOGLE_CAL_REFRESH_TOKEN || !env.GOOGLE_CAL_CLIENT_ID || !env.GOOGLE_CAL_CLIENT_SECRET) return null;
  let token = null, until = 0;

  async function accessToken() {
    if (token && Date.now() < until) return token;
    const res = await fetcher(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: env.GOOGLE_CAL_CLIENT_ID, client_secret: env.GOOGLE_CAL_CLIENT_SECRET, refresh_token: env.GOOGLE_CAL_REFRESH_TOKEN, grant_type: "refresh_token" }),
    });
    if (!res.ok) {
      let why = "";
      try { why = String((await res.json()).error || "").replace(/[^\w.-]/g, "").slice(0, 40); } catch {}
      throw new Error("Google カレンダーの許可が切れています（" + (why || res.status) + "）");
    }
    const j = await res.json();
    token = j.access_token;
    until = Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60000;
    return token;
  }
  async function call(method, path, body) {
    const res = await fetcher(API + path, {
      method,
      headers: { Authorization: "Bearer " + (await accessToken()), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204 || (method === "DELETE" && (res.status === 404 || res.status === 410))) return null;
    if (!res.ok) throw new Error("Google カレンダー " + res.status + "：" + (await res.text()).slice(0, 200));
    return res.json();
  }
  const evPath = (calendarId, id = "") => "/calendars/" + encodeURIComponent(calendarId) + "/events" + (id ? "/" + encodeURIComponent(id) : "");

  return {
    /** 予定がある時間 [{start, end}]（日本時間の形）。見るカレンダーが空なら [] */
    async busy(calendarIds, fromLocal, toLocal) {
      if (!calendarIds.length) return [];
      const j = await call("POST", "/freeBusy", { timeMin: toRfc3339(fromLocal), timeMax: toRfc3339(toLocal), timeZone: "Asia/Tokyo", items: calendarIds.map((id) => ({ id })) });
      const out = [];
      for (const id of calendarIds) {
        const c = j.calendars?.[id];
        if (c?.errors?.length) throw new Error("カレンダー " + id + " の空きが読めません（" + c.errors[0].reason + "）");
        for (const b of c?.busy || []) out.push({ start: formatLocal(new Date(b.start)), end: formatLocal(new Date(b.end)) });
      }
      return out;
    },
    /** 予定を入れる。返すのは予定の ID */
    async create(calendarId, { summary, start, end }) {
      const j = await call("POST", evPath(calendarId), { summary, start: { dateTime: toRfc3339(start), timeZone: "Asia/Tokyo" }, end: { dateTime: toRfc3339(end), timeZone: "Asia/Tokyo" } });
      return j.id;
    },
    /** 予定に Meet の URL を付けて、URL を返す（作るのが遅れて返らなければ、もう一度読む） */
    async addMeet(calendarId, eventId) {
      let j = await call("PATCH", evPath(calendarId, eventId) + "?conferenceDataVersion=1", { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } });
      for (let i = 0; i < 3 && !j.hangoutLink; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        j = await call("GET", evPath(calendarId, eventId));
      }
      if (!j.hangoutLink) throw new Error("Meet の URL が作られませんでした");
      return j.hangoutLink;
    },
    async move(calendarId, eventId, { start, end }) {
      await call("PATCH", evPath(calendarId, eventId), { start: { dateTime: toRfc3339(start), timeZone: "Asia/Tokyo" }, end: { dateTime: toRfc3339(end), timeZone: "Asia/Tokyo" } });
    },
    /** 予定の題を変える（仮押さえ → 予約） */
    async retitle(calendarId, eventId, summary) {
      await call("PATCH", evPath(calendarId, eventId), { summary });
    },
    async remove(calendarId, eventId) {
      await call("DELETE", evPath(calendarId, eventId));
    },
    /** 運用者が見るカレンダーを選ぶための一覧（ID と名前だけ） */
    async list() {
      const j = await call("GET", "/users/me/calendarList?minAccessRole=freeBusyReader");
      return (j.items || []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: !!c.primary }));
    },
  };
}
