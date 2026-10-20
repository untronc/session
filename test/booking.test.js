// 予約画面と管理画面の流れ。名前の [要件6-◯] は、要件定義書の6節の受け入れ条件の番号
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dailyJobs, remindJobs } from "../src/cron.js";
import { admin, api, bookApi, catchMail, fakeCalendar, login, makeWorker, NOW, ORIGIN, reset, seedCatalog, site } from "./helpers.js";

let cal, worker, cookie, cat, mails;
beforeEach(async () => {
  await reset();
  cal = fakeCalendar();
  worker = makeWorker(cal);
  mails = catchMail();
  cookie = await login();
  cat = await seedCatalog(worker, cookie);
  await admin(worker, cookie, "settings", { calendars: ["primary"], bank: "試験銀行 本店 普通 0000000 シケン（見本）" });
});
afterEach(() => vi.restoreAllMocks());

const open = async (startAt, minutes = 90) => (await admin(worker, cookie, "slot", { startAt, minutes })).id;
const shown = async () => (await api(worker, "action=slots")).slots.map((s) => s.start_at);
const guest = (slotId, over = {}) => ({ courseId: cat.courseA, slotId, name: "見本 花子", googleEmail: "mihon.hanako@gmail.com", contactEmail: "", agree: true, privacyAgree: true, ...over });
const row = (id) => env.DB.prepare("SELECT b.*, p.amount, p.pay_state, p.due_date, p.cancel_rate, p.cancel_fee, p.refund_amount, p.transfer_fee FROM bookings b JOIN payments p ON p.booking_id = b.id WHERE b.id = ?").bind(id).first();

describe("[要件6-1] 枠を開ける・閉じる", () => {
  it("開けると予約画面に出る。閉じるとすぐ消える", async () => {
    const id = await open("2026-10-25T13:30");
    expect(await shown()).toEqual(["2026-10-25T13:30"]);
    expect((await admin(worker, cookie, "slot-close", { id })).ok).toBe(true);
    expect(await shown()).toEqual([]);
  });
  it("予約が入っている枠は閉じられない", async () => {
    const id = await open("2026-10-25T13:30");
    expect((await bookApi(worker, guest(id))).ok).toBe(true);
    expect((await admin(worker, cookie, "slot-close", { id })).error).toBe("予約が入っている枠は閉じられません");
  });
  it("[F2] くり返しの枠は60日先まで作り、終えると後の枠を閉じる", async () => {
    const r = await admin(worker, cookie, "rule", { weekday: 0, startTime: "10:00", minutes: 90, fromDate: "2026-10-19" });
    expect(r.made).toBe(8); // 10/25〜12/13 の日曜8回（今日から60日先の 12/18 まで）
    const before = await shown();
    expect(before[0]).toBe("2026-10-25T10:00");
    expect(before.at(-1)).toBe("2026-12-13T10:00");
    await admin(worker, cookie, "rule-end", { id: r.id, toDate: "2026-11-08" });
    expect(await shown()).toEqual(["2026-10-25T10:00", "2026-11-01T10:00", "2026-11-08T10:00"]);
    expect(await dailyJobs(site, env, NOW)).toMatchObject({ slots: 0 }); // 閉じた枠は作り直さない
  });
});

describe("[要件6-2] カレンダーとの空きの合わせ", () => {
  it("運用者のカレンダーに予定がある時間（前後30分を含む）の枠は出ない", async () => {
    await open("2026-10-25T10:00");
    await open("2026-10-25T13:30");
    await open("2026-10-25T17:00");
    cal.outside.push({ start: "2026-10-25T15:20", end: "2026-10-25T16:00" }); // 13:30〜15:00 の後ろ30分にかかる
    expect(await shown()).toEqual(["2026-10-25T10:00", "2026-10-25T17:00"]);
  });
  it("見るカレンダーを選んでいなければ、予定は見ない", async () => {
    await admin(worker, cookie, "settings", { calendars: [] });
    await open("2026-10-25T13:30");
    cal.outside.push({ start: "2026-10-25T13:00", end: "2026-10-25T16:00" });
    expect(await shown()).toEqual(["2026-10-25T13:30"]);
  });
});

