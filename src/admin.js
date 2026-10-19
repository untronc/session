// 管理画面の API（ログインした運用者だけ。worker.js が確かめてから呼ぶ）
//   GET  /admin/api/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD   日ごとの予約と支払いの状態（要件6-6）
//   GET  /admin/api/booking?id=                               予約の詳細と変更履歴
//   POST /admin/api/paid        {id, paidOn, payerName}       入金済み → 確定・Meet の URL・メール（要件6-4・6-5）
//   POST /admin/api/release     {id}                          仮押さえを外す（要件6-4）
//   POST /admin/api/cancel      {id, operatorFault}           キャンセル・キャンセル料（要件6-7）
//   POST /admin/api/refund      {id, transferFee, refundedOn} 返金の記録（要件6-7）
//   POST /admin/api/reschedule  {id, startAt, ack}            日時の変更。2回目からは ack が要る（要件6-7・6-14）
//   POST /admin/api/manual      {...}                         手で入れる予約・打ち合わせ（要件6-8）
//   GET  /admin/api/slots?from=&to=  POST /admin/api/slot {startAt, minutes}  POST /admin/api/slot-close {id}（要件6-1）
//   GET  /admin/api/rules  POST /admin/api/rule {weekday, startTime, minutes, fromDate, toDate}  POST /admin/api/rule-end {id, toDate}
//   GET  /admin/api/catalog  POST /admin/api/service {...}  POST /admin/api/course {...}
//   GET  /admin/api/settings  POST /admin/api/settings {...}  GET /admin/api/calendars
//   GET  /admin/api/stats?month=YYYY-MM                      月ごとの確定の件数と金額（0円・試しの予約は数えない）
import { addMinutes, cancelRate, dateOf, dueDate, overlaps, parseLocal, refundAmount } from "./calc.js";
import { catalog, holdOnCalendar, InputError, newBookingId } from "./booking.js";
import { addDays, parseYmd, todayJst, ymd } from "./dates.js";
import { sendMail } from "./mail.js";
import { confirmMail, holdMail, notifyMail } from "./mailtext.js";
import { loadSettings, saveSettings } from "./settings.js";
import { generateSlots } from "./slots.js";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

