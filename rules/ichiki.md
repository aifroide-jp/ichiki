# Ichiki 固定ルール（mockup→WordPress）

<!-- 全案件共通。案件用CLAUDE.mdから @import される。ここは案件ごとに書き換えない -->

## プロジェクト前提
- WordPress 6.5+ / PHP 8.1+ / Classicテーマ（ブロックテーマ・FSEは対象外）
- 必須プラグイン: Advanced Custom Fields（無料版）/ Safe SVG / Contact Form 7
- 言語: 日本語単一 / 本番: エックスサーバー / 開発: Local

## ACF生成ルール
- 全編集対象要素をACFフィールド化する
- 命名規則: `{セクション名}_{要素種別}_{連番}`（連番は同種が複数あるときだけ付与。例: hero_title, features_icon_1）
- ページIDは mockup フォルダからの相対パスで生成する。index.html はディレクトリ名に畳む（例: about/index.html → about、center/biotope.html → center_biotope）。ルート直下の index.html は index
- タブ分類:
  - ①メインコンテンツ: h1〜h3・p・メイン領域のimg（初期展開）
  - ②セクション別: セクション内の繰り返し要素・サブ画像・機能アイコンSVG（初期展開）
  - ③装飾要素: `class*="bg-/pattern-/deco-"`・`aria-hidden="true"` のSVG/画像（折りたたみ）
- デフォルト値: mockup内の値をACFデフォルト値として登録する
- 繰り返し要素は固定数前提。連番フィールドで表現する（可変数のセクションは対象外、または案件CLAUDE.mdの除外で手動指定）

## ナビ・フォーム・メタ
- nav要素はWPカスタムメニューへ変換する
- form要素はContact Form 7のショートコードへ置換する
- OGP / Twitter Card / 基本meta（title, description）を出力する。SEOプラグインに依存しない

## 共通領域の扱い
- Phase 0 の scan は、全ページの半数以上で完全一致するセクション（footer・header・cta等）を検出し、`common` キーとして acf-map.yaml に1回だけ出力する。各ページからは該当セクションを除外する。
- Phase 1 で WPテーマ化する際、`common` のフィールドを共通テンプレ（header.php / footer.php）に配置し、共通の nav はカスタムメニューに名寄せする。
- 共通化の判定は「セクションID＋各フィールドの名前と値」の署名による完全一致。閾値はページ数の半数（切り上げ、最低2）。

## セクション分類の既知の弱点（人手レビュー対象）
- セクション名は「id を持つ祖先 → セクションタグの祖先 → section風クラスの祖先」の順で決まる。意図しないラッパーを拾うことがあるため、`/setup` 手順4で命名を確認する。
- hero/main 判定はクラス・id の部分一致（hero/main/top/kv/mv）で行う。`topic` `main-visual` 以外の語に誤マッチする余地があるため、main タブの分類は目視確認する。
- id も意味のある class も無いセクション（<section style="..."> 等）は、タグ名＋ページ内DOM出現順の連番で区別する（例: section_3、section_8）。後処理（Claude Code）が中身の見出しを見て意味名にリネームする
- class 名がタグ名と同じ（例: <section class="section white">）場合、section は意味名とみなさず次の class（white）を採用するか連番にフォールバックする

## アクセシビリティ
- WCAG 2.0 AA。自動検出できる範囲を対象とする
- pa11y-ci + axe-core を GitHub Actions で実行し、AA違反があればPRをマージブロックする
- 自動で拾えない項目（alt文言の妥当性、読み上げ順序の意味）は人手レビューで別途担保する

## 成果物
- テスト仕様書（Markdown + PDF、1画面1テスト、YES/NO判定）を自動出力する
- 本番リリース手順書（Markdown、エックスサーバー向け）を自動出力する
