// メールの文面。コーポレートの UI の見本の「メール」の文で始め、
// キャンセルの決まりは要件定義書 5節に合わせた。文面は受け入れ試験で運用者が読んで直す
import { parseYmd, jpDate } from "./dates.js";
import { dateOf } from "./calc.js";

const yen = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "円";
/** 10月25日（日）13:30〜15:00 */
export const whenText = (start, end) => jpDate(parseYmd(dateOf(start)), false) + start.slice(11) + "〜" + end.slice(11);
const dayText = (ymdStr) => jpDate(parseYmd(ymdStr), false);

export const CANCEL_RULE = [
  "・3日前まで：全額お返しします",
  "・2日前〜前日：キャンセル料 50%（半額をお返しします）",
  "・当日・ご連絡のない欠席：キャンセル料 100%（お返しできません）",
  "・お返しするときの振込手数料は差し引きます。日時の変更は1回まで無料です",
  "・セッションの日を0日目として数えます",
].join("\n");

const sign = (site) => `――――――――\n${site.name}\n${site.mail.replyTo}`;
const showcase = (site) => `――――――――\n${site.showcase.text}\n${site.showcase.url}`;

/** 仮押さえ：振込先と期限 */
export function holdMail(site, b, settings) {
  return {
    subject: `【${site.name}】仮のご予約を受け付けました（お振り込みのご案内）`,
    text: [
      `${b.name} 様`,
      ``,
      `「${b.service_name || "セッション"}」の仮のご予約を受け付けました。`,
      ``,
      `予約番号　${b.id}`,
      `日時　　　${whenText(b.start_at, b.end_at)}`,
      ...(b.course_name ? [`コース　　${b.course_name}`] : []),
      `金額　　　${yen(b.amount || 0)}（税込）`,
      ``,
      `■ お振り込み`,
      `${dayText(b.due_date)}までに、下の口座へお振り込みください。`,
      `振込の名義の前に、予約番号「${b.id.replace("-", "")}」を入れてください。`,
      `振込手数料はご負担ください。`,
      ``,
      settings.bank || "（振込先の口座は、追ってお知らせします）",
      ``,
      `お振り込みを確かめたら、ご予約が確定し、Google Meet の URL をお送りします。`,
      ``,
      `■ キャンセル・日時の変更（ご入金のあと）`,
      CANCEL_RULE,
      `ご連絡は、このメールへの返信でお願いします。`,
      ``,
      sign(site),
    ].join("\n"),
  };
}

/** 確定：Meet の URL・事前アンケート・キャンセルの決まり・見本の案内 */
export function confirmMail(site, b) {
  return {
    subject: `【${site.name}】ご予約が確定しました（Google Meet のご案内）`,
    text: [
      `${b.name} 様`,
      ``,
      `お振り込みを確かめました。ご予約が確定しました。`,
      ``,
      `予約番号　${b.id}`,
      `日時　　　${whenText(b.start_at, b.end_at)}`,
      ...(b.course_name ? [`コース　　${b.course_name}`] : []),
      `場所　　　Google Meet`,
      `　　　　　${b.meet_url || "（URL は追ってお送りします）"}`,
      ``,
      ...(b.survey_url ? [`■ 事前アンケート（当日までにお願いします）`, b.survey_url, ``] : []),
      `■ キャンセル・日時の変更`,
      CANCEL_RULE,
      `ご連絡は、このメールへの返信でお願いします。`,
      ``,
      sign(site),
      ``,
      showcase(site),
    ].join("\n"),
  };
}

/** 前日のお知らせ */
export function remindMail(site, b) {
  return {
    subject: `【${site.name}】明日のセッションのご案内`,
    text: [
      `${b.name} 様`,
      ``,
      `明日のセッションのご案内です。`,
      ``,
      `日時　　　${whenText(b.start_at, b.end_at)}`,
      `場所　　　Google Meet`,
      `　　　　　${b.meet_url || "（URL は別のメールでお送りします）"}`,
      ``,
      `お時間になりましたら、上の URL からお入りください。`,
      ``,
      sign(site),
    ].join("\n"),
  };
}

/** 運用者への知らせ（仮押さえ・確定） */
export function notifyMail(site, b, what) {
  return {
    subject: `【予約】${what} ${b.id} ${whenText(b.start_at, b.end_at)} ${b.kind === "meeting" ? "打ち合わせ" : b.course_name || "セッション"}`,
    text: [
      `${what}：${b.id}`,
      `日時　${whenText(b.start_at, b.end_at)}`,
      `コース　${b.course_name || "―"}`,
      `お名前　${b.name}`,
      `金額　${b.amount != null ? yen(b.amount) : "―"}`,
      ...(b.due_date ? [`振込の期限　${dayText(b.due_date)}`] : []),
      ...(b.calendar_note ? [`カレンダー　${b.calendar_note}`] : []),
      ``,
      `管理画面：${site.adminUrl.replace(/\/$/, "")}/b/${b.id}`,
    ].join("\n"),
  };
}
