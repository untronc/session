// Google と Resend の鍵を、運用者の画面の操作1回分で Worker に入れる道具（値は画面にもファイルにも出さない。持つのはこの道具の中だけ）
//   node dev/setup-google.mjs <施設…>      施設は sites/<施設>/wrangler.jsonc の名前（例：test prod）
//
// 流れ（運用者は上から順に押すだけ。この道具は待ち受けて、来た順に入れる）
//   1. SESSION_SECRET を作って入れる
//   2. クリップボードに GOCSPX- で始まる値が来たら、GOOGLE_CLIENT_SECRET と GOOGLE_CAL_CLIENT_SECRET に入れ、クリップボードを空にする
//   3. http://localhost:8801/ を開くと Google のカレンダーの許可へ。戻ってきたら更新トークンを GOOGLE_CAL_REFRESH_TOKEN に入れ、
//      テスト用のカレンダー（この道具が作る）に予定を1つ作って Meet の URL が付くかを試し、予定を消す（基本設計書 4節の未確認）
//   4. クリップボードに re_ で始まる値が来たら、RESEND_API_KEY に入れ、クリップボードを空にする
// まだ上げていない施設（sites/<施設>/.deployed が無い）には、受け取った値をこの道具の中に持っておき、.deployed ができたら入れる
// 進み具合は dev/setup-google.log（値は書かない）。全部の施設に全部入れたか、3 時間で止まる
// wrangler に渡す Cloudflare の鍵は、環境変数 CLOUDFLARE_API_TOKEN・CLOUDFLARE_ACCOUNT_ID で渡す（Workers Scripts の編集ができる鍵）
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const LOG = `${root}dev/setup-google.log`;
const PORT = 8801, REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.app.created",
];
const TEST_CAL = "untronc-session テスト";

const sites = process.argv.slice(2);
if (!sites.length || sites.some((s) => !existsSync(`${root}sites/${s}/site.config.js`))) {
  console.log("施設（sites/ の下の名前）を1つ以上。何もしていません");
  process.exit(1);
}
const log = (m) => { const l = `${new Date().toLocaleTimeString("ja-JP")} ${m}`; console.log(l); appendFileSync(LOG, l + "\n"); };
const ver = readFileSync(`${root}.node-version`, "utf8").trim();
const node = `C:/Program Files (x86)/Nodist/v-x64/${ver}/node.exe`;
if (!process.env.CLOUDFLARE_API_TOKEN) { console.log("環境変数 CLOUDFLARE_API_TOKEN がありません。何もしていません"); process.exit(1); }
const env = process.env;
const clientId = JSON.parse(readFileSync(`${root}sites/${sites[0]}/wrangler.jsonc`, "utf8").replace(/^\s*\/\/.*$/gm, "")).vars.GOOGLE_CAL_CLIENT_ID;

const held = new Map(), done = new Set(); // 受け取った値（名前 → 値）／入れ終えた「施設:名前」
const ready = (s) => existsSync(`${root}sites/${s}/.deployed`);
function flush() {
  for (const s of sites.filter(ready)) for (const [name, value] of held) {
    if (done.has(`${s}:${name}`)) continue;
    execFileSync(node, [`${root}node_modules/wrangler/bin/wrangler.js`, "secret", "put", name, "-c", `${root}sites/${s}/wrangler.jsonc`], { input: value, env, cwd: root, stdio: ["pipe", "ignore", "pipe"] });
    done.add(`${s}:${name}`);
    log(`${name} を入れた（${s}・長さ ${value.length}）`);
  }
}
function put(name, value) {
  held.set(name, value);
  flush();
  const wait = sites.filter((s) => !ready(s));
  if (wait.length) log(`${name} を受け取った。${wait.join("・")} は上げたあとに入れる`);
}
const clip = () => execFileSync("powershell", ["-NoProfile", "-STA", "-Command", "Get-Clipboard -Raw"], { encoding: "utf8" }).trim();
const clearClip = () => execFileSync("powershell", ["-NoProfile", "-STA", "-Command", "Set-Clipboard -Value ' '"]);

let clientSecret = null, refreshDone = false, resendDone = false;

put("SESSION_SECRET", randomBytes(32).toString("base64url"));

