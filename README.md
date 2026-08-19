# Ichiki

**制約付きモックアップ（HTML/CSS）を WordPress クラシックテーマへ決定的に変換する。**
同じモックなら毎回同じテーマになる。LLM は使わない。

```bash
node bin/ichiki.js --help
```

## 考え方

デザインは主観なので人がモックで合意する。構造は客観なので機械が検査する。
その境目を **モック側の宣言（`data-*`）** で引く。

```html
<body data-page="single" data-cpt="spot">
  <section data-section="detail">
    <h1 data-acf="hero_title">平尾台</h1>
```

宣言があれば推測は要らない。**宣言が足りなければエラーで停止する。** 推測して埋めない。

規約は `rules/vocabulary.md`（L01〜L31）。lint がその実装で、
`prompts/mockup-generation.md` が AI にモックを作らせるときの指示書。
**3者はルールIDで対応**していて、`ichiki selftest` がズレを検出する。

## 使う

```bash
# 1. モックが規約に適合しているか
ichiki lint <mockup>

# 2. フィールド台帳を出す
ichiki scan <mockup> <出力先>

# 3. テーマを生成する
ichiki build <mockup> <テーマの置き場所> --acf-map <出力先>/acf-map.yaml

# まとめて（lint → a11y → scan → build → 検証 → php -l）
ichiki gate <mockup>
```

案件ごとの設定は案件リポジトリの `.ichiki.json` に置く。

```jsonc
{
  "project": "案件名",
  "mockup": "./",
  "theme_dir": "…/wp-content/themes/…",
  "site_url": "http://localhost:10000",
  "ichiki_version": "0.3.0"
}
```

`ichiki_version` を書いておくと、本体とのバージョン違いを警告する。
案件ごとに submodule を固定する運用では版ズレが起きるので、**気づけるようにしてある。**

## 構成

```
bin/ichiki.js     単一入口。使えるものは全部 --help に出る
src/
  lint/           規約への適合（L01〜L31）
  scan.js         → acf-map.yaml / field-map.json / coverage.json / CLAUDE.md
  converter/      → WordPress テーマ
  verify/         coverage（宣言→出力）/ structure（class の維持）/ live（公開後）
  a11y/           pa11y + axe（WCAG2AA）
  visual/         compare（元モック↔制約モック）/ diff（モック↔WP）/ crop
  testspec/       C1 テスト仕様書 / C3 検収シート / C3付録
  shared/         lint と変換器が共有する定数・分類・パス正規化
  gate.js         上を順に流す
  snapshot.js     出力を凍結し、変わったら落とす
rules/            ichiki.md（固定ルール）/ vocabulary.md（制約語彙）
prompts/          モックアップ生成プロンプト
templates/        案件用 CLAUDE.md のテンプレート
commands/         Claude Code のスラッシュコマンド（/setup /run）
test/             fixture / mockup-bad / expected と自己検査
```

## 検査

```bash
ichiki selftest
```

| | |
|---|---|
| scan の回帰 | `test/fixture` の出力が `test/expected` と一致するか |
| ルール同期 | 語彙・lint・プロンプトの3者にルールIDが揃っているか |
| 負のテスト | **全ルールが実際に違反を検出できるか**（`test/mockup-bad`） |

3つ目が要るのは、**検査が通っていても検査自体が壊れていることがある**ため。
実測で、フィールド突合が名前で照合したまま出力がキー指定に変わり、
ずっと素通りしていた（3/327 で「通った」と言い続けていた）。

## セットアップ

```bash
npm install
npx playwright install chromium   # 見た目の比較を使うとき
```

## 対象と前提

WordPress 6.5+ / PHP 8.1+ / クラシックテーマ。
必須プラグイン: Advanced Custom Fields（無料版）/ Safe SVG / Contact Form 7。
ACF PRO 専用機能（Repeater / Flexible Content / オプションページ）には依存しない。