export async function handleAdminApi(site, env, request, user, now, cal) {
  const url = new URL(request.url);
  const p = url.pathname.replace(/^\/admin\/api\//, "");
  const q = Object.fromEntries(url.searchParams);
  try {
    if (request.method === "GET") {
      if (p === "bookings") return json(await listBookings(env.DB, q.from, q.to));
      if (p === "booking") return json(await bookingDetail(env.DB, q.id));
      if (p === "slots") return json(await listSlots(env.DB, q.from, q.to));
      if (p === "rules") return json({ ok: true, rules: (await env.DB.prepare("SELECT * FROM slot_rules WHERE active = 1 ORDER BY weekday, start_time").all()).results });
      if (p === "catalog") return json({ ok: true, services: await catalogAll(env.DB) });
      if (p === "settings") return json({ ok: true, settings: await loadSettings(site, env.DB) });
      if (p === "calendars") return json({ ok: true, calendars: cal ? await cal.list() : [], connected: !!cal });
      if (p === "stats") return json(await stats(env.DB, q.month));
      return json({ ok: false, error: "unknown" }, 404);
    }
    if (request.method !== "POST") return json({ ok: false, error: "method" }, 405);
    // 書き込みは、管理画面の同じ住所からだけ受ける
    const origin = request.headers.get("Origin");
    if (origin && origin !== new URL(site.adminUrl).origin) return json({ ok: false, error: "forbidden" }, 403);
    let body;
    try { body = JSON.parse((await request.text()) || "{}"); } catch { return json({ ok: false, error: "壊れた入力です" }); }
    const ctx = { site, env, db: env.DB, user, now, at: now.toISOString(), cal };
    const fn = { paid, release, cancel, refund, reschedule, manual, slot: openSlot, "slot-close": closeSlot, rule: addRule, "rule-end": endRule, service: saveService, course: saveCourse, settings: postSettings }[p];
    if (!fn) return json({ ok: false, error: "unknown" }, 404);
    return json(await fn(ctx, body));
  } catch (err) {
    return json({ ok: false, error: String(err?.message ?? err), ...(err?.errors ? { errors: err.errors } : {}) });
  }
}

// ---- 読む ----

async function listBookings(db, from, to) {
  if (!DATE.test(from || "") || !DATE.test(to || "")) throw new Error("期間を YYYY-MM-DD で指定してください");
  const { results } = await db
    .prepare(`SELECT b.id, b.kind, b.source, b.status, b.start_at, b.end_at, b.name, b.change_count, c.name AS course_name, p.amount, p.pay_state, p.due_date, p.paid_on
      FROM bookings b LEFT JOIN courses c ON c.id = b.course_id LEFT JOIN payments p ON p.booking_id = b.id
      WHERE b.start_at >= ? AND b.start_at < ? ORDER BY b.start_at`)
    .bind(from + "T00:00", ymd(addDays(parseYmd(to), 1)) + "T00:00")
    .all();
  return { ok: true, bookings: results };
}

async function getBooking(db, id) {
  const b = await db
    .prepare(`SELECT b.*, c.name AS course_name, s.name AS service_name, s.survey_url, p.amount, p.pay_state, p.due_date, p.payer_name, p.paid_on, p.cancel_rate, p.cancel_fee, p.operator_fault, p.transfer_fee, p.refund_amount, p.refunded_on
      FROM bookings b LEFT JOIN courses c ON c.id = b.course_id LEFT JOIN services s ON s.id = b.service_id LEFT JOIN payments p ON p.booking_id = b.id WHERE b.id = ?`)
    .bind(String(id || ""))
    .first();
  if (!b) throw new Error("予約が見つかりません");
  return b;
}

async function bookingDetail(db, id) {
  const b = await getBooking(db, id);
  const { results } = await db
    .prepare("SELECT h.kind, h.before_json, h.after_json, h.changed_at, h.changed_via, u.display_name FROM booking_changes h LEFT JOIN admin_users u ON u.id = h.changed_by_user_id WHERE h.booking_id = ? ORDER BY h.changed_at")
    .bind(b.id)
    .all();
  const history = results.map((r) => ({ kind: r.kind, before: r.before_json ? JSON.parse(r.before_json) : null, after: r.after_json ? JSON.parse(r.after_json) : null, at: r.changed_at, via: r.changed_via, by: r.display_name || (r.changed_via === "guest" ? "お客様" : r.changed_via === "system" ? "自動" : "") }));
  return { ok: true, booking: b, history };
}

async function listSlots(db, from, to) {
  if (!DATE.test(from || "") || !DATE.test(to || "")) throw new Error("期間を YYYY-MM-DD で指定してください");
  const { results } = await db
    .prepare(`SELECT s.id, s.start_at, s.minutes, s.state, s.rule_id, (SELECT b.id FROM bookings b WHERE b.slot_id = s.id AND b.status <> 'cancelled') AS booking_id
      FROM slots s WHERE s.start_at >= ? AND s.start_at < ? ORDER BY s.start_at`)
    .bind(from + "T00:00", ymd(addDays(parseYmd(to), 1)) + "T00:00")
    .all();
  return { ok: true, slots: results };
}

async function catalogAll(db) {
  const { results: services } = await db.prepare("SELECT * FROM services ORDER BY sort_order").all();
  const { results: courses } = await db.prepare("SELECT * FROM courses ORDER BY sort_order").all();
  return services.map((s) => ({ ...s, courses: courses.filter((c) => c.service_id === s.id) }));
}

/** 月ごとの数：泊まる月ではなくセッションの月。確定した予約だけ。0円と、名前に「テスト」「試験」を含む予約は数えない */
async function stats(db, month) {
  if (!/^\d{4}-\d{2}$/.test(month || "")) throw new Error("月を YYYY-MM で指定してください");
  const r = await db
    .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(p.amount), 0) AS amount FROM bookings b JOIN payments p ON p.booking_id = b.id
      WHERE b.status = 'confirmed' AND p.pay_state = 'paid' AND p.amount > 0 AND b.start_at >= ? AND b.start_at < ? AND b.name NOT LIKE '%テスト%' AND b.name NOT LIKE '%試験%'`)
    .bind(month + "-01T00:00", nextMonth(month) + "-01T00:00")
    .first();
  return { ok: true, month, count: r.count, amount: r.amount };
}
const nextMonth = (m) => { const [y, mm] = m.split("-").map(Number); return mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`; };

