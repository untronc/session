// npm で入れた Bootstrap と Bootstrap Icons を、Worker の静的ファイル（public/）へ写す。npm install・npm ci のたびに自動で動く（package.json の postinstall）
// 写す先の住所には版を入れる（/vendor/bootstrap-5.3.3/…）。版が変わると住所も変わるので、長く覚えさせても古い物が残らない。住所は src/assets.js と同じにすること
// public/vendor/ は作った物なので Git に入れない（.gitignore）
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { BOOTSTRAP_VERSION, ICONS_VERSION } from "../src/assets.js";

const root = new URL("..", import.meta.url);
const nm = (p) => new URL(`node_modules/${p}`, root);
const out = new URL("public/vendor/", root);
const version = (pkg) => JSON.parse(readFileSync(nm(`${pkg}/package.json`), "utf8")).version;

// npm で入れた版と、画面が読む住所の版が合っているか（合わなければ止める）
for (const [pkg, want] of [["bootstrap", BOOTSTRAP_VERSION], ["bootstrap-icons", ICONS_VERSION]]) {
  const got = version(pkg);
  if (got !== want) throw new Error(`${pkg} の版が ${got}（src/assets.js は ${want}）。どちらかに合わせてください`);
}

rmSync(out, { recursive: true, force: true });
const bs = new URL(`bootstrap-${BOOTSTRAP_VERSION}/`, out);
const bi = new URL(`bootstrap-icons-${ICONS_VERSION}/`, out);
mkdirSync(bs, { recursive: true });
mkdirSync(new URL("fonts/", bi), { recursive: true });
cpSync(nm("bootstrap/dist/css/bootstrap.min.css"), new URL("bootstrap.min.css", bs));
cpSync(nm("bootstrap/dist/js/bootstrap.bundle.min.js"), new URL("bootstrap.bundle.min.js", bs));
cpSync(nm("bootstrap/LICENSE"), new URL("LICENSE", bs));
cpSync(nm("bootstrap-icons/font/bootstrap-icons.min.css"), new URL("bootstrap-icons.min.css", bi));
for (const f of ["bootstrap-icons.woff2", "bootstrap-icons.woff"]) cpSync(nm(`bootstrap-icons/font/fonts/${f}`), new URL(`fonts/${f}`, bi));
cpSync(nm("bootstrap-icons/LICENSE"), new URL("LICENSE", bi));
console.log(`public/vendor/ に Bootstrap ${BOOTSTRAP_VERSION}・Bootstrap Icons ${ICONS_VERSION} を写しました`);