describe("[要件6-3] 予約画面", () => {
  it("セッション・コースと、受付の範囲（2日前〜60日先）の空いている枠を返す。埋まった枠は出ない", async () => {
    await open("2026-10-20T10:00"); // 明日（2日前を過ぎた）
    const a = await open("2026-10-21T10:00");
    await open("2026-10-21T13:00");
    await open("2026-12-19T10:00"); // 61日先
    const res = await api(worker, "action=slots");
    expect(res.services).toMatchObject([{ name: "試験のセッション", minutes: 90, courses: [{ name: "インストール付き", price: 6600 }, { name: "QA付き", price: 6600 }] }]);
    expect(res.slots.map((s) => s.start_at)).toEqual(["2026-10-21T10:00", "2026-10-21T13:00"]);
    await bookApi(worker, guest(a));
    expect(await shown()).toEqual(["2026-10-21T13:00"]);
  });
});

describe("[要件6-4] 支払い：仮押さえと振込", () => {
  it("予約すると仮押さえ。振込先と期限（予約から1週間以内かつ前日まで）のメール、運用者に知らせ、カレンダーに仮押さえの予定", async () => {
    const id = await open("2026-10-25T13:30");
    const res = await bookApi(worker, guest(id));
    expect(res).toMatchObject({ ok: true, start_at: "2026-10-25T13:30", end_at: "2026-10-25T15:00", amount: 6600, due_date: "2026-10-24" });
    expect(res.id).toMatch(/^261019-\d{4}$/);
    expect(res.bank).toContain("試験銀行");
    const b = await row(res.id);
    expect(b).toMatchObject({ status: "hold", pay_state: "unpaid", due_date: "2026-10-24", amount: 6600, google_email: "mihon.hanako@gmail.com", contact_email: null, mail_hold: "sent", mail_notify: "sent" });
    expect(mails[0]).toMatchObject({ to: ["mihon.hanako@gmail.com"], subject: "【試験の店】仮のご予約を受け付けました（お振り込みのご案内）" });
    expect(mails[0].text).toContain("10月24日（土）までに");
    expect(mails[0].text).toContain("試験銀行");
    expect(mails[0].text).toContain(res.id.replace("-", ""));
    expect(mails[1].to).toEqual(["owner@example.com"]);
    expect([...cal.events.values()]).toEqual([{ summary: `【仮押さえ】${res.id} インストール付き`, start: "2026-10-25T13:30", end: "2026-10-25T15:00" }]);
    expect(JSON.stringify([...cal.events.values()])).not.toContain("花子"); // 予定に名前を書かない
  });
  it("連絡用のメールアドレスがあれば、お客様へのメールはそちらへ", async () => {
    const id = await open("2026-10-25T13:30");
    const res = await bookApi(worker, guest(id, { contactEmail: "Hanako@Example.co.jp" }));
    expect((await row(res.id)).contact_email).toBe("hanako@example.co.jp");
    expect(mails[0].to).toEqual(["hanako@example.co.jp"]);
  });
  it("期限を過ぎても自動では外れず、運用者が外すと枠が戻り、カレンダーの予定が消える", async () => {
    const id = await open("2026-10-25T13:30");
    const res = await bookApi(worker, guest(id));
    await dailyJobs(site, env, new Date("2026-10-25T00:00:00Z"));
    expect((await row(res.id)).status).toBe("hold");
    expect((await admin(worker, cookie, "release", { id: res.id })).ok).toBe(true);
    expect((await row(res.id)).status).toBe("cancelled");
    expect(cal.events.size).toBe(0);
    expect(await shown()).toEqual(["2026-10-25T13:30"]);
  });
});

