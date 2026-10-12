# UEビルド障害（AppControl 0x800711C7）独立再診断 — 2026-10-12

## 0. 前提：この再診断で「できたこと／できなかったこと」

この診断は、クラウド上のLinuxコンテナ（GitHubリポジトリ `Kuchiwan` のクローンのみ）から実施した。

- 対象のWindows PCには到達できない。C:\ドライブ、イベントログ、UEインストール、プロセス一覧、
  Work155〜159、ローカルの ironwake-repo にはいずれもアクセスできない。
  この環境には、リモートデスクトップ操作やPC上の別セッションとの連携もない。
- 前任の診断資料（`ue-block-reason-20261011/result.json`、`ue-trusted-build-research-20261011/*`）は、
  GitHub上のどのブランチにも存在しない（全リモートブランチを検索済み）。
- したがって、**実ファイル・実ログ・UE 5.7.4同梱ソースによる検証、修復、ビルド、起動確認は一つも実施していない。**
  Windowsへの変更、プロセスの終了、外部への送信、GitHubへのpushも行っていない。

この文書の内容は次の2つから成る。

1. ユーザーが提示した症状と公開情報からの論理的な再検討。根拠の確度ごとに明示する。
2. PC上でそのまま実行できる**読み取り専用**の証拠収集スクリプト（`Collect-UEBuildBlockEvidence.ps1`）。

---

## 1. 確度別の整理

### 1-A. 提示された事実から強く支持されること（ただし実物で再確認が必要）

