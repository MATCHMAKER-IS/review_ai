/** @type {import('next').NextConfig} */
const nextConfig = {
  // serverExternalPackages に "pg" を入れてはいけません。
  //
  // 指定すると Next はバンドルせず実行時解決に回しますが、
  // Amplify のパッケージングが node_modules を Lambda に同梱しないため
  // 「Cannot find module 'pg'」でモジュール読み込み段階から落ちます。
  //
  // この指定が要るのは better-sqlite3 や sharp のようなネイティブ
  // モジュールで、pg は該当しません（pg-native はオプション依存で
  // 未インストール）。バンドルさせて問題ありません。
};

export default nextConfig;
