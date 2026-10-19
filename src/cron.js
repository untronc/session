// 決まった時刻の処理（Cron Trigger。sites/<名前>/wrangler.jsonc の triggers）
//   毎日 0:00（日本時間）：くり返しの枠を先まで作る・前日までの不正利用対策の数と site.accessLogDays 日を過ぎた操作ログを消す。予約と個人情報は消さない（要件 5節「個人情報」）
//   毎朝 9:00（日本時間）：翌日の確定した予約のお客様に、日時と Meet の URL のメール（要件6-9）
import { addDays, todayJst, ymd } from "./dates.js";
import { sendMail } from "./mail.js";
import { remindMail } from "./mailtext.js";
import { generateSlots } from "./slots.js";

export const CRON_DAILY = "0 15 * * *";
export const CRON_REMIND = "0 0 * * *";

export async function dailyJobs(site, env, now = new Date()) {
  const db = env.DB, today = ymd(todayJst(now));
  const made = await generateSlots(site, db, now);
  const res = await db.batch([
    db.prepare("DELETE FROM daily_counts WHERE day < ?").bind(today),
    db.prepare("DELETE FROM access_log WHERE received_at < ?").bind(new Date(now.getTime() - site.accessLogDays * 86400000).toISOString()),
  ]);
  return { slots: made, counts: res[0].meta.changes, logs: res[1].meta.changes };
}

/** 翌日の確定した予約（メールを送る予約・セッションだけ）に前日のメール。送ったものは送り直さない */
export async function remindJobs(site, env, now = new Date()) {
  const db = env.DB, tomorrow = ymd(addDays(todayJst(now), 1));
  const { results } = await db
    .prepare(`SELECT b.*, c.name AS course_name FROM bookings b LEFT JOIN courses c ON c.id = b.course_id
      WHERE b.status = 'confirmed' AND b.kind = 'session' AND b.send_mail = 1 AND b.mail_remind NOT LIKE 'sent%' AND b.start_at >= ? AND b.start_at < ?`)
    .bind(tomorrow + "T00:00", tomorrow + "T23:59:59")
    .all();
  let sent = 0;
  for (const b of results) {
    const to = b.contact_email || b.google_email;
    if (!to) continue;
    const m = remindMail(site, b);
    const r = await sendMail(env, site, { idem: b.id + "-remind-" + b.start_at, to, subject: m.subject, text: m.text, replyTo: site.mail.replyTo });
    await db.prepare("UPDATE bookings SET mail_remind = ? WHERE id = ?").bind(r, b.id).run();
    if (r === "sent") sent++;
  }
  return { tomorrow, targets: results.length, sent };
}
