// Worker の入口。施設の設定を受け取って、fetch と scheduled を返す
//   /                    予約画面（page.js。紙芝居の形）
//   /api                 予約画面の API（api.js）
//   /admin               管理画面（ログインしていなければ Google のログインへ）。画面はまだ（次の段で、宿泊の予約システムの管理画面を写して作る）
//   /admin/login・/admin/callback・/admin/logout
//   /admin/api/...       管理画面の API（admin.js）
import { handleAdminApi } from "./admin.js";
import { handleApi } from "./api.js";
import { admit, clearStateCookie, currentUser, finishLogin, logoutCookie, startLogin } from "./auth.js";
import { CRON_REMIND, dailyJobs, remindJobs } from "./cron.js";
import { googleCalendar } from "./gcal.js";
import { bookingPage } from "./page.js";

const SECURITY = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'",
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const html = (body, status = 200, extra = {}) => new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...SECURITY, ...extra } });
const message = (site, text) => `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(site.name)}</title><body style="font-family:system-ui,sans-serif;padding:24px"><p>${esc(text)}</p><p><a href="/admin">管理画面へ</a></p></body></html>`;

/**
 * opts.now：「今」を返す関数（単体テストで日付を決めるため）
 * opts.calendar：env から Google カレンダーを作る関数（単体テストで偽物に差し替えるため。ふだんは gcal.js）
 */
export function createWorker(site, opts = {}) {
  const clock = opts.now || (() => new Date());
  const calendarOf = opts.calendar || ((env) => googleCalendar(env));
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      // 送受信は HTTPS だけ。HTTP で来たら、読むだけのものは HTTPS へ移し、書き込みは断る
      if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
        if (request.method === "GET" || request.method === "HEAD") {
          url.protocol = "https:";
          return new Response(null, { status: 301, headers: { Location: url.toString() } });
        }
        return new Response("HTTPS only", { status: 403 });
      }
      const res = await route(request, env, url);
      const h = new Headers(res.headers);
      h.set("Strict-Transport-Security", "max-age=31536000");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    },
    async scheduled(event, env, ctx) {
      ctx.waitUntil(event.cron === CRON_REMIND ? remindJobs(site, env, clock()) : dailyJobs(site, env, clock()));
    },
  };

  async function route(request, env, url) {
    const p = url.pathname;
    if (p === "/") {
      // 予約画面は Google Fonts（Noto Sans JP）を読む
      const csp = SECURITY["Content-Security-Policy"].replace("style-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com");
      return html(bookingPage(site), 200, { "Content-Security-Policy": csp });
    }
    if (p === "/api") return handleApi(site, request, env, clock(), calendarOf(env));
    if (p === "/admin/login") return startLogin(site, env, url.searchParams.get("next"));
    if (p === "/admin/callback") {
      const who = await finishLogin(site, env, request);
      if (who.error) return html(message(site, who.error), 400, { "Set-Cookie": clearStateCookie() });
      const c = await admit(site, env, who);
      if (!c) return html(message(site, "このアカウント（" + who.email + "）では使えません。"), 403, { "Set-Cookie": clearStateCookie() });
      const h = new Headers({ Location: who.next, "Cache-Control": "no-store" });
      h.append("Set-Cookie", c);
      h.append("Set-Cookie", clearStateCookie());
      return new Response(null, { status: 302, headers: h });
    }
    if (p === "/admin/logout") return html(message(site, "ログアウトしました。"), 200, { "Set-Cookie": logoutCookie() });
    if (p === "/admin" || p.startsWith("/admin/")) {
      const user = await currentUser(site, env, request);
      if (p.startsWith("/admin/api/")) {
        if (!user) return new Response(JSON.stringify({ ok: false, error: "login" }), { status: 401, headers: { "Content-Type": "application/json; charset=utf-8" } });
        return handleAdminApi(site, env, request, user, clock(), calendarOf(env));
      }
      if (!user) return new Response(null, { status: 302, headers: { Location: "/admin/login?next=" + encodeURIComponent(p) } });
      return html(message(site, "管理画面は準備中です（API は動いています）。"));
    }
    return new Response("Not found", { status: 404 });
  }
}
