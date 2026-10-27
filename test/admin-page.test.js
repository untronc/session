// 管理画面の HTML と、画面が使う API（名前）。日時の変更で、予定の無い予約に予定を入れる
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { admin, bookApi, catchMail, fakeCalendar, login, makeWorker, ORIGIN, reset, seedCatalog } from "./helpers.js";

let cal, worker, cookie, cat;
beforeEach(async () => {
  await reset();
  cal = fakeCalendar();
  worker = makeWorker(cal);
  catchMail();
  cookie = await login();
  cat = await seedCatalog(worker, cookie);
  await admin(worker, cookie, "settings", { calendars: ["primary"], bank: "試験銀行 本店 普通 0000000 シケン（見本）" });
});
afterEach(() => vi.restoreAllMocks());

const page = (path, withCookie = true) => worker.fetch(new Request(ORIGIN + path, { headers: withCookie ? { Cookie: cookie } : {} }), env);

describe("[F15] 管理画面の HTML", () => {
  it("ログインしていなければ Google のログインへ", async () => {
    const r = await page("/admin/b/261025-0001", false);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe("/admin/login?next=" + encodeURIComponent("/admin/b/261025-0001"));
  });
  it("ログインしていれば、どの画面の住所でも同じ1枚を返す（画面の切り替えはこの中の JS）", async () => {
    for (const p of ["/admin", "/admin/b/261025-0001", "/admin/new", "/admin/slots", "/admin/clients", "/admin/stats", "/admin/settings", "/admin/me"]) {
      const r = await page(p);
      expect(r.status).toBe(200);
      const h = await r.text();
      expect(h).toContain('id="main"');
      expect(h).toContain("/vendor/bootstrap-5.3.3/bootstrap.bundle.min.js");
      expect(h).toContain("試験の店 予約管理");
      expect(r.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
      expect(r.headers.get("Cache-Control")).toBe("no-store");
    }
  });
  it("[F18〜F20] 「相手」の画面と売上の「相手ごと」があり、画面の JS は文法が通る", async () => {
    const h = await (await page("/admin/clients")).text();
    expect(h).toContain('data-nav="clients"');
    expect(h).toContain("相手ごとの集計");
    expect(h).toContain("月額の契約を足す");
    const js = h.slice(h.lastIndexOf("<script>") + 8, h.lastIndexOf("</script>"));
    expect(() => new Function(js)).not.toThrow();
  });
  it("画面の色は untronc の緑（予約画面と同じ #006862）", async () => {
    const h = await (await page("/admin")).text();
    expect(h).toContain('data-theme="untronc"');
    expect(h).toContain("#006862");
  });
});

describe("画面に出す名前（変更履歴の「だれが」）", () => {
  it("読める・変えられる", async () => {
    const a = await admin(worker, cookie, "me");
    expect(a.me).toEqual({ name: "運用者", email: "operator@example.com" });
    expect((await admin(worker, cookie, "me", { name: "  なお  " })).me.name).toBe("なお");
    expect((await admin(worker, cookie, "me")).me.name).toBe("なお");
  });
  it("空や101文字は欄の下に文を出す", async () => {
    expect((await admin(worker, cookie, "me", { name: " " })).errors.name).toBeTruthy();
    expect((await admin(worker, cookie, "me", { name: "あ".repeat(101) })).errors.name).toBeTruthy();
  });
});

describe("[要件6-8] 打ち合わせのお金の欄（要件 5節：打ち合わせは「0円」を初めから選んでおく）", () => {
  const pay = (id) => env.DB.prepare("SELECT b.status, p.pay_state, p.amount FROM bookings b JOIN payments p ON p.booking_id = b.id WHERE b.id = ?").bind(id).first();
  it("選ばなければ 0円", async () => {
    const r = await admin(worker, cookie, "manual", { kind: "meeting", startAt: "2026-10-27T14:00", minutes: 60, name: "見本の打ち合わせ" });
    expect(await pay(r.id)).toEqual({ status: "confirmed", pay_state: "free", amount: 0 });
  });
  it("入金済み・未入金も選べる（金額は手で入れる）", async () => {
    const a = await admin(worker, cookie, "manual", { kind: "meeting", startAt: "2026-10-27T14:00", minutes: 60, name: "有料の相談", payState: "paid", amount: "3300" });
    expect(await pay(a.id)).toEqual({ status: "confirmed", pay_state: "paid", amount: 3300 });
    const b = await admin(worker, cookie, "manual", { kind: "meeting", startAt: "2026-10-28T14:00", minutes: 60, name: "有料の相談2", payState: "unpaid", amount: "3300" });
    expect(await pay(b.id)).toEqual({ status: "hold", pay_state: "unpaid", amount: 3300 });
  });
});

describe("[要件6-8] 手で入れる予約の料金（コースなし・0円でないとき）", () => {
  const base = { kind: "session", startAt: "2026-10-27T10:00", minutes: 90, name: "見本 次郎", payState: "paid" };
  it("空欄・負・小数・文字は料金の欄に文を出す", async () => {
    for (const amount of ["", " ", "-6600", "6600.5", "abc", "10000000"]) expect((await admin(worker, cookie, "manual", { ...base, amount })).errors?.amount, amount).toBeTruthy();
  });
  it("整数なら入る。0円を選んだときは料金を見ない", async () => {
    expect((await admin(worker, cookie, "manual", { ...base, amount: "6600" })).ok).toBe(true);
    expect((await admin(worker, cookie, "manual", { ...base, startAt: "2026-10-28T10:00", payState: "free", amount: "" })).ok).toBe(true);
  });
});

describe("[要件6-7] 打ち合わせの日時を変えて予定を新しく入れるとき、題は【打ち合わせ】", () => {
  it("題の頭", async () => {
    const create = cal.create;
    cal.create = async () => { throw new Error("Google が落ちている"); };
    const r = await admin(worker, cookie, "manual", { kind: "meeting", startAt: "2026-10-27T14:00", minutes: 60, name: "見本の打ち合わせ" });
    cal.create = create;
    expect((await admin(worker, cookie, "reschedule", { id: r.id, startAt: "2026-10-28T14:00" })).ok).toBe(true);
    expect([...cal.events.values()][0].summary).toBe(`【打ち合わせ】${r.id} 見本の打ち合わせ`);
  });
});

describe("[F2] くり返しの枠は、手で開けた枠と同じ時刻には作らない", () => {
  it("同じ開始の枠がもうあれば飛ばす", async () => {
    await admin(worker, cookie, "slot", { startAt: "2026-10-25T10:00", minutes: 90 });
    const r = await admin(worker, cookie, "rule", { weekday: 0, startTime: "10:00", minutes: 90, fromDate: "2026-10-19" });
    expect(r.made).toBe(7); // 日曜8回のうち、10/25 は手で開けた枠がある
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM slots WHERE start_at = '2026-10-25T10:00'").first();
    expect(n.n).toBe(1);
  });
});

describe("[A8] 設定の空欄は 0 にしない（画面の欄は文字のまま送る）", () => {
  it("前後の空ける時間が空欄なら断る", async () => {
    expect((await admin(worker, cookie, "settings", { bufferMinutes: "" })).errors.bufferMinutes).toBe("前後に空ける時間（分）は 0〜240 の整数で入れてください");
    expect((await admin(worker, cookie, "settings", { leadDays: "  " })).errors.leadDays).toBeTruthy();
    expect((await admin(worker, cookie, "settings", { bufferMinutes: "45" })).ok).toBe(true);
  });
  it("コースの料金が空欄なら、料金の欄に文を出す", async () => {
    const r = await admin(worker, cookie, "course", { id: cat.courseA, name: "インストール付き", price: "" });
    expect(r.errors.price).toBeTruthy();
    expect((await admin(worker, cookie, "course", { id: cat.courseA, name: "インストール付き", price: "6600" })).ok).toBe(true);
  });
});

describe("[要件6-7] 日時の変更：予約のときにカレンダーへ予定を入れられなかった予約", () => {
  it("変えるときに予定を入れる（止まらない）", async () => {
    const slot = (await admin(worker, cookie, "slot", { startAt: "2026-10-25T13:30", minutes: 90 })).id;
    const create = cal.create;
    cal.create = async () => { throw new Error("Google が落ちている"); };
    const b = await bookApi(worker, { courseId: cat.courseA, slotId: slot, name: "見本 花子", googleEmail: "mihon.hanako@gmail.com", contactEmail: "", agree: true, privacyAgree: true });
    expect(b.ok).toBe(true);
    expect(cal.events.size).toBe(0);
    cal.create = create;
    const r = await admin(worker, cookie, "reschedule", { id: b.id, startAt: "2026-10-26T10:00" });
    expect(r.ok).toBe(true);
    expect([...cal.events.values()].map((e) => [e.start, e.end])).toEqual([["2026-10-26T10:00", "2026-10-26T11:30"]]);
  });
});
