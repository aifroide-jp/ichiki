# Ichiki / mockup2wp（Phase 0 — scan）

mockup（HTML/CSS）をスキャンして、ACFフィールド台帳 `acf-map.yaml` と案件用 `CLAUDE.md` を生成する決定論CLI。LLMは使わない。同じmockupなら毎回同じ出力になる。

## 必要環境

- Node.js v18以上
- git

## 設置（案件リポに取り込む）

案件ごとのリポジトリのルートで、このツールを `.claude/ichiki/` に取り込む。

サブモジュールで取り込む場合（推奨。バージョンを固定でき、更新も追える）:

    git submodule add https://github.com/aifroide-jp/ichiki .claude/ichiki

ソースを焼き込む場合（サブモジュールを使わない。更新は再取得）:

    git clone --depth 1 https://github.com/aifroide-jp/ichiki .claude/ichiki
    rm -rf .claude/ichiki/.git

取り込んだら、`/setup` コマンドを案件側の所定の場所に配置する:

    mkdir -p .claude/commands
    cp .claude/ichiki/commands/setup.md .claude/commands/setup.md

node_modules がコミット済みなので、これで即実行できる（インストール不要）。

設置後の構造:

    <案件リポ>/
    └── .claude/
        ├── ichiki/        ← このツール（bin, src, templates, rules, node_modules …）
        └── commands/
            └── setup.md   ← /setup スラッシュコマンド

## 実行（案件リポのルートで）

mockupを `<案件リポ>/mockup/` に置いてから:

    node .claude/ichiki/bin/mockup2wp.js scan ./mockup --out . --project <案件名>

Claude Code上なら: `/setup ./mockup <案件名>`

→ 案件リポ直下に `acf-map.yaml` と `CLAUDE.md` が生成される。`CLAUDE.md` は `@.claude/ichiki/rules/ichiki.md`（固定ルール）を import する。この import は `.claude/ichiki/` 配置を前提にしているので、ツールは必ずこの場所に置く。

## 動作確認（同梱fixture）

    node .claude/ichiki/bin/mockup2wp.js scan .claude/ichiki/fixture --out . --project demo

## 回帰テスト（スナップショット）

fixtureの出力を `test/expected/acf-map.yaml` と比較し、決定論が壊れていないか確認する。

    cd .claude/ichiki && npm test

スキャン仕様を意図的に変えたときは `npm run test:update` で期待値を更新する。

## ツールの更新

サブモジュールの場合:

    cd .claude/ichiki && git pull && cd -

焼き込みの場合は `.claude/ichiki` を削除して再取得する。

## 出力 / 分類ルール / 実装範囲

- `acf-map.yaml`: ページ別フィールド候補（要素・命名・タブ分類・型・デフォルト値）、共通領域（common）、nav、form、装飾候補、meta、カバレッジ。
- 装飾=aria-hidden か class `bg-/pattern-/deco-` / メイン=hero系の h1〜h3・p・img / それ以外=セクション別。
- 命名 `{section}_{type}_{連番}`（同種複数のときだけ連番）。数字始まりのセクション名は `sec_` を前置する。
- ページIDは相対パスベース（about/index.html → about、center/biotope.html → center_biotope）。
- 全ページ半数以上で一致するセクション（footer等）は `common` に1回だけ出力し、各ページからは除外する。
- mockup配下は再帰的に走査する（サブフォルダの .html も対象。`.`始まりフォルダと node_modules は除外）。
- 詳細・実装の進め方は別紙「Phase0 実装仕様書」を参照。
