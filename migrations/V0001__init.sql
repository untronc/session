-- 時間枠のセッションの予約（基本設計書の 3節）
-- 汎用 SQL で書く（SQLite・PostgreSQL・MySQL で同じ文が通る形。宿泊の予約システム（untronc/yoyaku）と同じ決まり）。ID はアプリが作る UUID
-- 日時は日本時間の 'YYYY-MM-DDTHH:MM'（文字の順＝時刻の順）。記録の日時（created_at など）は ISO・UTC
-- どの表にも監査項目（created_at・created_by・updated_at・updated_by。だれは Google のアカウントID か guest／system）を付ける

-- 管理画面の利用者（宿泊の予約システムと同じ形）
CREATE TABLE IF NOT EXISTS admin_users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  google_sub VARCHAR(64),
  display_name VARCHAR(100) NOT NULL,
  active INTEGER NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL
);
CREATE UNIQUE INDEX admin_users_sub ON admin_users(google_sub);
CREATE UNIQUE INDEX admin_users_email ON admin_users(email);

-- セッション（商品）
CREATE TABLE IF NOT EXISTS services (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  minutes INTEGER NOT NULL,
  survey_url VARCHAR(500),
  sort_order INTEGER NOT NULL,
  visible INTEGER NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL
);

-- コース（セッションの中の選び方）。料金は税込の円
CREATE TABLE IF NOT EXISTS courses (
  id VARCHAR(36) PRIMARY KEY,
  service_id VARCHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500),
  price INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  visible INTEGER NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  FOREIGN KEY (service_id) REFERENCES services(id)
);

-- くり返しの枠（毎週の決まり）。曜日は 0＝日〜6＝土。終わりの日が空なら、ずっと
CREATE TABLE IF NOT EXISTS slot_rules (
  id VARCHAR(36) PRIMARY KEY,
  weekday INTEGER NOT NULL,
  start_time VARCHAR(5) NOT NULL,
  minutes INTEGER NOT NULL,
  from_date VARCHAR(10) NOT NULL,
  to_date VARCHAR(10),
  active INTEGER NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL
);

-- 枠（予約を受ける1つの日時）。くり返しの枠から作ったものは rule_id を持つ。同じ決まり・同じ開始の枠は1つだけ
CREATE TABLE IF NOT EXISTS slots (
  id VARCHAR(36) PRIMARY KEY,
  start_at VARCHAR(16) NOT NULL,
  minutes INTEGER NOT NULL,
  state VARCHAR(10) NOT NULL,          -- open／closed
  rule_id VARCHAR(36),
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  FOREIGN KEY (rule_id) REFERENCES slot_rules(id)
);
CREATE INDEX slots_start ON slots(start_at);
CREATE UNIQUE INDEX slots_rule_start ON slots(rule_id, start_at);

-- 予約（ネットの予約・手で入れた予約・打ち合わせ）。予約番号は受付の日 yyMMdd-4桁
CREATE TABLE IF NOT EXISTS bookings (
  id VARCHAR(20) PRIMARY KEY,
  kind VARCHAR(10) NOT NULL,           -- session／meeting
  source VARCHAR(10) NOT NULL,         -- web／manual
  status VARCHAR(10) NOT NULL,         -- hold（仮押さえ）／confirmed／cancelled
  start_at VARCHAR(16) NOT NULL,
  end_at VARCHAR(16) NOT NULL,
  slot_id VARCHAR(36),                 -- 枠の外に手で入れた予約は空
  service_id VARCHAR(36),              -- 打ち合わせは空
  course_id VARCHAR(36),
  name VARCHAR(100) NOT NULL,          -- 個人情報（打ち合わせは題）。消さない（要件 5節「個人情報」）
  google_email VARCHAR(254),           -- 個人情報。セッションで使う Google アカウントのアドレス（ネットの予約は必須）
  contact_email VARCHAR(254),          -- 個人情報。連絡用（任意）。あれば、お客様へのメールはこちらへ
  send_mail INTEGER NOT NULL,          -- お客様へメールを送るか（手で入れた予約は選べる）
  calendar_event_id VARCHAR(200),
  meet_url VARCHAR(300),
  change_count INTEGER NOT NULL,       -- 日時の変更の回数（無料は1回まで）
  privacy_agreed_at VARCHAR(32),
  privacy_version VARCHAR(20),
  mail_hold VARCHAR(300),              -- 振込先のメール：sent／skipped: 理由／failed: 理由／none
  mail_confirm VARCHAR(300),           -- 予約確認メール
  mail_remind VARCHAR(300),            -- 前日のメール
  mail_notify VARCHAR(300),            -- 運用者への予約通知
  received_at VARCHAR(32) NOT NULL,
  cancelled_at VARCHAR(32),
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  FOREIGN KEY (slot_id) REFERENCES slots(id),
  FOREIGN KEY (service_id) REFERENCES services(id),
  FOREIGN KEY (course_id) REFERENCES courses(id)
);
CREATE INDEX bookings_time ON bookings(status, start_at, end_at);
CREATE INDEX bookings_slot ON bookings(slot_id);