// ---- 変更履歴 ----

function changeStmt(ctx, bookingId, kind, before, after) {
  const { db, at, user } = ctx;
  return db
    .prepare("INSERT INTO booking_changes (id, booking_id, kind, before_json, after_json, changed_at, changed_via, changed_by_user_id, created_at, created_by, updated_at, updated_by) VALUES (?,?,?,?,?,?,'admin',?,?,?,?,?)")
    .bind(crypto.randomUUID(), bookingId, kind, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, at, user.id, at, user.google_sub, at, user.google_sub);
}
function slotChangeStmt(ctx, { slotId = null, ruleId = null }, kind, before, after) {
  const { db, at, user } = ctx;
  return db
    .prepare("INSERT INTO slot_changes (id, slot_id, rule_id, kind, before_json, after_json, changed_at, changed_by_user_id, created_at, created_by, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), slotId, ruleId, kind, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, at, user.id, at, user.google_sub, at, user.google_sub);
}

// ---- 支払い・確定 ----

async function paid(ctx, body) {
  const { db, at, user } = ctx;
  const b = await getBooking(db, body.id);
  if (b.status !== "hold" || b.pay_state !== "unpaid") throw new Error("仮押さえで振込待ちの予約だけを入金済みにできます");
  const paidOn = String(body.paidOn || ymd(todayJst(ctx.now)));
  if (!DATE.test(paidOn)) throw new Error("入金の日を YYYY-MM-DD で入れてください");
  const payer = String(body.payerName || "").trim().slice(0, 100) || null;
  await db.batch([
    db.prepare("UPDATE bookings SET status = 'confirmed', updated_at = ?, updated_by = ? WHERE id = ?").bind(at, user.google_sub, b.id),
    db.prepare("UPDATE payments SET pay_state = 'paid', paid_on = ?, payer_name = ?, updated_at = ?, updated_by = ? WHERE booking_id = ?").bind(paidOn, payer, at, user.google_sub, b.id),
    changeStmt(ctx, b.id, "paid", { status: "hold", pay_state: "unpaid" }, { status: "confirmed", pay_state: "paid", paid_on: paidOn }),
  ]);
  return { ok: true, ...(await confirmAndTell(ctx, { ...b, status: "confirmed" })) };
}

/** 確定のあと：予定に Meet の URL を付け、お客様に予約確認メール、運用者に予約通知メール */
async function confirmAndTell(ctx, b, withMeet = true) {
  const { db, site, env, cal } = ctx;
  const settings = await loadSettings(site, db);
  let note = "";
  if (cal && b.calendar_event_id) {
    try {
      // 題を「仮押さえ」から「予約」へ（できなくても Meet の URL は付ける）
      await cal.retitle(settings.eventCalendar, b.calendar_event_id, `【予約】${b.id} ${b.course_name || b.name}`).catch(() => {});
      if (withMeet && !b.meet_url) {
        b.meet_url = await cal.addMeet(settings.eventCalendar, b.calendar_event_id);
        await db.prepare("UPDATE bookings SET meet_url = ? WHERE id = ?").bind(b.meet_url, b.id).run();
      }
    } catch (err) {
      note = "Meet の URL を付けられませんでした（" + String(err?.message ?? err).slice(0, 120) + "）";
    }
  } else if (!cal) note = "カレンダーが未設定のため Meet の URL がありません";
  let mailConfirm = "none";
  const to = b.contact_email || b.google_email;
  if (b.send_mail && to && b.kind === "session") {
    const m = confirmMail(site, b);
    mailConfirm = await sendMail(env, site, { idem: b.id + "-confirm-" + Date.now(), to, subject: m.subject, text: m.text, replyTo: site.mail.replyTo });
  }
  const n = notifyMail(site, { ...b, calendar_note: note }, "確定");
  const mailNotify = await sendMail(env, site, { idem: b.id + "-notify-confirm", to: site.mail.notifyTo, subject: n.subject, text: n.text });
  await db.prepare("UPDATE bookings SET mail_confirm = ?, mail_notify = ? WHERE id = ?").bind(mailConfirm, mailNotify, b.id).run();
  return { meetUrl: b.meet_url || null, mailConfirm, calendarNote: note };
}

/** 仮押さえを外す：枠を戻し、カレンダーの予定を消す。お客様への知らせは運用者が送る */
async function release(ctx, body) {
  const { db, at, user } = ctx;
  const b = await getBooking(db, body.id);
  if (b.status !== "hold") throw new Error("仮押さえの予約だけを外せます");
  await db.batch([
    db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(at, at, user.google_sub, b.id),
    changeStmt(ctx, b.id, "release", { status: "hold" }, { status: "cancelled" }),
  ]);
  return { ok: true, calendarNote: await removeEvent(ctx, b) };
}

async function removeEvent(ctx, b) {
  if (!ctx.cal || !b.calendar_event_id) return ctx.cal ? "" : "カレンダーが未設定";
  try {
    const settings = await loadSettings(ctx.site, ctx.db);
    await ctx.cal.remove(settings.eventCalendar, b.calendar_event_id);
    return "";
  } catch (err) {
    return "カレンダーの予定を消せませんでした（" + String(err?.message ?? err).slice(0, 120) + "）。手で消してください";
  }
}

/** キャンセル：キャンセル料の率と額、返す額を出して記録する。枠を戻し、予定を消す */
async function cancel(ctx, body) {
  const { db, at, user, now } = ctx;
  const b = await getBooking(db, body.id);
  if (b.status === "cancelled") throw new Error("この予約はキャンセル済みです");
  const fault = body.operatorFault === true;
  const isPaid = b.pay_state === "paid";
  const rate = cancelRate(now, b.start_at, fault);
  const { fee, refund: back } = refundAmount({ amount: b.amount || 0, paid: isPaid, rate, transferFee: 0, operatorFault: fault });
  await db.batch([
    db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(at, at, user.google_sub, b.id),
    db.prepare("UPDATE payments SET cancel_rate = ?, cancel_fee = ?, operator_fault = ?, refund_amount = ?, updated_at = ?, updated_by = ? WHERE booking_id = ?").bind(rate, isPaid ? fee : 0, fault ? 1 : 0, back, at, user.google_sub, b.id),
    changeStmt(ctx, b.id, "cancel", { status: b.status }, { status: "cancelled", cancel_rate: rate, cancel_fee: isPaid ? fee : 0, refund_amount: back, operator_fault: fault }),
  ]);
  return { ok: true, rate, fee: isPaid ? fee : 0, refund: back, note: isPaid ? (fault ? "運用者の都合のため、振込手数料も差し引かず全額" : "返すときの振込手数料は、返金を記録するときに差し引きます") : "入金の前なので返金はありません", calendarNote: await removeEvent(ctx, b) };
}

/** 返金の記録：振込手数料を差し引いた額と、返した日 */
async function refund(ctx, body) {
  const { db, at, user } = ctx;
  const b = await getBooking(db, body.id);
  if (b.status !== "cancelled" || b.pay_state !== "paid") throw new Error("入金のあとにキャンセルした予約だけ、返金を記録できます");
  const tf = Number(body.transferFee ?? 0);
  if (!Number.isInteger(tf) || tf < 0 || tf > 1000) throw new Error("振込手数料は 0〜1000 円の整数で入れてください");
  const on = String(body.refundedOn || "");
  if (!DATE.test(on)) throw new Error("返した日を YYYY-MM-DD で入れてください");
  const { refund: back } = refundAmount({ amount: b.amount, paid: true, rate: b.cancel_rate, transferFee: tf, operatorFault: !!b.operator_fault });
  await db.batch([
    db.prepare("UPDATE payments SET transfer_fee = ?, refund_amount = ?, refunded_on = ?, updated_at = ?, updated_by = ? WHERE booking_id = ?").bind(b.operator_fault ? 0 : tf, back, on, at, user.google_sub, b.id),
    changeStmt(ctx, b.id, "refund", { refund_amount: b.refund_amount }, { refund_amount: back, transfer_fee: b.operator_fault ? 0 : tf, refunded_on: on }),
  ]);
  return { ok: true, refund: back };
}

// ---- 日時の変更・手で入れる予約 ----

/** start〜end が、ほかの予約（自分を除く）と前後の空ける時間を足して重なるか */
async function clashes(ctx, start, end, exceptId = "") {
  const settings = await loadSettings(ctx.site, ctx.db);
  const { results } = await ctx.db
    .prepare("SELECT id, start_at, end_at FROM bookings WHERE status <> 'cancelled' AND id <> ? AND start_at < ? AND end_at > ?")
    .bind(exceptId, addMinutes(end, settings.bufferMinutes), addMinutes(start, -settings.bufferMinutes))
    .all();
  let busy = false;
  if (ctx.cal) {
    try {
      const own = exceptId ? (await ctx.db.prepare("SELECT start_at, end_at FROM bookings WHERE id = ?").bind(exceptId).first()) : null;
      busy = (await ctx.cal.busy(settings.calendars, addMinutes(start, -settings.bufferMinutes), addMinutes(end, settings.bufferMinutes)))
        // 自分の予定（いまの日時）はカレンダーにもあるので、ぶつかりに数えない
        .filter((x) => !(own && x.start === own.start_at && x.end === own.end_at))
        .some((x) => overlaps({ start, end }, x, settings.bufferMinutes));
    } catch {}
  }
  return { bookings: results, busy, settings };
}

async function reschedule(ctx, body) {
  const { db, at, user, cal } = ctx;
  const b = await getBooking(db, body.id);
  if (b.status === "cancelled") throw new Error("キャンセル済みの予約は変えられません");
  const start = String(body.startAt || "");
  try { parseLocal(start); } catch { throw new Error("新しい日時を YYYY-MM-DDTHH:MM で入れてください"); }
  const minutes = (parseLocal(b.end_at) - parseLocal(b.start_at)) / 60000;
  const end = addMinutes(start, minutes);
  // 要件6-14：無料の変更は1回まで。2回目からは運用者が扱いを選んでから（ack）
  if (b.change_count >= 1 && body.ack !== true) return { ok: false, needAck: true, error: `変更は${b.change_count + 1}回目（無料は1回まで）` };
  const c = await clashes(ctx, start, end, b.id);
  if (c.bookings.length) throw new Error("ほかの予約と重なります（" + c.bookings.map((x) => x.id).join("・") + "）");
  if (c.busy && body.force !== true) return { ok: false, needForce: true, error: "カレンダーの予定とぶつかります" };
  const slot = await db.prepare("SELECT id FROM slots WHERE start_at = ? AND state = 'open'").bind(start).first();
  await db.batch([
    db.prepare("UPDATE bookings SET start_at = ?, end_at = ?, slot_id = ?, change_count = change_count + 1, updated_at = ?, updated_by = ? WHERE id = ?").bind(start, end, slot?.id || null, at, user.google_sub, b.id),
    ...(b.status === "hold" ? [db.prepare("UPDATE payments SET due_date = ?, updated_at = ?, updated_by = ? WHERE booking_id = ? AND due_date > ?").bind(dueDate(ctx.now, start), at, user.google_sub, b.id, ymd(addDays(parseYmd(dateOf(start)), -1)))] : []),
    changeStmt(ctx, b.id, "reschedule", { start_at: b.start_at, end_at: b.end_at }, { start_at: start, end_at: end, change_count: b.change_count + 1 }),
  ]);
  // 予定を動かす。Meet の URL は同じ予定なので変わらない
  let note = "";
  if (cal && b.calendar_event_id) {
    try {
      const settings = await loadSettings(ctx.site, db);
      await cal.move(settings.eventCalendar, b.calendar_event_id, { start, end });
    } catch (err) {
      note = "カレンダーの予定を動かせませんでした（" + String(err?.message ?? err).slice(0, 120) + "）。手で動かしてください";
    }
  }
  return { ok: true, start_at: start, end_at: end, change_count: b.change_count + 1, meetUrl: b.meet_url, calendarNote: note };
}

/** 手で入れる予約（セッション・打ち合わせ）。枠の外にも入れられる。カレンダーとぶつかるときは知らせ、force で入れる */
async function manual(ctx, body) {
  const { db, at, user, site, env, cal, now } = ctx;
  const e = {};
  const kind = body.kind === "meeting" ? "meeting" : body.kind === "session" ? "session" : "";
  if (!kind) e.kind = "種類を選んでください";
  const start = String(body.startAt || "");
  let okStart = true;
  try { parseLocal(start); } catch { okStart = false; e.startAt = "日時を YYYY-MM-DDTHH:MM で入れてください"; }
  const minutes = Number(body.minutes);
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 600) e.minutes = "長さは 15〜600 分で入れてください";
  const name = String(body.name || "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 100) e.name = kind === "meeting" ? "題を入れてください（100文字まで）" : "相手の名前を入れてください（100文字まで）";
  const g = String(body.googleEmail || "").trim().toLowerCase(), cmail = String(body.contactEmail || "").trim().toLowerCase();
  if (g && !EMAIL.test(g)) e.googleEmail = "メールアドレスの形が正しくありません";
  if (cmail && !EMAIL.test(cmail)) e.contactEmail = "メールアドレスの形が正しくありません";
  const payState = kind === "meeting" ? "free" : ["unpaid", "paid", "free"].includes(body.payState) ? body.payState : "";
  if (!payState) e.payState = "お金の欄を選んでください";
  let course = null;
  if (kind === "session" && body.courseId) {
    course = await db.prepare("SELECT c.id, c.name, c.price, s.id AS service_id, s.name AS service_name, s.survey_url FROM courses c JOIN services s ON s.id = c.service_id WHERE c.id = ?").bind(body.courseId).first();
    if (!course) e.courseId = "このコースはありません";
  }
  const sendMailToo = kind === "session" && body.sendMail === true && !!(cmail || g);
  if (Object.keys(e).length) throw new InputError(e);
  const end = addMinutes(start, minutes);
  const c = await clashes(ctx, start, end);
  if (c.bookings.length) throw new Error("ほかの予約と重なります（" + c.bookings.map((x) => x.id).join("・") + "）");
  if (c.busy && body.force !== true) return { ok: false, needForce: true, error: "カレンダーの予定とぶつかります。入れるなら、もう一度「入れる」を押してください" };
  const id = await newBookingId(db, now);
  const amount = payState === "free" ? 0 : course ? course.price : Number(body.amount) || 0;
  const status = payState === "unpaid" ? "hold" : "confirmed";
  const slot = await db.prepare("SELECT id FROM slots WHERE start_at = ? AND state = 'open'").bind(start).first();
  const due = payState === "unpaid" ? dueDate(now, start) : null;
  await db.batch([
    db.prepare(`INSERT INTO bookings (id, kind, source, status, start_at, end_at, slot_id, service_id, course_id, name, google_email, contact_email, send_mail, change_count, mail_hold, mail_confirm, mail_remind, mail_notify, received_at, created_at, created_by, updated_at, updated_by)
      VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'none', 'none', 'none', 'none', ?, ?, ?, ?, ?)`)
      .bind(id, kind, status, start, end, slot?.id || null, course?.service_id || null, course?.id || null, name, g || null, cmail && cmail !== g ? cmail : null, sendMailToo ? 1 : 0, at, at, user.google_sub, at, user.google_sub),
    db.prepare("INSERT INTO payments (booking_id, amount, pay_state, due_date, paid_on, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, amount, payState, due, payState === "paid" ? ymd(todayJst(now)) : null, at, user.google_sub, at, user.google_sub),
    changeStmt(ctx, id, "create", null, { kind, start_at: start, end_at: end, pay_state: payState, amount }),
  ]);
  const settings = c.settings;
  const b = { ...(await getBooking(db, id)) };
  const note = await holdOnCalendar(env, cal, settings, b, kind === "meeting" ? "【打ち合わせ】" : status === "hold" ? "【仮押さえ】" : "【予約】");
  b.calendar_event_id = (await db.prepare("SELECT calendar_event_id FROM bookings WHERE id = ?").bind(id).first()).calendar_event_id;
  const out = { ok: true, id, start_at: start, end_at: end, calendarNote: note };
  if (status === "hold" && sendMailToo) {
    const m = holdMail(site, b, settings);
    await db.prepare("UPDATE bookings SET mail_hold = ? WHERE id = ?").bind(await sendMail(env, site, { idem: id + "-hold", to: b.contact_email || b.google_email, subject: m.subject, text: m.text, replyTo: site.mail.replyTo }), id).run();
  }
  if (status === "confirmed" && kind === "session") Object.assign(out, await confirmAndTell(ctx, b, body.withMeet !== false));
  else if (kind === "meeting" && body.withMeet === true && cal && b.calendar_event_id) {
    try { out.meetUrl = await cal.addMeet(settings.eventCalendar, b.calendar_event_id); await db.prepare("UPDATE bookings SET meet_url = ? WHERE id = ?").bind(out.meetUrl, id).run(); } catch (err) { out.calendarNote = "Meet の URL を付けられませんでした"; }
  }
  return out;
}

// ---- 枠 ----

async function openSlot(ctx, body) {
  const { db, at, user } = ctx;
  const start = String(body.startAt || "");
  try { parseLocal(start); } catch { throw new InputError({ startAt: "日時を YYYY-MM-DDTHH:MM で入れてください" }); }
  const minutes = Number(body.minutes);
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 600) throw new InputError({ minutes: "長さは 15〜600 分で入れてください" });
  const same = await db.prepare("SELECT id, state FROM slots WHERE start_at = ?").bind(start).first();
  if (same && same.state === "open") throw new Error("同じ時刻の枠がもう開いています");
  if (same) {
    await db.batch([
      db.prepare("UPDATE slots SET state = 'open', minutes = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(minutes, at, user.google_sub, same.id),
      slotChangeStmt(ctx, { slotId: same.id }, "open", { state: "closed" }, { state: "open", minutes }),
    ]);
    return { ok: true, id: same.id };
  }
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO slots (id, start_at, minutes, state, rule_id, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, 'open', NULL, ?, ?, ?, ?)").bind(id, start, minutes, at, user.google_sub, at, user.google_sub),
    slotChangeStmt(ctx, { slotId: id }, "open", null, { start_at: start, minutes }),
  ]);
  return { ok: true, id };
}

