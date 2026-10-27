-- コンサルの相手・月額の契約・月ごとの入金（基本設計書 第2版 3節。F18〜F20）
-- 汎用 SQL で書く（SQLite・PostgreSQL・MySQL で同じ文が通る形）。ID はアプリが作る UUID。どの表にも監査項目を付ける
-- 月は 'YYYY-MM'、日は 'YYYY-MM-DD'（日本時間）。金額は税込の円

-- コンサルの相手（予約画面からのお客様は入れない）
CREATE TABLE IF NOT EXISTS clients (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,          -- 個人情報。消さない
  memo VARCHAR(500),
  visible INTEGER NOT NULL,            -- 手で入れる予約の選び肢に出す（1）／出さない（0）
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL
);

-- 月額の契約。終わりの月が空なら続く
CREATE TABLE IF NOT EXISTS contracts (
  id VARCHAR(36) PRIMARY KEY,
  client_id VARCHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  monthly_amount INTEGER NOT NULL,
  start_month VARCHAR(7) NOT NULL,
  end_month VARCHAR(7),
  memo VARCHAR(500),
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);
CREATE INDEX contracts_client ON contracts(client_id);

-- 契約の1か月ぶんの入金。入金の日が入っていれば入金済み、空なら未入金（外した）。金額は初めは月額を写し、直せる
CREATE TABLE IF NOT EXISTS contract_payments (
  id VARCHAR(36) PRIMARY KEY,
  contract_id VARCHAR(36) NOT NULL,
  month VARCHAR(7) NOT NULL,
  amount INTEGER NOT NULL,
  paid_on VARCHAR(10),
  created_at VARCHAR(32) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  updated_by VARCHAR(64) NOT NULL,
  FOREIGN KEY (contract_id) REFERENCES contracts(id)
);
CREATE UNIQUE INDEX contract_payments_month ON contract_payments(contract_id, month);
CREATE INDEX contract_payments_paid ON contract_payments(paid_on);

-- 予約に相手を付ける（任意）。外部キーは ALTER の中では書かず（MySQL が黙って捨てるため）、アプリが clients にあるか確かめる
ALTER TABLE bookings ADD COLUMN client_id VARCHAR(36);
CREATE INDEX bookings_client ON bookings(client_id);
