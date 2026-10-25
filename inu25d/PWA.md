# ホーム画面から起動するPWA候補

基準は同画面2人協力までの検証済みコミット `5cc0a3e90249cd692ae6dd4257d17cd4833a1db5` です。別端末オンライン候補 `527702c8e0299e702751cad9b22df0171a915798` は含みません。App Store / Google Playのネイティブアプリではありません。

## ファイルと公開範囲

- `inu25d/app/index.html`：アプリの入口
- `inu25d/app/game.html`：Three.jsを含むゲーム本体。1人用と同画面2人協力
- `inu25d/app/install.html`：iPhone / iPad / Androidの追加手順
- `inu25d/app/app.webmanifest`、`sw.js`、`version.json`、`icons/`
- 編集元：`inu25d/pwa/`、生成：`node tools/build25d-pwa.cjs`

公開先は、既存プレビューの下の **`inu25d/app/`** を想定しています。生成物の相対URL解決は試験済みですが、新しい公開URLのHTTP応答は未確認です。現時点では公開済みのアプリURLとして案内しません。既存Pagesワークフロー、ルートのマニフェストや他ゲームは変更していません。

`start_url` は `./game.html?app=1`、`scope` は `./`。ワーカーも同じフォルダー内でのみ登録します。マニフェストの相対`id`はオリジン基準になるため指定せず、正しく解決される`start_url`を既定のアプリ識別子に使います。

URL解決の根拠：[MDN start_url](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/start_url)、[scope](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/scope)、[id](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id)。

## 追加と起動

初回は公開HTTPS上でオンライン起動し、アプリメニューの保存状態を確認してください。

- **iPhone**：Safariの共有から「ホーム画面に追加」。「Webアプリとして開く」が出たらオンにして追加。
- **iPad**：Safariの共有→必要なら「さらに表示」→「ホーム画面に追加」。Webアプリとして開いて追加。
- **Android**：Chromeのメニュー→「インストールとショートカットを作成」→「インストール」。アプリ内に追加ボタンが出る場合もあります。

表示名はOS・ブラウザの版によって変わります。ホーム画面から起動した初回にもオンラインで保存を確認してください。横向きを推奨し、縦向きでも既存の対応レイアウトを維持します。

公式手順：[Apple iPhone](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios)、[Apple iPad](https://support.apple.com/guide/ipad/open-as-web-app-ipad8f1f7a29/ipados)、[Google Android](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid)

## キャッシュと更新

生成時のゲーム・アプリUI・ワーカー・ビルダー・アイコンからリリースIDを作り、配信する各ファイルのSHA-256をワーカーに記録します。生成テキストはLFに固定し、アプリ内の`.gitattributes`でGit経由でも同じバイト列を維持します。

インストール時は明示した10ファイルだけを同一オリジン・同一アプリ範囲で取得し、全ファイルの内容が一致してから保存します。不完全な更新では新しいキャッシュだけを破棄し、以前の保存を残します。認証ヘッダー、任意のクエリ、非GET、別ゲーム、外部オリジン、private/no-store・リダイレクト応答は保存しません。`version.json`はライブの更新確認用で保存しません。

通常はネットワーク優先です。保存済みファイルがあれば、通信断や3.5秒を超える待機時に保存版を返します。保存先へのアクセス・容量エラーがあっても、成功したネットワーク応答は返します。保存状態は確認後に表示し、保存が失われた場合はアプリメニューから再保存できます。

更新が見つかってもプレイ中には勝手に再読込しません。「タイトルへ戻って更新（プレイ終了）」で両者の入力を消去し、タイトルへ戻してから切り替えます。別タブで更新されても、そのタブのプレイは再読込しません。古い保存版と新しい本体が異なる場合は区別して表示します。保存の削除・OS制限があるため、常時オフライン動作を保証するものではありません。

## ローカル検証

```powershell
node tools/build25d-pwa.cjs
node tests/25d/pwa_cpu.cjs
node tests/25d/pwa_ui_cpu.cjs
node tests/25d/pwa_build_variant.cjs
node tools/test25d-cpu.cjs
```

マニフェストのプレビューパス、PNG寸法、元ゲームの一致、再現ビルド、ワーカーのキャッシュ・範囲・更新・障害処理、アプリUIによる入力消去を試験します。既存の19 CPUスイートも再実行します。

これらはNode VM、CacheStorageやDOM等の試験用API、実際の暗号ハッシュとResponseを使った検証です。ブラウザの本当のService Worker起動・インストール判定、iPhone/iPad/Androidのホーム画面追加、オフライン再起動、実タッチと描画、公開後のHTTP/MIME確認は未完了です。以前のブラウザ・端末操作の拒否を再試行・迂回していません。

公開前後には、保存済みの固定コミットを保ちつつリモートの新しい変更を再確認し、この別候補を通常の履歴で統合します。その後、配信された`version.json`・`game.html`・ワーカーの内容/MIME、パス、実機インストール、更新後に古い版が残らないことを確認する必要があります。ストア登録、アカウント、証明書、外部ホスティング、新しい認証・権限、Library保存は行っていません。