const server = createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const page = (t) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:24px"><p>${t}</p>`); };
  if (u.pathname === "/") {
    if (!clientSecret) return page("先に、Google Cloud のクライアントのシークレットをコピーしてください（まだ受け取っていません）。");
    const q = new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent" });
    res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
    return res.end();
  }
  if (u.pathname !== "/callback") { res.writeHead(404); return res.end(); }
  if (u.searchParams.get("error")) { log(`カレンダーの許可：Google が ${u.searchParams.get("error")} を返した`); return page("許可されませんでした。もう一度 http://localhost:8801/ から。"); }
  try {
    const t = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: u.searchParams.get("code"), client_id: clientId, client_secret: clientSecret, redirect_uri: REDIRECT, grant_type: "authorization_code" }) })).json();
    if (!t.refresh_token) { log(`カレンダーの許可：更新トークンが来なかった（${t.error || "refresh_token なし"}）`); return page("うまくいきませんでした。Claude に伝えてください。"); }
    const granted = String(t.scope || "").split(" ");
    log(`カレンダーの許可：範囲 ${SCOPES.filter((s) => granted.includes(s)).length}/${SCOPES.length}`);
    put("GOOGLE_CAL_REFRESH_TOKEN", t.refresh_token);
    refreshDone = true;
    page("カレンダーの許可を受け取りました。この画面は閉じてかまいません。");
    await tryMeet(t.access_token);
  } catch (e) { log(`カレンダーの許可：${e.message}`); page("うまくいきませんでした。Claude に伝えてください。"); }
  finish();
});
server.listen(PORT, "127.0.0.1", () => log(`待ち受け開始（${sites.join("・")}）。http://localhost:${PORT}/`));

// テスト用のカレンダーで、予定を作って Meet の URL が付くかを試し、予定を消す（カレンダーはテスト環境で使うので残す）
async function tryMeet(at) {
  const api = async (method, path, body) => {
    const r = await fetch(`https://www.googleapis.com/calendar/v3${path}`, { method, headers: { Authorization: `Bearer ${at}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return r.status === 204 ? {} : r.json();
  };
  const list = await api("GET", "/users/me/calendarList?minAccessRole=owner");
  let cal = (list.items || []).find((c) => c.summary === TEST_CAL);
  if (!cal) cal = await api("POST", "/calendars", { summary: TEST_CAL, timeZone: "Asia/Tokyo" });
  if (!cal.id) return log(`Meet の試し：テスト用のカレンダーを作れなかった（${JSON.stringify(cal.error?.message || cal).slice(0, 120)}）`);
  log(`テスト用のカレンダー「${TEST_CAL}」：${cal.id}`);
  const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const ev = await api("POST", `/calendars/${encodeURIComponent(cal.id)}/events?conferenceDataVersion=1`, {
    summary: "【試し】Meet の URL", start: { dateTime: `${day}T10:00:00+09:00` }, end: { dateTime: `${day}T11:30:00+09:00` },
    conferenceData: { createRequest: { requestId: randomBytes(8).toString("hex"), conferenceSolutionKey: { type: "hangoutsMeet" } } },
  });
  if (!ev.id) return log(`Meet の試し：予定を作れなかった（${JSON.stringify(ev.error?.message || ev).slice(0, 160)}）`);
  let link = ev.hangoutLink, status = ev.conferenceData?.createRequest?.status?.statusCode;
  for (let i = 0; i < 5 && !link; i++) { await new Promise((r) => setTimeout(r, 1500)); const g = await api("GET", `/calendars/${encodeURIComponent(cal.id)}/events/${ev.id}`); link = g.hangoutLink; status = g.conferenceData?.createRequest?.status?.statusCode; }
  log(link ? `Meet の試し：URL が付いた（${link.replace(/[a-z]{3}-[a-z]{4}-[a-z]{3}$/, "***")}）` : `Meet の試し：URL が付かなかった（${status || "状態なし"}）`);
  await api("DELETE", `/calendars/${encodeURIComponent(cal.id)}/events/${ev.id}`);
  log("Meet の試し：予定を消した");
}

function finish() {
  if (clientSecret && refreshDone && resendDone && done.size === sites.length * held.size) { log("全部済んだ。止まります"); clearInterval(timer); server.close(); process.exit(0); }
}
const timer = setInterval(() => {
  let v;
  try { v = clip(); } catch { return; }
  if (!clientSecret && v.startsWith("GOCSPX-") && v.length >= 20 && !/\s/.test(v)) {
    clientSecret = v; clearClip();
    put("GOOGLE_CLIENT_SECRET", v); put("GOOGLE_CAL_CLIENT_SECRET", v);
  } else if (!resendDone && v.startsWith("re_") && v.length >= 20 && !/\s/.test(v)) {
    clearClip(); put("RESEND_API_KEY", v); resendDone = true;
  }
  try { flush(); } catch (e) { log(`入れられなかった：${e.message.split("\n")[0]}`); }
  finish();
}, 1500);
setTimeout(() => { log("3 時間たったので止まります（受け取った値は捨てた）"); process.exit(2); }, 180 * 60000);
