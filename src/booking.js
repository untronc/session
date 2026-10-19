// 予約画面の中身：出す枠（要件6-2・6-3）と、予約して仮押さえにする（要件6-4・6-10・6-12・6-13）
// 同じ時間に2人が申し込んだときは、重なる予約が無いときだけ入れる SQL を D1 の batch（1つのトランザクション）で流し、先に終えた1件だけを通す
import { addMinutes, availableSlots, bookableRange, dueDate, overlaps } from "./calc.js";
import { addDays, parseYmd, todayJst, ymd } from "./dates.js";
import { sendMail } from "./mail.js";
import { holdMail, notifyMail } from "./mailtext.js";
import { loadSettings } from "./settings.js";

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const HAS_URL = /(https?:\/\/|www\.)/i;
export class InputError extends Error {
  constructor(errors) {
    super(Object.values(errors)[0]);
    this.errors = errors;
  }
}

/** 出しているセッションとコース */
export async function catalog(db) {
  const { results: services } = await db.prepare("SELECT id, name, minutes, survey_url FROM services WHERE visible = 1 ORDER BY sort_order").all();
  const { results: courses } = await db.prepare("SELECT id, service_id, name, description, price FROM courses WHERE visible = 1 ORDER BY sort_order").all();
  return services.map((s) => ({ ...s, courses: courses.filter((c) => c.service_id === s.id) }));
}

/** 受付の範囲の、予約（取り消していないもの）と枠とカレンダーの予定を読む */
async function loadRange(site, env, cal, settings, now) {
  const range = bookableRange(now, settings);
  const from = range.from + "T00:00", to = ymd(addDays(parseYmd(range.to), 1)) + "T00:00";
  const pad = (s, n) => addMinutes(s, n);
  const { results: slots } = await env.DB.prepare("SELECT id, start_at, minutes, state FROM slots WHERE start_at >= ? AND start_at < ? AND state = 'open'").bind(from, to).all();
  const { results: bookings } = await env.DB.prepare("SELECT start_at, end_at, status FROM bookings WHERE status <> 'cancelled' AND end_at > ? AND start_at < ?").bind(pad(from, -24 * 60), pad(to, 24 * 60)).all();
  const busy = cal ? await cal.busy(settings.calendars, pad(from, -24 * 60), pad(to, 24 * 60)) : [];
  return { slots, bookings, busy };
}

/** 予約画面に出す：セッション・コースと、空いている枠 */
export async function publicSlots(site, env, cal, now) {
  const settings = await loadSettings(site, env.DB);
  const services = await catalog(env.DB);
  const { slots, bookings, busy } = await loadRange(site, env, cal, settings, now);
  const minutes = Math.max(0, ...services.map((s) => s.minutes));
  // 枠の長さはセッションの長さで見る（枠が短くても、セッションの長さぶん空いていなければ出さない）
  const open = availableSlots({ slots: slots.map((s) => ({ ...s, minutes: Math.max(s.minutes, minutes) })), bookings, busy, settings, now });
  return { ok: true, services, slots: open.map((s) => ({ id: s.id, start_at: s.start_at, end_at: s.end_at })) };
}

/** 入力を確かめる。まちがいは項目ごとの文（errors）で返す */
export function checkBookInput(site, body) {
  const e = {};
  const name = String(body.name ?? "").trim().replace(/\s+/g, " ");
  const g = String(body.googleEmail ?? "").trim().toLowerCase();
  const c = String(body.contactEmail ?? "").trim().toLowerCase();
  if (!name) e.name = "お名前を入れてください";
  else if (name.length > site.maxLen.name) e.name = `お名前は${site.maxLen.name}文字までにしてください`;
  else if (HAS_URL.test(name)) e.name = "お名前に URL は入れられません";
  if (!g) e.googleEmail = "Google アカウントのメールアドレスを入れてください";
  else if (g.length > 254 || !EMAIL.test(g)) e.googleEmail = "メールアドレスの形が正しくありません";
  if (c && (c.length > 254 || !EMAIL.test(c))) e.contactEmail = "メールアドレスの形が正しくありません";
  if (!body.courseId) e.courseId = "コースを選んでください";
  if (!body.slotId) e.slotId = "日時を選んでください";
  if (body.agree !== true) e.agree = "キャンセル料への同意が必要です";
  if (body.privacyAgree !== true) e.privacyAgree = "プライバシーポリシーへの同意が必要です";
  if (Object.keys(e).length) throw new InputError(e);
  return { name, googleEmail: g, contactEmail: c && c !== g ? c : null };
}

