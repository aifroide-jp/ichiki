# Ichiki

**制約付きモックアップ（HTML/CSS）を WordPress クラシックテーマへ決定的に変換する。**
同じモックなら毎回同じテーマになる。LLM は使わない。

```bash
node bin/ichiki.js --help
```

## はじめに（案件への入れ方）

Ichiki は案件リポジトリに **submodule** として入れて使う。

```bash
# 1. 取り込む
git submodule add https://github.com/aifroide-jp/ichiki .claude/ichiki
git submodule update --init --recursive

# 2. 依存を入れる
cd .claude/ichiki
npm install
npx playwright install chromium    # 見た目の比較を使うとき
cd ../..

# 3. スラッシュコマンドを配置する
mkdir -p .claude/commands
cp .claude/ichiki/commands/*.md .claude/commands/

# 4. 案件設定とフィールド台帳を作る
#    .ichiki.json が無ければ scan が作る。theme_dir と site_url は環境依存なので
#    空で出るので、書き足す。
node .claude/ichiki/bin/ichiki.js scan <モックのディレクトリ> <出力先>

# 5. 受け入れ状態を確認する
node .claude/ichiki/bin/ichiki.js doctor
```

手順3が要るのは、**Claude Code が `.claude/commands/` しか見ない**ため。
`.claude/ichiki/commands/` に置いても認識されないのでコピーする。

### 更新するとき

**手順3のコピーを必ずやり直すこと。** ここを忘れると古い手順が動き続ける。

```bash
cd .claude/ichiki
git fetch && git checkout <新しいコミット>
npm install
cd ../..
cp .claude/ichiki/commands/*.md .claude/commands/     # ← 忘れやすい
# .ichiki.json の ichiki_version も更新する
node .claude/ichiki/bin/ichiki.js doctor
```

`doctor` がコピーのズレとバージョン違いを見る。**忘れても気づけるようにしてある。**

> 実測: `commands/run.md` を新しい手順へ書き換えたのに、案件側は古いコピーのままで、
> `/run` を叩けば旧手順（AI が1ページずつテンプレートを書く）が動く状態だった。
> 書き換えた本人が塞げたと思い込んでいた。**静かに壊れるので、検査が要る。**

## 考え方

デザインは主観なので人がモックで合意する。構造は客観なので機械が検査する。
その境目を **モック側の宣言（`data-*`）** で引く。

```html
<body data-page="single" data-cpt="spot">
  <section data-section="detail">
    <h1 data-acf="hero_title">平尾台</h1>
```

宣言があれば推測は要らない。**宣言が足りなければエラーで停止する。** 推測して埋めない。

規約は `rules/vocabulary.md`（L01〜L31）が**唯一の正**。lint がその実装で、
両者はルールIDで対応する。`ichiki selftest` がズレを検出する。

`prompts/mockup-generation.md`（AI にモックを作らせる指示書）は**規約を持たない。**
「まず vocabulary.md を読む」と指示するだけ。以前は規約を再掲していたが、
語彙が育つたびに両方を直すことになり、`data-acf-type` 15箇所 / `wysiwyg` 20箇所が
二重に書かれていた。**ルールは1次参照だけにする。**

`rules/` の2ファイルは書くことを分けている。**同じことを2箇所に書かない。**

| | 中身 | 重複したら |
|---|---|---|
| `ichiki.md` | 前提・環境・成果物・運用の約束 | 要点だけ書いて vocabulary.md の節番号を指す |
| `vocabulary.md` | モックの書き方（宣言と L01〜L31） | ここが正 |

実測で、命名規則・タブ分類・繰り返し・共通領域の判定の4箇所が、
実装が変わったあとも `ichiki.md` に旧方式のまま残っていた。**両方に詳細を書くと必ずズレる。**

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
  "ichiki_version": "0.3.0",

  // 検収成果物の出力先・形式。書かなければ既定
  "testspec": {
    "out_dir": "docs/検収",
        "visual_report": "visual/report"         // diff の出力先
  }
}
```

`testspec.visual_*` を書くと、C1 に `ichiki diff` の差異率が入る。
**書かなければ「未実行」と明記される**（自動 OK 扱いにはしない）。

`ichiki_version` を書いておくと、本体とのバージョン違いを警告する。
案件ごとに submodule を固定する運用では版ズレが起きるので、**気づけるようにしてある。**

## 構成

```
bin/ichiki.js     単一入口。使えるものは全部 --help に出る
src/
  lint/           規約への適合（L01〜L31）
  scan.js         → acf-map.yaml / coverage.json / CLAUDE.md（読み取りは converter/ を使う）
  converter/      → WordPress テーマ
  verify/         coverage（宣言→出力）/ structure（class の維持）/ live（公開後）
  a11y/           pa11y + axe（WCAG2AA）
  visual/         compare（元モック↔制約モック）/ diff（モック↔WP）/ crop
  testspec/       C1 テスト仕様書 / C3 検収シート / C3付録
  shared/         lint と変換器が共有する定数・分類・パス正規化
  gate.js         上を順に流す
  snapshot.js     出力を凍結し、変わったら落とす
rules/
  ichiki.md       前提・環境・成果物の規定・運用の約束（案件をどう進めるか）
  vocabulary.md   モックの書き方 L01〜L31 と宣言の一覧（モックをどう書くか）
prompts/          モックアップ生成プロンプト（規約は持たない。vocabulary.md を読ませる）
templates/        案件用 CLAUDE.md のテンプレート
commands/         Claude Code のスラッシュコマンド（/setup /run）
test/             fixture / mockup-bad / expected と自己検査
```

## 2本立て

```
ichiki gate      モック → テーマ         サイト不要
（テーマを WordPress に入れる）
ichiki deliver   公開後のサイト → 成果物  **サイトが要る**
```

`deliver` が束ねるもの（この順でないと成立しない）:

| | |
|---|---|
| `verify:live` | 宣言どおりに出ているか |
| `diff --both` | 見た目（デスクトップ＋モバイル） |
| `a11y --site` | アクセシビリティ |
| `testspec` | C1 / C3 / ガイド。**上の2つのレポートを読む** |
| `release` | リリース手順書 |

`diff` と `a11y` を先に回さないと `testspec` が「未実行」で出る。
欠けても止まらないので、順番を人に覚えさせない。

落ちた段は**要約1行と、詳細を見るコマンド**だけ出す
（全部貼ると実測で506行になり、読まれない）。

## 検査

```bash
ichiki doctor      # 案件側の受け入れ状態（依存・設定・コマンドのコピー）
ichiki selftest    # Ichiki 自身の健全性
```

`doctor` が見るもの: 依存が入っているか / `.ichiki.json` があるか /
バージョンが一致しているか / **スラッシュコマンドのコピーが本体と同じか**。

`selftest` が見るもの:

| | |
|---|---|
| scan の回帰 | `test/fixture` の出力が `test/expected` と一致するか |
| ルール同期 | 語彙と lint にルールIDが揃っているか（欠番が実装に残っていないかも見る） |
| 負のテスト | **全ルールが実際に違反を検出できるか**（`test/mockup-bad`） |

3つ目が要るのは、**検査が通っていても検査自体が壊れていることがある**ため。
実測で、フィールド突合が名前で照合したまま出力がキー指定に変わり、
ずっと素通りしていた（3/327 で「通った」と言い続けていた）。

## 対象と前提

WordPress 6.5+ / PHP 8.1+ / クラシックテーマ。
必須プラグイン: Advanced Custom Fields（無料版）/ Safe SVG / Contact Form 7。
ACF PRO 専用機能（Repeater / Flexible Content / オプションページ）には依存しない。
