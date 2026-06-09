# Ichiki / mockup2wp（Phase 0 — scan）

mockup（HTML/CSS）をスキャンして、ACFフィールド台帳 `acf-map.yaml` と案件用 `CLAUDE.md` を生成する決定論CLI。LLMは使わない。node_modules同梱でインストール不要。

## 設置（案件リポ直下でこのzipを解凍するだけ）
案件ごとのリポジトリの直下で解凍すると、こうなる:
```
<案件リポ>/
└── .claude/
    ├── ichiki/        ← このツール（bin, src, templates, rules, node_modules …）
    └── commands/
        └── setup.md   ← /setup スラッシュコマンド
```

## 実行（案件リポのルートで）
mockupを `<案件リポ>/mockup/` に置いてから:
```bash
node .claude/ichiki/bin/mockup2wp.js scan ./mockup --out . --project <案件名>
```
Claude Code上なら: `/setup ./mockup <案件名>`

→ 案件リポ直下に `acf-map.yaml` と `CLAUDE.md` が生成される。CLAUDE.md は `@.claude/ichiki/rules/ichiki.md`（固定ルール）を import する。

## 動作確認（同梱fixtureで）
```bash
node .claude/ichiki/bin/mockup2wp.js scan .claude/ichiki/fixture --out . --project demo
```

## 回帰テスト（スナップショット）
fixture の出力を `test/expected/acf-map.yaml` と比較し、決定論が壊れていないか確認する。
```bash
cd .claude/ichiki && npm test
```
スキャン仕様を意図的に変えたときは `npm run test:update` で期待値を更新する。

## 出力 / 分類ルール / 実装範囲
- `acf-map.yaml`: ページ別フィールド候補（要素・命名・タブ分類・型・デフォルト値）、nav、form、装飾候補、meta、カバレッジ。
- 装飾=aria-hidden か class `bg-/pattern-/deco-` / メイン=hero系の h1〜h3・p・img / それ以外=セクション別。
- 命名 `{section}_{type}_{連番}`（同種複数のときだけ連番）。数字始まりのセクション名は `sec_` を前置する。
- mockup配下は再帰的に走査する（サブフォルダの .html も対象。`.`始まりフォルダと node_modules は除外）。
- 詳細・実装の進め方は別紙「Phase0 実装仕様書」を参照。