-- 支払い（予約1件に1つ）。振込だけ。金額は税込の円
CREATE TABLE IF NOT EXISTS payments (
  booking_id VARCHAR(20) PRIMARY KEY,
  amount INTEGER NOT NULL,
  pay_state VARCHAR(10) NOT NULL,      -- unpaid（振込待ち）／paid（入金済み）／free（0円・請求しない）
  due_date VARCHAR(10),                -- 振込の期限（日本時間の日。この日の終わりまで）
  payer_name VARCHAR(100),             -- 個人情報。振込の名義（入金を照らすため）
  paid_on VARCHAR(10),
  cancel_rate INTEGER,                 -- キャンセル料の率（0／50／100）
  cancel_fee INTEGER,
  operator_fault INTEGER,              -- 運用者の都合でのキャンセルなら 1（全額返金）
  transfer_fee INTEGER,                -- 返金の振込手数料（差し引く）
  refund_amount INTEGER,
  refunded_on VARCHAR(10),
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id)
);

-- 予約の変更履歴（前と後は JSON）
CREATE TABLE IF NOT EXISTS booking_changes (
  id VARCHAR(36) PRIMARY KEY,
  booking_id VARCHAR(20) NOT NULL,
  kind VARCHAR(20) NOT NULL,           -- create／paid／release／cancel／reschedule／refund／info
  before_json TEXT,
  after_json TEXT,
  changed_at VARCHAR(32) NOT NULL,
  changed_via VARCHAR(10) NOT NULL,    -- admin／guest／system
  changed_by_user_id VARCHAR(36),
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id),
  FOREIGN KEY (changed_by_user_id) REFERENCES admin_users(id)
);
CREATE INDEX booking_changes_booking ON booking_changes(booking_id, changed_at);

-- 枠・くり返しの枠の変更履歴（どちらか一方を指す）
CREATE TABLE IF NOT EXISTS slot_changes (
  id VARCHAR(36) PRIMARY KEY,
  slot_id VARCHAR(36),
  rule_id VARCHAR(36),
  kind VARCHAR(20) NOT NULL,           -- open／close／rule_add／rule_end
  before_json TEXT,
  after_json TEXT,
  changed_at VARCHAR(32) NOT NULL,
  changed_by_user_id VARCHAR(36),
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  FOREIGN KEY (slot_id) REFERENCES slots(id),
  FOREIGN KEY (rule_id) REFERENCES slot_rules(id),
  FOREIGN KEY (changed_by_user_id) REFERENCES admin_users(id)
);

-- 設定（前後の空ける時間・受付の締め切りと先・見るカレンダー・振込先の口座など）。振込先の口座は運用者が管理画面で入れる
CREATE TABLE IF NOT EXISTS settings (
  setting_key VARCHAR(40) PRIMARY KEY,
  value VARCHAR(2000) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL
);

-- 不正利用対策の数（日ごと・連絡先の印ごと）と、予約画面の操作ログ（個人情報なし）。宿泊の予約システムと同じ形
CREATE TABLE IF NOT EXISTS daily_counts (
  day VARCHAR(10) NOT NULL,
  mark VARCHAR(20) NOT NULL,
  n INTEGER NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  PRIMARY KEY (day, mark)
);
CREATE TABLE IF NOT EXISTS access_log (
  id VARCHAR(36) PRIMARY KEY,
  received_at VARCHAR(32) NOT NULL,
  client_at VARCHAR(30),
  visit_id VARCHAR(20),
  action VARCHAR(20),
  result VARCHAR(10),
  ms INTEGER,
  error VARCHAR(300),
  detail VARCHAR(200),
  width VARCHAR(10),
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL
);
CREATE INDEX access_log_received ON access_log(received_at);