async function closeSlot(ctx, body) {
  const { db, at, user } = ctx;
  const s = await db.prepare("SELECT * FROM slots WHERE id = ?").bind(String(body.id || "")).first();
  if (!s) throw new Error("枠が見つかりません");
  if (await db.prepare("SELECT 1 FROM bookings WHERE slot_id = ? AND status <> 'cancelled'").bind(s.id).first()) throw new Error("予約が入っている枠は閉じられません");
  if (s.state === "closed") return { ok: true };
  await db.batch([
    db.prepare("UPDATE slots SET state = 'closed', updated_at = ?, updated_by = ? WHERE id = ?").bind(at, user.google_sub, s.id),
    slotChangeStmt(ctx, { slotId: s.id }, "close", { state: "open" }, { state: "closed" }),
  ]);
  return { ok: true };
}

async function addRule(ctx, body) {
  const { db, at, user, site, now } = ctx;
  const e = {};
  const weekday = Number(body.weekday);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) e.weekday = "曜日を選んでください";
  if (!TIME.test(String(body.startTime || ""))) e.startTime = "開始の時刻を HH:MM で入れてください";
  const minutes = Number(body.minutes);
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 600) e.minutes = "長さは 15〜600 分で入れてください";
  const from = String(body.fromDate || ymd(todayJst(now)));
  if (!DATE.test(from)) e.fromDate = "始まりの日を YYYY-MM-DD で入れてください";
  const to = body.toDate ? String(body.toDate) : null;
  if (to && (!DATE.test(to) || to < from)) e.toDate = "終わりの日は始まりの日より後にしてください";
  if (Object.keys(e).length) throw new InputError(e);
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO slot_rules (id, weekday, start_time, minutes, from_date, to_date, active, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)").bind(id, weekday, body.startTime, minutes, from, to, at, user.google_sub, at, user.google_sub),
    slotChangeStmt(ctx, { ruleId: id }, "rule_add", null, { weekday, start_time: body.startTime, minutes, from_date: from, to_date: to }),
  ]);
  const made = await generateSlots(site, db, now);
  return { ok: true, id, made };
}

