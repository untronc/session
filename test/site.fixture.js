// 単体テストで使う施設の設定（架空の店）。決まりの値（前後の空ける時間・受付の締め切りと先）は要件定義書 5節の値
import { defineSite } from "../src/config.js";

export default defineSite({
  name: "試験の店",
  adminUrl: "https://s.example.jp/admin",
  allowedOrigins: ["https://s.example.jp"],
  admins: ["owner@example.com", "operator@example.com"],
  mail: { from: "試験の店 <info@shop.example.jp>", notifyTo: "owner@example.com", replyTo: "info@shop.example.jp" },
  privacyUrl: "https://shop.example.jp/privacy-policy/",
  privacyVersion: "2026-10-05",
  showcase: { text: "この予約画面は、試験の予約システムで動いています", url: "https://line.example.jp/shop" },
  defaults: { bufferMinutes: 30, leadDays: 2, horizonDays: 60 },
  maxLen: { name: 50 },
  dailyLimit: 15,
  perContactDailyLimit: 3,
  accessLogDays: 90,
  slotDaysAhead: 60,
});
