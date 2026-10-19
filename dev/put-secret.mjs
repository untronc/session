// 秘密の値を Worker に入れる道具（値は画面にもファイルにも出さない）。put-google-secret.mjs・put-resend-secret.mjs を1つにしたもの
//   node dev/put-secret.mjs <名前> <施設>      施設は sites/<施設>/wrangler.jsonc の名前
//   名前：RESEND_API_KEY・GOOGLE_CLIENT_SECRET（クリップボードから）／SESSION_SECRET（この道具が作る）
//
// 手順（Resend・Google の鍵を作るとき。2026-10-11〜12 に通した流れ）
//   1. Claude が鍵を作る画面をサイドパネルに出し、作る直前まで進める（名前・権限は Claude が入れる）
//   2. 運用者が「作成」と「コピー」を押す（Claude は鍵の欄の文字を読まない。ボタンの位置だけを伝える）
//   3. Claude がこの道具を流す：形を確かめる → 入れる → 入ったか一覧で確かめる → クリップボードを消す
//   ターミナルの入力欄（wrangler secret put）に貼ると1文字しか入らないことがあるので、貼らずにこの道具で渡す
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SHAPES = {
  RESEND_API_KEY: { from: "clipboard", ok: (v) => v.startsWith("re_") && v.length >= 20, hint: "re_ で始まる" },
  GOOGLE_CLIENT_SECRET: { from: "clipboard", ok: (v) => v.startsWith("GOCSPX-") && v.length >= 20, hint: "GOCSPX- で始まる" },
  SESSION_SECRET: { from: "generate" },
};

const [name, site] = process.argv.slice(2);
const shape = SHAPES[name];
if (!shape || !site) {
  console.log(`名前は ${Object.keys(SHAPES).join("・")} のどれか、施設は sites/ の下の名前。何も入れていません。`);
  process.exit(1);
}
const root = fileURLToPath(new URL("..", import.meta.url));
const config = `${root}sites/${site}/wrangler.jsonc`;
// wrangler は Node 22 以上が要る。このフォルダの .node-version の版（nodist）があればそれを使う
const ver = existsSync(`${root}.node-version`) ? readFileSync(`${root}.node-version`, "utf8").trim() : "";
const nodist = `C:/Program Files (x86)/Nodist/v-x64/${ver}/node.exe`;
const node = ver && existsSync(nodist) ? nodist : process.execPath;
const wrangler = (args, opts = {}) => execFileSync(node, [`${root}node_modules/wrangler/bin/wrangler.js`, ...args, "-c", config], { encoding: "utf8", ...opts });
const ps = (cmd) => execFileSync("powershell", ["-NoProfile", "-STA", "-Command", cmd], { encoding: "utf8" });

let v;
if (shape.from === "generate") {
  v = randomBytes(32).toString("base64url");
  console.log(`新しい値を作りました（${v.length} 文字）。`);
} else {
  v = ps("Get-Clipboard -Raw").trim();
  if (!shape.ok(v) || /\s/.test(v)) {
    console.log(`クリップボードの中身が ${name} の形（${shape.hint}）ではありません（${v.length} 文字）。何も入れていません。`);
    process.exit(1);
  }
  console.log(`形を確かめました（${v.length} 文字・${shape.hint}）。`);
}

console.log(`入れる先: sites/${site}（${name}）`);
wrangler(["secret", "put", name], { input: v, stdio: ["pipe", "inherit", "inherit"] });

const list = JSON.parse(wrangler(["secret", "list", "--format", "json"]));
const found = list.some((s) => s.name === name);
console.log(found ? `入ったのを一覧で確かめました（${name}）。` : `一覧に ${name} がありません。入っていないかもしれません。`);

if (shape.from === "clipboard") {
  ps("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear()");
  console.log("クリップボードを消しました。");
}
process.exit(found ? 0 : 1);
