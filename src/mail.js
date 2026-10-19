// メールは Resend で送る（宿泊の予約システムから写した）。失敗しても例外にせず、結果の文字（sent／skipped: 理由／failed: 理由）を返す
// MAIL_MODE が "log" のとき（テスト環境）は送らず、件名だけを記録に残す。メールの試験をするときだけ `--var MAIL_MODE:send` で上げる
// 同じ予約で二重に送らないよう、Idempotency-Key に予約番号を入れる（リリース1のまま）
export async function sendMail(env, site, { idem, to, subject, text, replyTo, bcc }) {
  if (env.MAIL_MODE === "log") {
    console.log("mail skipped (MAIL_MODE=log)", subject);
    return "skipped: テスト環境のため送っていない";
  }
  try {
    if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY がありません");
    const body = { from: site.mail.from, to: [to], subject, text };
    if (replyTo) body.reply_to = replyTo;
    if (bcc) body.bcc = [bcc];
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json", "Idempotency-Key": "session-" + idem },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Resend " + res.status + "：" + (await res.text()).slice(0, 200));
    return "sent";
  } catch (err) {
    return "failed: " + String(err?.message ?? err).slice(0, 300);
  }
}
