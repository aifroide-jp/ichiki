# Ichiki

**制約付きモックアップ（HTML/CSS）を WordPress クラシックテーマへ決定的に変換する。**
同じモックなら毎回同じテーマになる。LLM は使わない。

---

## 対象と前提

WordPress 6.5+ / PHP 8.1+ / クラシックテーマ。
必須プラグイン: Advanced Custom Fields（無料版）/ Safe SVG / Contact Form 7。
ACF PRO 専用機能（Repeater / Flexible Content / オプションページ）には依存しない。

## 事前に入れておくもの（Mac / Windows 共通。この2つだけ）

| | 何のため | 入手先 |
|---|---|---|
| Node.js 24+ | Ichiki 自体の実行（node で書かれている） | [node LTS版](https://nodejs.org/ja) |
| Local | WordPress の開発環境。サイト起動と PHP をこれ1つでまかなう | [Local](https://localwp.com/) |

git は既に入っている前提（無ければ、下のセットアップコマンドが入れ方を案内して止まる）。

---

## はじめる（案件への入れ方）

```bash
# 1. 取り込む（案件リポジトリのルートで）
git submodule add https://github.com/aifroide-jp/ichiki .claude/ichiki
git submodule update --init --recursive

# 2. 残りは1コマンド（依存・ブラウザ・コマンド配置・設定作成・確認）
node .claude/ichiki/bin/ichiki.js setup
```

**Windows でもそのまま動きます**（node で書いてあるので `sh` は要りません）。

最後に `.ichiki.json` の `theme_dir` と `site_url` を手で書きます。
**機械には分からない値**（WordPress の場所と URL）なので、そこだけ残しています。
書いたら `node .claude/ichiki/bin/ichiki.js doctor` で確認できます。

**上のコマンドは何度流しても既存のファイルを壊しません。** `README.md` と `CLAUDE.md` は
無いときだけ作ります。更新のときも同じものを流せます。

コマンドの配置が要るのは、**Claude Code が `.claude/commands/` しか見ない**ため。
`.claude/ichiki/commands/` に置いても認識されないのでコピーする。

---

## 手順書（案件を進める人向け）

この README は**開発者向けの一次情報**です。案件を回す手順は下にまとめてあります。

| | |
|---|---|
| [01-セットアップ.md](docs/01-セットアップ.md) | 案件で1回だけ。**詰まりどころと直し方** |
| [021-モックアップを作る.md](docs/021-モックアップを作る.md) | 新規に書く。覚えるコマンドは `lint` 1つ |
| [022-既存htmlからモックアップを作る.md](docs/022-既存htmlからモックアップを作る.md) | 構造化。**見た目が変わってはいけない**局面 |
| [023-AIに書かせてlintを通す.md](docs/023-AIに書かせてlintを通す.md) | 021・022 共通。AI への頼み方と lint の回し方 |
| [03-変換して検査する.md](docs/03-変換して検査する.md) | 覚えるコマンドは `gate` と `deliver` の2つ |
| [開発者向け資料.md](docs/開発者向け資料.md) | **Ichiki を直す人向け。** 設計の考え方・中身の構成・何度も踏んだ壊れ方 |

## よく使うコマンド（gate と deliver）

```bash
node .claude/ichiki/bin/ichiki.js gate      # モック → テーマの検証（サイトは要らない）
node .claude/ichiki/bin/ichiki.js deliver   # 公開後の検査 → 検収成果物 → リリース手順書
```

引数は要りません。モックの場所もサイトの URL も `.ichiki.json` が持っています
（`setup`/`scan` が生成する設定。人が書き足すのは `theme_dir` と `site_url` だけ）。

この2つの使い分け・内訳・詰まったときの対処は
[03-変換して検査する.md](docs/03-変換して検査する.md) にまとめてあります。
`lint` `scan` `build` を個別に叩きたいときも同じ文書を見てください。

## 案件のセットアップ状態を見る（doctor と selftest）

```bash
node .claude/ichiki/bin/ichiki.js doctor      # setup/更新の直後に。案件側の受け入れ状態を見る
node .claude/ichiki/bin/ichiki.js selftest    # Ichiki自体を直した直後に。Ichiki自身の健全性を見る
```

`doctor` が見るもの: 依存が入っているか / `.ichiki.json` があるか /
バージョンが一致しているか / **スラッシュコマンドのコピーが本体と同じか**。

`selftest`（Ichiki 自身の健全性）の中身は
[開発者向け資料.md「テストを厚くしている場所」](docs/開発者向け資料.md)を見てください。

---

### Ichikiを更新するとき

submodule を進めてから、**上と同じセットアップコマンドを流す**。

```bash
# 案件リポジトリのルートから
cd .claude/ichiki
git fetch
git checkout origin/main
cd ../..
node .claude/ichiki/bin/ichiki.js setup
```

上のコマンドは既存のファイルを壊さないので、初回と同じものを流せる。
**コマンドのコピーもやり直される。** `.ichiki.json` の `ichiki_version` だけ手で直す。

`doctor` がコピーのズレとバージョン違いを見る。ズレていたら、上のセットアップコマンドを
もう一度流せば直る。

---

## 古い Node.js から上げるとき

セットアップ時に「node が古すぎます」と言われたら、24 以上に上げてください。
WordPress 側の制約ではなく、Ichiki 自体（node で書かれている）だけの話です。

**nodejs.org のインストーラで入れた人（前提）**

1. https://nodejs.org/ja を開く
2. LTS版（24.x）のインストーラをダウンロード
3. 実行する（Mac: `.pkg` / Windows: `.msi`）。既存のバージョンは自動で上書きされる
4. **ターミナルを開き直して** `node -v` で確認する
   （開いたままのターミナルには PATH の更新が反映されない）

<details><summary>nvm / Homebrew で入れている人</summary>

```bash
# nvm（nvm-windows も同じコマンド）
nvm install 24
nvm use 24
nvm alias default 24   # 新しいターミナルでも既定を24にする

# Homebrew（Mac）
brew upgrade node
```

</details>

---

> コマンド一覧は `node .claude/ichiki/bin/ichiki.js --help` で見られます。
