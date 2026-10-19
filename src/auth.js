// 管理画面のログイン。Worker 自身で Google の OpenID Connect（認可コードフロー）を行う。Cloudflare Access は使わない
// 許可は施設の設定ファイルのメールアドレス（site.admins）。最初のログインで、アカウントID（sub）と Google の名前を admin_users に入れる
// ログインの状態は署名つきの Cookie（12時間）。画面を開くたびに、許可が続いているかを D1 と設定で確かめる。ログイン・閲覧の記録は持たない
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SESSION_COOKIE = "ybk_s";
const STATE_COOKIE = "ybk_o";
const SESSION_HOURS = 12;

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(24)));

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}
/** 文字の比較（かかる時間が中身で変わらないように） */
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
export async function sign(secret, obj) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(obj)));
  return body + "." + (await hmac(secret, body));
}
export async function verify(secret, token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig || !sameText(sig, await hmac(secret, body))) return null;
  try { return JSON.parse(new TextDecoder().decode(fromB64url(body))); } catch { return null; }
}

export function readCookie(request, name) {
  const m = (request.headers.get("Cookie") || "").split(/;\s*/).find((c) => c.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : "";
}
const cookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const redirectUri = (site) => site.adminUrl.replace(/\/$/, "") + "/callback";
/** ログインのあとに戻る先。管理画面の中のパスだけを受ける */
const safeNext = (site, next) => (typeof next === "string" && /^\/admin(\/[\w\-/]*)?$/.test(next) ? next : "/admin");

export async function startLogin(site, env, next) {
  const state = randomToken(), nonce = randomToken();
  const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(site), response_type: "code", scope: "openid email profile", state, nonce, prompt: "select_account" });
  const st = await sign(env.SESSION_SECRET, { state, nonce, next: safeNext(site, next), exp: Date.now() + 600000 });
  return new Response(null, { status: 302, headers: { Location: AUTH_URL + "?" + q, "Set-Cookie": cookie(STATE_COOKIE, st, 600) } });
}

/** Google から戻ってきたところ。成功なら { sub, email, name, next }、だめなら { error } */
export async function finishLogin(site, env, request, fetcher = fetch) {
  const url = new URL(request.url);
  const st = await verify(env.SESSION_SECRET, readCookie(request, STATE_COOKIE));
  if (!st || st.exp < Date.now() || !url.searchParams.get("state") || st.state !== url.searchParams.get("state")) return { error: "ログインをやり直してください" };
  const code = url.searchParams.get("code");
  if (!code) return { error: "ログインが取り消されました" };
  const res = await fetcher(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(site), grant_type: "authorization_code" }),
  });
  if (!res.ok) {
    // Google が返した理由の名前（invalid_client など）だけを出す。鍵の値は出さない
    let why = "";
    try { why = String((await res.json()).error || "").replace(/[^\w.-]/g, "").slice(0, 40); } catch {}
    // 鍵の値は出さず、形だけを記録に残す（長さ・始まり・空白の有無）
    const sec = String(env.GOOGLE_CLIENT_SECRET || "");
    console.log("token exchange failed", res.status, why, JSON.stringify({ secretLen: sec.length, secretPrefixOk: sec.startsWith("GOCSPX-"), secretHasSpace: /\s/.test(sec), idSuffixOk: String(env.GOOGLE_CLIENT_ID || "").endsWith(".apps.googleusercontent.com"), idHasSpace: /\s/.test(String(env.GOOGLE_CLIENT_ID || "")) }));
    return { error: "Google との通信に失敗しました" + (why ? "（" + why + "）" : "") };
  }
  const { id_token } = await res.json();
  // ID トークンは Google のトークンの窓口から TLS で直接受け取ったので、署名の確かめは省ける（OpenID Connect Core 3.1.3.7）。中身の項目は確かめる
  let c;
  try { c = JSON.parse(new TextDecoder().decode(fromB64url(String(id_token).split(".")[1]))); } catch { return { error: "Google の応答が読めません" }; }
  const okIss = c.iss === "https://accounts.google.com" || c.iss === "accounts.google.com";
  if (!okIss || c.aud !== env.GOOGLE_CLIENT_ID || !(c.exp * 1000 > Date.now()) || c.nonce !== st.nonce) return { error: "ログインをやり直してください" };
  if (!c.email_verified) return { error: "このアカウントでは使えません" };
  return { sub: String(c.sub), email: String(c.email).toLowerCase(), name: c.name ? String(c.name) : "", next: st.next };
}

/** 許可したアカウントなら admin_users に入れ（最初だけ名前を取り込む）、ログインの Cookie を返す。許可していなければ null */
export async function admit(site, env, who, now = new Date()) {
  if (!site.admins.includes(who.email)) return null;
  const db = env.DB, at = now.toISOString();
  let u = await db.prepare("SELECT * FROM admin_users WHERE google_sub = ?").bind(who.sub).first();
  if (!u) {
    const byEmail = await db.prepare("SELECT * FROM admin_users WHERE email = ? AND google_sub IS NULL").bind(who.email).first();
    if (byEmail) {
      await db.prepare("UPDATE admin_users SET google_sub = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(who.sub, at, who.sub, byEmail.id).run();
    } else {
      await db
        .prepare("INSERT INTO admin_users (id, email, google_sub, display_name, active, created_at, created_by, updated_at, updated_by) VALUES (?,?,?,?,1,?,?,?,?)")
        .bind(crypto.randomUUID(), who.email, who.sub, (who.name || who.email).slice(0, 100), at, who.sub, at, who.sub)
        .run();
    }
    u = await db.prepare("SELECT * FROM admin_users WHERE google_sub = ?").bind(who.sub).first();
  } else if (u.email !== who.email) {
    await db.prepare("UPDATE admin_users SET email = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(who.email, at, who.sub, u.id).run();
  }
  if (!u || !u.active) return null;
  const token = await sign(env.SESSION_SECRET, { sub: who.sub, exp: Date.now() + SESSION_HOURS * 3600000 });
  return cookie(SESSION_COOKIE, token, SESSION_HOURS * 3600);
}

/** 画面を開くたびに：Cookie が正しく、利用者が使える状態で、メールアドレスがまだ許可の中にあるか。よければ利用者の行 */
export async function currentUser(site, env, request) {
  const s = await verify(env.SESSION_SECRET, readCookie(request, SESSION_COOKIE));
  if (!s || !(s.exp > Date.now())) return null;
  const u = await env.DB.prepare("SELECT * FROM admin_users WHERE google_sub = ?").bind(s.sub).first();
  if (!u || !u.active || !site.admins.includes(u.email)) return null;
  return u;
}

export const logoutCookie = () => cookie(SESSION_COOKIE, "", 0);
export const clearStateCookie = () => cookie(STATE_COOKIE, "", 0);