describe("[要件6-5] 入金済み → 確定・Meet・予約確認メール", () => {
  it("入金済みにすると確定し、予定に Meet の URL。お客様に日時・コース・URL・事前アンケート・キャンセルの決まり・見本の案内、運用者に通知", async () => {
    const id = await open("2026-10-25T13:30");
    const res = await bookApi(worker, guest(id));
    mails.length = 0;
    const r = await admin(worker, cookie, "paid", { id: res.id, paidOn: "2026-10-20", payerName: "ミホン ハナコ" });
    expect(r).toMatchObject({ ok: true, meetUrl: "https://meet.google.com/aaa-bbbb-ev1", mailConfirm: "sent" });
    expect(await row(res.id)).toMatchObject({ status: "confirmed", pay_state: "paid", meet_url: "https://meet.google.com/aaa-bbbb-ev1" });
    expect(cal.events.get("ev1").summary).toBe(`【予約】${res.id} インストール付き`);
    const m = mails[0];
    expect(m.subject).toBe("【試験の店】ご予約が確定しました（Google Meet のご案内）");
    for (const s of ["10月25日（日）13:30〜15:00", "インストール付き", "https://meet.google.com/aaa-bbbb-ev1", "https://forms.example.jp/survey", "3日前まで：全額", "50%", "100%", "この予約画面は、試験の予約システムで動いています", "https://line.example.jp/shop"]) expect(m.text).toContain(s);
    expect(mails[1].to).toEqual(["owner@example.com"]);
  });
  it("仮押さえでない予約は入金済みにできない", async () => {
    const id = await open("2026-10-25T13:30");
    const res = await bookApi(worker, guest(id));
    await admin(worker, cookie, "paid", { id: res.id });
    expect((await admin(worker, cookie, "paid", { id: res.id })).error).toBe("仮押さえで振込待ちの予約だけを入金済みにできます");
  });
});

describe("[要件6-6] 管理画面の予約の一覧", () => {
  it("期間の予約と支払いの状態を、開始の順に返す", async () => {
    const a = await open("2026-10-25T13:30"), b = await open("2026-10-22T10:00");
    const r1 = await bookApi(worker, guest(a));
    const r2 = await bookApi(worker, guest(b, { googleEmail: "b@gmail.com" }));
    await admin(worker, cookie, "paid", { id: r2.id });
    const list = await admin(worker, cookie, "bookings?from=2026-10-19&to=2026-10-31");
    expect(list.bookings.map((x) => [x.id, x.status, x.pay_state])).toEqual([[r2.id, "confirmed", "paid"], [r1.id, "hold", "unpaid"]]);
  });
});

