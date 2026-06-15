# Ichiki / mockup2wp

mockup（HTML/CSS）をスキャンして、ACFフィールド台帳 `acf-map.yaml` と案件用 `CLAUDE.md` を生成する決定論CLI。LLMは使わない。同じmockupなら毎回同じ出力になる。

## リポジトリ構成

```
ichiki/
├── bin/                 ← CLIエントリポイント（mockup2wp.js）
├── src/                 ← スキャナ本体（scan.js）。HTML解析→acf-map.yaml生成
├── commands/            ← Claude Code スラッシュコマンド定義
│   ├── setup.md         ←   /setup（Phase 0: scan実行）
│   └── run.md           ←   /run（Phase 1: テーマ構築）
├── templates/           ← 案件用 CLAUDE.md のテンプレート（CLAUDE.md.tmpl）
├── rules/               ← 固定ルール（ichiki.md）。全案件共通。CLAUDE.md から import される
├── fixture/             ← テスト用 mockup（HTML/CSS）。回帰テストで使う
├── test/                ← 回帰テスト
│   ├── run.js           ←   テストランナー
│   └── expected/        ←   正解スナップショット（acf-map.yaml）
├── node_modules/        ← 依存パッケージ（同梱。npm install 不要）
├── package.json         ← v0.3.0
├── run.sh / run.bat     ← 実行ヘルパー
└── README.md
```

`commands/` 内のファイルは、案件リポジトリの `.claude/commands/` にコピーして使う（ichikiリポジトリ内にあるのは正本）。

## 案件での利用手順（実装済みの ichiki を使う）

### 初回（案件リポジトリに ichiki を組み込む）

```shell
git clone https://github.com/<org>/<案件リポジトリ>
cd <案件リポジトリ>
git submodule add https://github.com/aifroide-jp/ichiki .claude/ichiki
mkdir -p .claude/commands
cp .claude/ichiki/commands/setup.md .claude/commands/setup.md
cp .claude/ichiki/commands/run.md .claude/commands/run.md
```

### 2回目以降（サブモジュール登録済みの案件リポジトリを clone する）

```shell
git clone --recursive https://github.com/<org>/<案件リポジトリ>
cd <案件リポジトリ>
mkdir -p .claude/commands
cp .claude/ichiki/commands/setup.md .claude/commands/setup.md
cp .claude/ichiki/commands/run.md .claude/commands/run.md
```

### セットアップ後の案件リポジト構造

```
<案件リポジトリ>/
├── mockup/              ← mockup HTML/CSS/JS（リポジトリルート直下に置く案件もある）
└── .claude/
    ├── ichiki/          ← このツール（サブモジュール）
    └── commands/
        ├── setup.md     ← /setup（Phase 0）
        └── run.md       ← /run（Phase 1）
```

### Phase 0: scan 実行

mockup を案件リポジトリ内に置いてから、案件リポジトリのルートで実行する。

Claude Code 上:

```
/setup <mockupディレクトリ> <案件名>
```

直接実行:

```
node .claude/ichiki/bin/mockup2wp.js scan <mockupディレクトリ> --out . --project <案件名>
```

→ 案件リポジトリ直下に `acf-map.yaml`・`CLAUDE.md`・`.ichiki.json` が生成される。

`.ichiki.json` に `theme_dir`（WordPress テーマディレクトリの絶対パス）と `site_url` が自動生成される。`theme_dir` の `$HOME` を実際のパスに合わせてから Phase 1 へ進む。`.ichiki.json` は絶対パスを含むため `.gitignore` に追加すること。

### Phase 1: テーマ構築

前提:
- Local で WordPress が起動していること
- `wp-content/themes/<案件名>/` ディレクトリが作成済みであること
- `.ichiki.json` の `theme_dir` と `site_url` が設定済みであること
- pa11y-ci がインストール済みであること（`npm install -g pa11y-ci`）

> ACF・Contact Form 7・Safe SVG のインストール・有効化は `/run` 完了時に出力される起動コマンド（`wp plugin install ...`）で行う。事前に手動で対応する必要はない。

Claude Code 上:

```
/run
```

→ `acf-map.yaml` を入力に、WordPress テーマを1ページずつ構築し、検収ゲートを通す。

### Phase 2: 検収・リリース

テスト仕様書が自動生成され、L1 メンバーが mockup と Local を並べて YES/NO で検収する。合格後、リリース手順書に従いエックスサーバーへ移送する。

## 開発（ツールの改修・テストをする人向け）

### 必要環境

- Node.js v18以上  
- git

### 動作確認（同梱 fixture）

```
node bin/mockup2wp.js scan fixture --out /tmp/test --project demo
```

### 回帰テスト

fixture の出力を `test/expected/acf-map.yaml` と比較し、決定論が壊れていないか確認する。

```
npm test
```

スキャン仕様を意図的に変えたときは `npm run test:update` で期待値を更新する。理由なく更新しない。

### ツールの更新（案件リポジトリ側）

サブモジュールの場合:

```
cd .claude/ichiki && git pull && cd -
```

焼き込みの場合は `.claude/ichiki` を削除して再取得する。

## 出力 / 分類ルール

- `acf-map.yaml`: ページ別フィールド候補（要素・命名・タブ分類・型・デフォルト値）、共通領域（`common`）、nav、form、装飾候補、meta、カバレッジ。  
- 装飾 \= `aria-hidden` か class `bg-/pattern-/deco-` / メイン \= hero系の h1〜h3・p・img / それ以外 \= セクション別。  
- 命名 `{section}_{type}_{連番}`（同種複数のときだけ連番）。数字始まりのセクション名は `sec_` を前置する。  
- ページIDは相対パスベース（`about/index.html` → `about`、`center/biotope.html` → `center_biotope`）。  
- 全ページ半数以上で一致するセクション（footer等）は `common` に1回だけ出力し、各ページからは除外する。  
- mockup 配下は再帰的に走査する（`.`始まりフォルダと `node_modules` は除外）。  
- 詳細・実装の進め方は別紙「Phase 0 実装仕様書」を参照。