/** くり返しの枠を終える：終わりの日を決め、それより後の、予約の入っていない枠を閉じる */
async function endRule(ctx, body) {
  const { db, at, user } = ctx;
  const r = await db.prepare("SELECT * FROM slot_rules WHERE id = ?").bind(String(body.id || "")).first();
  if (!r) throw new Error("くり返しの枠が見つかりません");
  const to = String(body.toDate || "");
  if (!DATE.test(to)) throw new Error("終わりの日を YYYY-MM-DD で入れてください");
  await db.batch([
    db.prepare("UPDATE slot_rules SET to_date = ?, active = CASE WHEN ? < from_date THEN 0 ELSE active END, updated_at = ?, updated_by = ? WHERE id = ?").bind(to, to, at, user.google_sub, r.id),
    db.prepare("UPDATE slots SET state = 'closed', updated_at = ?, updated_by = ? WHERE rule_id = ? AND start_at >= ? AND state = 'open' AND id NOT IN (SELECT slot_id FROM bookings WHERE slot_id IS NOT NULL AND status <> 'cancelled')")
      .bind(at, user.google_sub, r.id, ymd(addDays(parseYmd(to), 1)) + "T00:00"),
    slotChangeStmt(ctx, { ruleId: r.id }, "rule_end", { to_date: r.to_date }, { to_date: to }),
  ]);
  return { ok: true };
}