| # | 内容 | 根拠 |
|---|---|---|
| A1 | 直接の拒否主体は Smart App Control（SAC）の `VerifiedAndReputableDesktop` ポリシー | CodeIntegrityイベントのポリシー名、イベントと実ファイルのSHA256一致（ユーザー提示） |
| A2 | 0x800711C7 は「Application Control ポリシーがファイルをブロックした」という意味で、UBTやDLLの破損を示すコードではない | エラーコードの定義。同じエラーでUBTのルールDLLが拒否されたUEプラグインCIの事例あり（[Open3DBroadcast PR #300](https://github.com/lifelike-and-believable/Open3DBroadcast/pull/300)） |
| A3 | SAC には、アプリ単位の例外や許可リストを作る機能がない（On／評価／Off の3択） | 公開Q&Aや報道（後掲）。Microsoft一次資料はこの環境からは取得できず、**未照合** |

### 1-B. 前任の診断に対する独立した疑義（いずれも仮説。実物での検証が必要）

**B1. 「MarketplaceRules.dll だけが問題」という見立ては、読み込み順による見かけにすぎない可能性が高い。**

UBT は、ルールアセンブリを Engine → Marketplace → Project（+プロジェクトプラグイン）の順に親子関係で構築する（私の記憶によるUBTの構造。5.7.4の実ソースでは未照合）。
Marketplace の段階で拒否されると、プロジェクト側の `InnuUnrealModuleRules.dll` などの読み込みまで処理が進まない。

プロジェクト側のルールDLLも、ローカルでコンパイルされた未署名DLLで、コンパイルのたびにハッシュが変わる。SAC から見れば同じ性質のファイルである。
実際に、プラグイン自身の `...ModuleRules.dll` が同じ 0x800711C7 で拒否された事例がある（上記PR）。

→ **Fabプラグイン（FabLauncher／Tempered Glass）を外したりアンインストールしたりしても、次はプロジェクトのルールDLLで同じ拒否が起きる可能性が高い。** つまり、その操作では解決しない見込みが大きい。
→ 検証方法：スクリプトの §2（CodeIntegrityイベント）と §3（BuildRules配下のDLL一覧）で、プロジェクト側ルールDLLの作成日時と、それが拒否・監査された履歴があるかを見る。

**B2. 「両ゲームが両プラグインに依存していない」ことは、MarketplaceRules が必要になるかどうかとは関係しない可能性が高い。**

インストール版エンジンでは、`Engine/Plugins/Marketplace` に入っているプラグインのBuild.csが、プロジェクトでの有効・無効に関係なく Marketplace ルールアセンブリにまとめてコンパイルされる、という構造だと理解している（記憶による。**5.7.4ソースで未照合**）。
DLLの置き場所が `%LOCALAPPDATA%\UnrealEngine\Intermediate\Build\BuildRules` なのも、インストール先（Program Files）が書き込み不可だからだと考えられる。
→ スクリプトの §6 で、`RulesCompiler.cs` の該当行と、Marketplace配下の `.uplugin` 一覧を抽出する。

**B3. 155が成功し157が失敗した境目は「makefileがあったかどうか」だという指摘は筋が通る。ただし、makefileが消えた理由のほうが重要。**

157のログは「`(no existing makefile)`」、つまりファイル自体が存在しなかったことを示している。makefileが古くなって無効と判定された、という意味ではない。
もし Candidate157/Build157 のように**候補ごとに新しいフォルダへコピーしてビルドする運用**だったなら、Intermediate が毎回空になる。その結果、makefileもルールDLLも毎回新規に作られ、SAC on の状態では毎回拒否されることになる。
→ 検証方法：§4（Makefile.bin の所在と日時）と §5（各ログの `Creating makefile` 行とビルド先パス）を、155と157で比べる。

**B4. 以前のビルドで新しいmakefileが作れていた時期があるなら、SACの状態が途中で変わった可能性がある。**

SAC は「評価モード」から自動で「On」に切り替わることがある。評価中は監査イベント（3076）だけが記録され、拒否はされない。
→ 検証方法：§1 のレジストリ値（`VerifiedAndReputablePolicyState`：0=Off／1=On／2=評価）と、§2 で 3076（監査）が 3077（実際の拒否）に変わった日時を見る。これが分かれば「なぜ以前は通ったか」が確定する。

**B5. IOException（ファイル使用中）は、二次的な現象である可能性が高い（未確定）。**

拒否直後の再コンパイルで、同じDLLが次のいずれかに保持されていた可能性がある。

- 同じ UBT（dotnet）プロセス自身
- Defender／CodeIntegrity のスキャン
- 別の UBT／エディタ／Live Coding プロセス
- AI実行環境の別プロセス

→ 検証方法：§7 のプロセス一覧で UnrealBuildTool／dotnet／UnrealEditor の多重起動を確認する。確定させるには、ロック発生中に Sysinternals `handle.exe` などで所有者を確認する必要がある（読み取りのみの操作）。

**B6. 「AI実行環境の権限制約が原因か」は、切り分けが簡単。**

SAC はマシン単位で効く。そのため、誰が・どのシェルからビルドしても判定は変わらないはずである。
ユーザー本人が通常のエディタ（またはエディタのビルドボタン）で同じビルドを1回行い、同じ 3077 イベントが記録されれば、AI実行環境は原因から外れる。

### 1-C. 解消経路の評価（「正規の手順」か「拒否の回避」かを区別する）

| 経路 | 区分 | 評価 |
|---|---|---|
| makefileが有効な状態で、既存プロジェクトをそのまま差分ビルドする | **UBTの通常手順**（UBT自身が有効性を判定している限り） | 既存の .cpp/.h の編集だけなら、新しいmakefileが要らず通る可能性がある。ただし次の場合はmakefileの再生成が必要になり、再び失敗する：新規ソースファイルの追加、Build.cs／Target.cs／.uproject／プラグイン構成の変更、エンジン更新など。**他のフォルダのmakefileやDLLをコピーして流用するのは、回避策にあたるので不可。** 根本的な解決ではない |
| Fabプラグインをプロジェクトで無効化する／エンジンからアンインストールする | プロジェクトで無効化：**効果がない見込み**（B2）。アンインストール：**拒否の回避であり、しかも不十分**（B1） | 推奨しない |
| 生成DLLに正規の証明書で署名する | 正規の信頼経路だが**実用的でない** | UBTはルールDLLをコンパイルした直後に同じプロセス内で読み込むため、署名を挟む公式の仕組みがない（記憶による。未照合）。DLLを改変することにもなり、守る条件に反する |
| Epic公式の修正・告知 | 正規の経路 | 「Smart App Control × UBTルールDLL」についてEpicの公式な修正や告知は**見つからなかった**（公開検索の範囲）。非公開のEpicサポートへの問い合わせ（未送信の下書きあり）は選択肢になる。外部への送信になるので、承認が必要 |
| SAC を Off にする（ユーザー本人の判断で） | Microsoftが用意している正規の設定 | 開発機では事実上これが唯一の恒久的な解決になる見込み。2026年4月の累積更新（KB5083769と報じられている）以降は、再インストールせずにOnへ戻せるという報道がある（**Microsoft一次資料で未照合**）。**AIが勝手に変更してはならない。ユーザー本人の判断事項** |
| 別のPCやCIでビルドする | 守る条件「拒否された操作を別環境に移さない」に該当 | ユーザーの明示的な承認がない限り実施しない |

---

## 2. 次に必要な操作（ユーザー側）

1. **このフォルダの `Collect-UEBuildBlockEvidence.ps1` をPCで実行する**（管理者のPowerShellを推奨）。
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File .\Collect-UEBuildBlockEvidence.ps1
   ```
   - 変更・終了・削除・送信は一切しない。書き込むのは `%TEMP%\ue_appcontrol_diag_*.txt` の1ファイルだけ。
   - 出力にはユーザー名入りのパスやコミット履歴が含まれる。共有するかどうか、どこまで共有するかはユーザーが判断する。
2. 出力テキストを、このセッション（または後続のセッション）に貼るかアップロードする。それを受けて、B1〜B6 を「確定」か「否定」に振り分ける。
3. 結果に応じて、ユーザーが判断する：
   - (a) Work159 の変更が既存ファイルの編集だけで、元プロジェクトのmakefileが有効な場合は、通常の差分ビルドを試す（UBTの通常手順。ただし根本的な解決ではない）。
   - (b) 新規ファイルの追加などでmakefileの再生成が避けられない場合は、SAC を Off にするかどうかをユーザーが判断する。または、Epicサポートへの問い合わせ文の送信を承認する。
4. ビルドできた後の確認手順（その時点で実施）：
   - ゲームが終了していることを確認する（強制終了はしない）。
   - ビルド後、`Binaries\Win64\UnrealEditor-InnuUnreal*.dll` などのタイムスタンプとハッシュが新しくなったことを確認する。
   - 159の新しい攻撃ロジックが実際に動くことを、試遊で1本だけ確認する。

## 3. 参照した公開情報

- [Open3DBroadcast PR #300 — UBTのModuleRules.dllが0x800711C7で拒否された事例](https://github.com/lifelike-and-believable/Open3DBroadcast/pull/300)
- [Microsoft Learn: Code signing for Smart App Control](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control)（検索結果の要約のみ。本文は取得できず）
- [Microsoft Q&A: Application signed and blocked by Smart App Control](https://learn.microsoft.com/en-us/answers/questions/5791210/application-signed-and-blocked-by-smart-app-contro)
- [Neowin: SAC no longer requires clean install to re-enable](https://www.neowin.net/news/this-windows-11-feature-no-longer-requires-clean-installing-the-system-to-activate-it/)
- [Topedia: SAC can now be re-enabled without reinstalling (2026-04)](https://blog-en.topedia.com/2026/04/smart-app-control-in-windows-11-can-now-be-re-enabled-without-reinstalling/)
- [Windows Latest: Microsoft confirms SAC toggle without reinstall (2025-12)](https://www.windowslatest.com/2025/12/16/microsoft-confirms-you-can-soon-disable-smart-app-control-without-reinstalling-windows-11/)
- [Epic forum: MarketplaceRules.dll does not exist](https://forums.unrealengine.com/t/marketplacerules-dll-does-not-exist/566285)（SACとは無関係。MarketplaceRulesの所在問題の参考）