describe("[要件6-7] キャンセル・日時の変更", () => {
  async function paidBooking(start = "2026-10-25T13:30") {
    const id = await open(start);
    const res = await bookApi(worker, guest(id));
    await admin(worker, cookie, "paid", { id: res.id, paidOn: "2026-10-20" });
    return res.id;
  }
  it("2日前のキャンセルは50%。枠が戻り、予定が消える。返金は振込手数料を差し引いて記録", async () => {
    const id = await paidBooking();
    const w = makeWorker(cal, new Date("2026-10-23T03:00:00Z"));
    const r = await admin(w, cookie, "cancel", { id });
    expect(r).toMatchObject({ ok: true, rate: 50, fee: 3300, refund: 3300 });
    expect(cal.events.size).toBe(0);
    expect((await admin(w, cookie, "refund", { id, transferFee: 145, refundedOn: "2026-10-24" })).refund).toBe(3155);
    expect(await row(id)).toMatchObject({ status: "cancelled", cancel_rate: 50, cancel_fee: 3300, refund_amount: 3155, transfer_fee: 145 });
    const d = await admin(w, cookie, "booking?id=" + id);
    expect(d.history.map((h) => h.kind)).toEqual(["create", "paid", "cancel", "refund"]);
  });
  it("3日前までは0%（全額）、当日は100%（返金なし）、運用者の都合なら全額", async () => {
    const id1 = await paidBooking("2026-10-25T13:30");
    expect((await admin(makeWorker(cal, new Date("2026-10-22T03:00:00Z")), cookie, "cancel", { id: id1 })).rate).toBe(0);
    const id2 = await paidBooking("2026-10-26T13:30");
    expect(await admin(makeWorker(cal, new Date("2026-10-26T01:00:00Z")), cookie, "cancel", { id: id2 })).toMatchObject({ rate: 100, refund: 0 });
    const id3 = await paidBooking("2026-10-27T13:30");
    expect(await admin(makeWorker(cal, new Date("2026-10-27T01:00:00Z")), cookie, "cancel", { id: id3, operatorFault: true })).toMatchObject({ rate: 0, refund: 6600 });
  });
  it("日時を変えると予定が動き、Meet の URL はそのまま。変更の記録が残る", async () => {
    const id = await paidBooking();
    const url = (await row(id)).meet_url;
    const r = await admin(worker, cookie, "reschedule", { id, startAt: "2026-10-28T10:00" });
    expect(r).toMatchObject({ ok: true, start_at: "2026-10-28T10:00", end_at: "2026-10-28T11:30", change_count: 1, meetUrl: url });
    expect(cal.events.get("ev1")).toMatchObject({ start: "2026-10-28T10:00", end: "2026-10-28T11:30", meet: url });
    expect((await admin(worker, cookie, "booking?id=" + id)).history.at(-1)).toMatchObject({ kind: "reschedule", before: { start_at: "2026-10-25T13:30" }, after: { start_at: "2026-10-28T10:00" } });
  });
  it("ほかの予約と重なる日時には変えられない", async () => {
    const id = await paidBooking("2026-10-25T13:30");
    const other = await open("2026-10-28T10:00");
    await bookApi(worker, guest(other, { googleEmail: "c@gmail.com" }));
    expect((await admin(worker, cookie, "reschedule", { id, startAt: "2026-10-28T11:00" })).error).toMatch(/^ほかの予約と重なります/);
  });
});

