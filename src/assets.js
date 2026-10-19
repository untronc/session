// Worker の静的ファイル（public/。各施設の wrangler.jsonc の assets）で配る Bootstrap の住所。
// 中身は npm で入れた物を dev/copy-vendor.mjs が写す（npm install のたびに自動）。版を変えるときは package.json とここをそろえる
export const BOOTSTRAP_VERSION = "5.3.3";
export const ICONS_VERSION = "1.11.3";
export const BOOTSTRAP_CSS = `/vendor/bootstrap-${BOOTSTRAP_VERSION}/bootstrap.min.css`;
export const BOOTSTRAP_JS = `/vendor/bootstrap-${BOOTSTRAP_VERSION}/bootstrap.bundle.min.js`;
export const ICONS_CSS = `/vendor/bootstrap-icons-${ICONS_VERSION}/bootstrap-icons.min.css`;