// ---- セッションとコース・設定 ----

async function saveService(ctx, body) {
  const { db, at, user } = ctx;
  const name = String(body.name || "").trim();
  const minutes = Number(body.minutes);
  if (!name || name.length > 100) throw new InputError({ name: "セッションの名前を入れてください（100文字まで）" });
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 600) throw new InputError({ minutes: "長さは 15〜600 分で入れてください" });
  const survey = String(body.surveyUrl || "").trim();
  if (survey && !/^https:\/\/\S+$/.test(survey)) throw new InputError({ surveyUrl: "事前アンケートの URL は https:// から入れてください" });
  const visible = body.visible === false ? 0 : 1, order = Number(body.sortOrder) || 0;
  if (body.id) {
    const r = await db.prepare("UPDATE services SET name = ?, minutes = ?, survey_url = ?, sort_order = ?, visible = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(name, minutes, survey || null, order, visible, at, user.google_sub, body.id).run();
    if (!r.meta.changes) throw new Error("セッションが見つかりません");
    return { ok: true, id: body.id };
  }
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO services (id, name, minutes, survey_url, sort_order, visible, created_at, created_by, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id, name, minutes, survey || null, order, visible, at, user.google_sub, at, user.google_sub).run();
  return { ok: true, id };
}

async function saveCourse(ctx, body) {
  const { db, at, user } = ctx;
  const name = String(body.name || "").trim();
  const price = Number(body.price);
  if (!name || name.length > 100) throw new InputError({ name: "コースの名前を入れてください（100文字まで）" });
  if (!Number.isInteger(price) || price < 0 || price > 9999999) throw new InputError({ price: "料金（税込）は 0〜9,999,999 円の整数で入れてください" });
  const desc = String(body.description || "").trim().slice(0, 500) || null;
  const visible = body.visible === false ? 0 : 1, order = Number(body.sortOrder) || 0;
  if (body.id) {
    const r = await db.prepare("UPDATE courses SET name = ?, description = ?, price = ?, sort_order = ?, visible = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(name, desc, price, order, visible, at, user.google_sub, body.id).run();
    if (!r.meta.changes) throw new Error("コースが見つかりません");
    return { ok: true, id: body.id };
  }
  if (!(await db.prepare("SELECT 1 FROM services WHERE id = ?").bind(String(body.serviceId || "")).first())) throw new InputError({ serviceId: "セッションを選んでください" });
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO courses (id, service_id, name, description, price, sort_order, visible, created_at, created_by, updated_at, updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(id, body.serviceId, name, desc, price, order, visible, at, user.google_sub, at, user.google_sub).run();
  return { ok: true, id };
}

async function postSettings(ctx, body) {
  return { ok: true, changed: await saveSettings(ctx.site, ctx.db, ctx.user, body, ctx.at) };
}