describe("[要件6-8] 手で入れる予約（セッション・打ち合わせ）", () => {
  it("打ち合わせは0円・メールなし。その時間が埋まり、予約画面に出なくなる。カレンダーに予定", async () => {
    await open("2026-10-25T13:30");
    const r = await admin(worker, cookie, "manual", { kind: "meeting", startAt: "2026-10-25T14:00", minutes: 60, name: "定例" });
    expect(r.ok).toBe(true);
    expect(await row(r.id)).toMatchObject({ kind: "meeting", source: "manual", status: "confirmed", pay_state: "free", amount: 0, send_mail: 0 });
    expect(mails.filter((m) => m.to[0] !== "owner@example.com")).toEqual([]);
    expect(await shown()).toEqual([]);
    expect([...cal.events.values()][0].summary).toBe(`【打ち合わせ】${r.id} 定例`);
  });
  it("枠の外にも入れられる。カレンダーとぶつかるときは知らせ、もう一度押せば入れる", async () => {
    cal.outside.push({ start: "2026-10-26T09:00", end: "2026-10-26T10:00" });
    const first = await admin(worker, cookie, "manual", { kind: "session", startAt: "2026-10-26T10:00", minutes: 90, name: "田中", payState: "unpaid", amount: "6600" });
    expect(first).toMatchObject({ ok: false, needForce: true });
    const again = await admin(worker, cookie, "manual", { kind: "session", startAt: "2026-10-26T10:00", minutes: 90, name: "田中", payState: "unpaid", amount: "6600", force: true });
    expect(again.ok).toBe(true);
    expect((await row(again.id)).status).toBe("hold");
  });
  it("入金済みのセッションはメールを「送る」を選んだときだけ、Meet の URL つきで送る", async () => {
    const r = await admin(worker, cookie, "manual", { kind: "session", startAt: "2026-10-26T10:00", minutes: 90, name: "田中", courseId: cat.courseB, payState: "paid", googleEmail: "tanaka@gmail.com", sendMail: true });
    expect(r.meetUrl).toMatch(/^https:\/\/meet\.google\.com\//);
    expect(mails.find((m) => m.to[0] === "tanaka@gmail.com").subject).toContain("ご予約が確定しました");
    const r2 = await admin(worker, cookie, "manual", { kind: "session", startAt: "2026-10-27T10:00", minutes: 90, name: "佐藤", courseId: cat.courseB, payState: "paid", googleEmail: "sato@gmail.com", sendMail: false });
    expect(r2.ok).toBe(true);
    expect(mails.find((m) => m.to[0] === "sato@gmail.com")).toBeUndefined();
  });
  it("0円の予約・試しの予約は売上に数えない", async () => {
    await admin(worker, cookie, "manual", { kind: "session", startAt: "2026-10-26T10:00", minutes: 90, name: "田中", courseId: cat.courseA, payState: "paid" });
    await admin(worker, cookie, "manual", { kind: "session", startAt: "2026-10-27T10:00", minutes: 90, name: "鈴木", courseId: cat.courseA, payState: "free" });
    await admin(worker, cookie, "manual", { kind: "session", startAt: "2026-10-28T10:00", minutes: 90, name: "試験 予約", courseId: cat.courseA, payState: "paid" });
    await admin(worker, cookie, "manual", { kind: "meeting", startAt: "2026-10-29T10:00", minutes: 60, name: "定例" });
    expect(await admin(worker, cookie, "stats?month=2026-10")).toMatchObject({ count: 1, amount: 6600 });
  });
});

describe("[要件6-9] 前日の確認メール", () => {
  it("翌日の確定した予約にだけ、日時と Meet の URL を1回だけ送る", async () => {
    const a = await open("2026-10-25T13:30"), b = await open("2026-10-25T17:00"), c = await open("2026-10-26T10:00");
    const r1 = await bookApi(worker, guest(a));
    await admin(worker, cookie, "paid", { id: r1.id });
    await bookApi(worker, guest(b, { googleEmail: "b@gmail.com" })); // 仮押さえのまま
    const r3 = await bookApi(worker, guest(c, { googleEmail: "c@gmail.com" }));
    await admin(worker, cookie, "paid", { id: r3.id }); // 明後日
    mails.length = 0;
    const at = new Date("2026-10-24T00:00:00Z"); // 10/24 9:00
    expect(await remindJobs(site, env, at)).toMatchObject({ targets: 1, sent: 1 });
    expect(mails[0]).toMatchObject({ to: ["mihon.hanako@gmail.com"], subject: "【試験の店】明日のセッションのご案内" });
    expect(mails[0].text).toContain((await row(r1.id)).meet_url);
    expect(await remindJobs(site, env, at)).toMatchObject({ targets: 0 });
  });
});

describe("[要件6-10] プライバシーポリシーへの同意", () => {
  it("同意しないと予約できない。同意した日時と版が残る", async () => {
    const id = await open("2026-10-25T13:30");
    const ng = await bookApi(worker, guest(id, { privacyAgree: false }));
    expect(ng).toMatchObject({ ok: false, errors: { privacyAgree: "プライバシーポリシーへの同意が必要です" } });
    const ok = await bookApi(worker, guest(id));
    expect(await row(ok.id)).toMatchObject({ privacy_agreed_at: NOW.toISOString(), privacy_version: "2026-10-05" });
  });
  it.each([
    [{ name: "" }, "name"],
    [{ name: "https://spam.example" }, "name"],
    [{ googleEmail: "" }, "googleEmail"],
    [{ googleEmail: "not-mail" }, "googleEmail"],
    [{ contactEmail: "x@" }, "contactEmail"],
    [{ agree: false }, "agree"],
  ])("入力のまちがい %o は、その欄の文で返す", async (over, key) => {
    const id = await open("2026-10-25T13:30");
    const r = await bookApi(worker, guest(id, over));
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors)).toContain(key);
  });
});