/** 予約番号：受付の日（日本時間）yyMMdd-4桁 */
export async function newBookingId(db, now) {
  const day = ymd(todayJst(now)).slice(2).replace(/-/g, "");
  for (let i = 0; i < 20; i++) {
    const id = day + "-" + String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, "0");
    if (!(await db.prepare("SELECT 1 FROM bookings WHERE id = ?").bind(id).first())) return id;
  }
  throw new Error("予約番号を作れませんでした。もう一度お試しください");
}

/** 不正利用対策の印（メールアドレスの SHA-256 の先頭8バイト） */
async function contactMark(v) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("email:" + v));
  return "e" + [...new Uint8Array(buf).slice(0, 8)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** 重なる予約が無く、枠が開いているときだけ予約を入れる文（ネットの予約） */
const INSERT_IF_FREE = `INSERT INTO bookings (id, kind, source, status, start_at, end_at, slot_id, service_id, course_id, name, google_email, contact_email, send_mail, change_count, privacy_agreed_at, privacy_version, mail_hold, mail_confirm, mail_remind, mail_notify, received_at, created_at, created_by, updated_at, updated_by)
  SELECT ?, 'session', 'web', 'hold', ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, 'none', 'none', 'none', 'none', ?, ?, 'guest', ?, 'guest'
  WHERE EXISTS (SELECT 1 FROM slots WHERE id = ? AND state = 'open')
    AND NOT EXISTS (SELECT 1 FROM bookings WHERE status <> 'cancelled' AND start_at < ? AND end_at > ?)`;

export async function book(site, env, cal, body, now) {
  const db = env.DB, at = now.toISOString();
  const input = checkBookInput(site, body);
  const settings = await loadSettings(site, db);
  const course = await db.prepare("SELECT c.id, c.name, c.price, s.id AS service_id, s.name AS service_name, s.minutes, s.survey_url FROM courses c JOIN services s ON s.id = c.service_id WHERE c.id = ? AND c.visible = 1 AND s.visible = 1").bind(body.courseId).first();
  if (!course) throw new InputError({ courseId: "このコースは選べません" });
  const slot = await db.prepare("SELECT id, start_at, minutes, state FROM slots WHERE id = ?").bind(body.slotId).first();
  const FULL = "この枠は埋まりました。ほかの日時を選んでください";
  if (!slot || slot.state !== "open") throw new InputError({ slotId: FULL });
  const start = slot.start_at, end = addMinutes(start, course.minutes);
  // 受付の範囲・予約との重なりを、画面に出すときと同じ決まりで見直す
  const { bookings } = await loadRange(site, env, null, settings, now);
  if (!availableSlots({ slots: [{ ...slot, minutes: course.minutes }], bookings, busy: [], settings, now }).length) throw new InputError({ slotId: FULL });
  // 不正利用対策：全体は1日 dailyLimit 件まで、同じメールアドレスは1日 perContactDailyLimit 件まで
  const day = ymd(todayJst(now)), mark = await contactMark(input.googleEmail);
  const { results: counts } = await db.prepare("SELECT mark, n FROM daily_counts WHERE day = ? AND mark IN ('*', ?)").bind(day, mark).all();
  const n = (m) => counts.find((r) => r.mark === m)?.n || 0;
  if (n("*") >= site.dailyLimit) throw new Error("ただいま予約が混み合っています。時間をおいてお試しください");
  if (n(mark) >= site.perContactDailyLimit) throw new Error("同じメールアドレスからのご予約が多すぎます。お問い合わせください");
  // 要件6-13：仮押さえにする直前に、カレンダーの空きを見直す
  if (cal) {
    const busy = await cal.busy(settings.calendars, addMinutes(start, -settings.bufferMinutes), addMinutes(end, settings.bufferMinutes));
    if (busy.some((b) => overlaps({ start, end }, b, settings.bufferMinutes))) throw new InputError({ slotId: FULL });
  }
  const id = await newBookingId(db, now);
  const due = dueDate(now, start);
  const lo = addMinutes(start, -settings.bufferMinutes), hi = addMinutes(end, settings.bufferMinutes);
  const res = await db.batch([
    db.prepare(INSERT_IF_FREE).bind(id, start, end, slot.id, course.service_id, course.id, input.name, input.googleEmail, input.contactEmail, at, site.privacyVersion, at, at, at, slot.id, hi, lo),
    db.prepare("INSERT INTO payments (booking_id, amount, pay_state, due_date, created_at, created_by, updated_at, updated_by) SELECT ?, ?, 'unpaid', ?, ?, 'guest', ?, 'guest' WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ?)").bind(id, course.price, due, at, at, id),
    db.prepare("INSERT INTO booking_changes (id, booking_id, kind, before_json, after_json, changed_at, changed_via, changed_by_user_id, created_at, created_by, updated_at, updated_by) SELECT ?, ?, 'create', NULL, ?, ?, 'guest', NULL, ?, 'guest', ?, 'guest' WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ?)")
      .bind(crypto.randomUUID(), id, JSON.stringify({ start_at: start, end_at: end, course: course.name, amount: course.price, due_date: due }), at, at, at, id),
    ...["*", mark].map((m) =>
      db.prepare("INSERT INTO daily_counts (day, mark, n, created_at, created_by, updated_at, updated_by) SELECT ?, ?, 1, ?, 'guest', ?, 'guest' WHERE EXISTS (SELECT 1 FROM bookings WHERE id = ?) ON CONFLICT (day, mark) DO UPDATE SET n = n + 1, updated_at = excluded.updated_at")
        .bind(day, m, at, at, id)
    ),
  ]);
  if (!res[0].meta.changes) throw new InputError({ slotId: FULL });

  const b = { id, kind: "session", name: input.name, start_at: start, end_at: end, course_name: course.name, service_name: course.service_name, amount: course.price, due_date: due };
  // カレンダーに予定を入れて枠を押さえる（題に名前とメールは書かない）
  b.calendar_note = await holdOnCalendar(env, cal, settings, b, "【仮押さえ】");
  const to = input.contactEmail || input.googleEmail;
  const m1 = holdMail(site, b, settings);
  const mailHold = await sendMail(env, site, { idem: id + "-hold", to, subject: m1.subject, text: m1.text, replyTo: site.mail.replyTo });
  const m2 = notifyMail(site, b, "仮押さえ");
  const mailNotify = await sendMail(env, site, { idem: id + "-notify-hold", to: site.mail.notifyTo, subject: m2.subject, text: m2.text });
  await db.prepare("UPDATE bookings SET mail_hold = ?, mail_notify = ? WHERE id = ?").bind(mailHold, mailNotify, id).run();
  return { ok: true, id, start_at: start, end_at: end, course: course.name, amount: course.price, due_date: due, bank: settings.bank, mailOk: !mailHold.startsWith("failed") };
}

/** 予定の題の名前の部分。お客様の名前は書かない（基本設計書 4節）。打ち合わせは運用者が付けた題 */
export const eventLabel = (b) => (b.kind === "meeting" ? b.name : b.course_name || "セッション");

/** カレンダーに予定を入れ、ID を予約に書く。うまくいかなければ理由の文を返す（予約は止めない。運用者への知らせに書く） */
export async function holdOnCalendar(env, cal, settings, b, prefix) {
  if (!cal) return "未設定のため予定を入れていません";
  try {
    const eventId = await cal.create(settings.eventCalendar, { summary: `${prefix}${b.id} ${eventLabel(b)}`, start: b.start_at, end: b.end_at });
    await env.DB.prepare("UPDATE bookings SET calendar_event_id = ? WHERE id = ?").bind(eventId, b.id).run();
    return "";
  } catch (err) {
    console.log("calendar create failed", b.id, String(err?.message ?? err));
    return "予定を入れられませんでした（" + String(err?.message ?? err).slice(0, 120) + "）";
  }
}