describe("[要件6-11] 予約システムの見本の案内", () => {
  it("予約確認メールの終わりに1行とリンク。振込先のメール（予約を終えるまで）には出さない", async () => {
    const id = await open("2026-10-25T13:30");
    const res = await bookApi(worker, guest(id));
    expect(mails[0].text).not.toContain(site.showcase.url);
    mails.length = 0;
    await admin(worker, cookie, "paid", { id: res.id });
    expect(mails[0].text.trim().split("\n").slice(-2)).toEqual([site.showcase.text, site.showcase.url]);
  });
});

describe("[要件6-12] 同じ枠への同時の申し込み", () => {
  it("2つ同時に申し込むと、1件だけが仮押さえになり、もう1件には「この枠は埋まりました」", async () => {
    const id = await open("2026-10-25T13:30");
    const [a, b] = await Promise.all([bookApi(worker, guest(id)), bookApi(worker, guest(id, { googleEmail: "other@gmail.com" }))]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok).error).toBe("この枠は埋まりました。ほかの日時を選んでください");
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status <> 'cancelled'").first()).n).toBe(1);
  });
});

describe("[要件6-13] 仮押さえの直前のカレンダーの見直し", () => {
  it("予約画面に枠が出たあと、カレンダーにその時間の予定を入れてから申し込むと、仮押さえにならない", async () => {
    const id = await open("2026-10-25T13:30");
    expect(await shown()).toEqual(["2026-10-25T13:30"]);
    cal.outside.push({ start: "2026-10-25T14:00", end: "2026-10-25T14:30" });
    const r = await bookApi(worker, guest(id));
    expect(r).toMatchObject({ ok: false, error: "この枠は埋まりました。ほかの日時を選んでください" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM bookings").first()).n).toBe(0);
  });
});

describe("[要件6-14] 日時の変更の回数", () => {
  it("1回目は通る。2回目は「変更は2回目（無料は1回まで）」と出て、運用者が選ぶと通る", async () => {
    const id = await open("2026-10-25T13:30");
    const res = await bookApi(worker, guest(id));
    expect((await admin(worker, cookie, "reschedule", { id: res.id, startAt: "2026-10-26T10:00" })).ok).toBe(true);
    expect(await admin(worker, cookie, "reschedule", { id: res.id, startAt: "2026-10-27T10:00" })).toMatchObject({ ok: false, needAck: true, error: "変更は2回目（無料は1回まで）" });
    expect(await admin(worker, cookie, "reschedule", { id: res.id, startAt: "2026-10-27T10:00", ack: true })).toMatchObject({ ok: true, change_count: 2 });
  });
  it("仮押さえの日時を早めたら、振込の期限も前日までに縮める", async () => {
    const id = await open("2026-11-20T13:30");
    const res = await bookApi(worker, guest(id));
    expect((await row(res.id)).due_date).toBe("2026-10-26");
    await admin(worker, cookie, "reschedule", { id: res.id, startAt: "2026-10-24T10:00" });
    expect((await row(res.id)).due_date).toBe("2026-10-23");
  });
});

describe("不正利用対策・ログイン・設定", () => {
  it("同じメールアドレスからは1日3件まで", async () => {
    const ids = [];
    for (const t of ["10:00", "13:00", "16:00", "19:00"]) ids.push(await open("2026-10-25T" + t));
    for (const id of ids.slice(0, 3)) expect((await bookApi(worker, guest(id))).ok).toBe(true);
    expect((await bookApi(worker, guest(ids[3]))).error).toBe("同じメールアドレスからのご予約が多すぎます。お問い合わせください");
  });
  it("ログインしていなければ管理画面の API は 401、許可した住所の外からの予約は 403", async () => {
    expect((await worker.fetch(new Request(ORIGIN + "/admin/api/bookings?from=2026-10-01&to=2026-10-31"), env)).status).toBe(401);
    expect((await worker.fetch(new Request(ORIGIN + "/api", { method: "POST", headers: { Origin: "https://evil.example" }, body: "{}" }), env)).status).toBe(403);
  });
  it("振込先の口座は運用者が設定で変え、変えたことだけを返す（値は返さない）", async () => {
    const r = await admin(worker, cookie, "settings", { bank: "別の銀行（見本）", bufferMinutes: 15 });
    expect(r.changed).toEqual({ bank: "（変えた）", bufferMinutes: "15" });
    expect((await admin(worker, cookie, "settings")).settings).toMatchObject({ bank: "別の銀行（見本）", bufferMinutes: 15, leadDays: 2, horizonDays: 60 });
  });
  it("毎日の処理は、予約と個人情報を消さない", async () => {
    const id = await open("2026-10-25T13:30");
    const res = await bookApi(worker, guest(id));
    await dailyJobs(site, env, new Date("2030-01-01T00:00:00Z"));
    expect((await row(res.id)).name).toBe("見本 花子");
  });
});

describe("qa の指摘（2026-10-20）", () => {
  it("コース無しで手で入れたセッションは、予定の題・メール・知らせに名前も「null」も出さない", async () => {
    const r = await admin(worker, cookie, "manual", { kind: "session", startAt: "2026-10-26T10:00", minutes: 90, name: "田中 一郎", payState: "unpaid", amount: "6600", googleEmail: "tanaka@gmail.com", sendMail: true });
    expect([...cal.events.values()][0].summary).toBe(`【仮押さえ】${r.id} セッション`);
    const m = mails.find((x) => x.to[0] === "tanaka@gmail.com");
    expect(m.text).not.toContain("null");
    expect(m.text).not.toContain("undefined");
    for (const x of mails.filter((y) => y.to[0] === "owner@example.com")) expect(x.subject).not.toContain("田中");
  });
  it("仮押さえのときにカレンダーの予定を入れられなかった予約は、入金済みにしたときに予定を入れて Meet の URL を付ける", async () => {
    const id = await open("2026-10-25T13:30");
    const create = cal.create;
    cal.create = async () => { throw new Error("Google カレンダー 503"); };
    const res = await bookApi(worker, guest(id));
    expect((await row(res.id)).calendar_event_id).toBe(null);
    cal.create = create;
    const r = await admin(worker, cookie, "paid", { id: res.id });
    expect(r.meetUrl).toMatch(/^https:\/\/meet\.google\.com\//);
    expect([...cal.events.values()][0].summary).toBe(`【予約】${res.id} インストール付き`);
  });
  it("予約確認メールと前日のメールも、連絡用のアドレスへ送る", async () => {
    const id = await open("2026-10-25T13:30");
    const res = await bookApi(worker, guest(id, { contactEmail: "hanako@example.co.jp" }));
    mails.length = 0;
    await admin(worker, cookie, "paid", { id: res.id });
    expect(mails[0].to).toEqual(["hanako@example.co.jp"]);
    mails.length = 0;
    await remindJobs(site, env, new Date("2026-10-24T00:00:00Z"));
    expect(mails[0].to).toEqual(["hanako@example.co.jp"]);
  });
  it("決まった時刻の処理：9:00 は前日のメール、0:00 は枠を作る・片付け", async () => {
    const id = await open("2026-10-25T13:30");
    const res = await bookApi(worker, guest(id));
    await admin(worker, cookie, "paid", { id: res.id });
    mails.length = 0;
    const waits = [];
    const ctx = { waitUntil: (p) => waits.push(p) };
    await makeWorker(cal, new Date("2026-10-24T00:00:00Z")).scheduled({ cron: "0 0 * * *" }, env, ctx);
    expect(await waits[0]).toMatchObject({ sent: 1 });
    await makeWorker(cal, new Date("2026-10-24T15:00:00Z")).scheduled({ cron: "0 15 * * *" }, env, ctx);
    expect(await waits[1]).toHaveProperty("slots");
  });
});
