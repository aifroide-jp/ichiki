# Ichiki

**制約付きモックアップ（HTML/CSS）を WordPress クラシックテーマへ決定的に変換する。**
同じモックなら毎回同じテーマになる。LLM は使わない。

---

## 事前に入れておくもの（Mac / Windows 共通。この2つだけ）

| | 何のため | 入手先 |
|---|---|---|
| Node.js 24+ | Ichiki 自体の実行（node で書かれている） | [node LTS版](https://nodejs.org/ja) |
| Local | WordPress の開発環境。サイト起動と PHP をこれ1つでまかなう | [Local](https://localwp.com/) |

git は既に入っている前提（無ければ `ichiki setup` が入れ方を案内して止まる）。

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
書いたら `ichiki doctor` で確認できます。

`ichiki setup` は**何度流しても既存のファイルを壊しません**。`README.md` と `CLAUDE.md` は
無いときだけ作ります。更新のときも同じものを流せます。

<details><summary>ichiki setup が何をしているか</summary>

```bash
1. 手元の道具を見る（node / npm / git が無ければ入れ方を出して止まる）
2. .claude/ichiki で npm install
3. .claude/ichiki で npx playwright install chromium
4. .claude/ichiki/commands/*.md を .claude/commands/ へコピー
5. ichiki scan（.ichiki.json / acf-map.yaml / CLAUDE.md / README.md）
6. ichiki doctor
```

</details>

コマンドの配置が要るのは、**Claude Code が `.claude/commands/` しか見ない**ため。
`.claude/ichiki/commands/` に置いても認識されないのでコピーする。

### 更新するとき

submodule を進めてから、**同じ `ichiki setup` を流す**。

```bash
cd .claude/ichiki && git fetch && git checkout <新しいコミット> && cd ../..
node .claude/ichiki/bin/ichiki.js setup
```

`ichiki setup` は既存のファイルを壊さないので、初回と同じものを流せる。
**コマンドのコピーもやり直される。** `.ichiki.json` の `ichiki_version` だけ手で直す。

`doctor` がコピーのズレとバージョン違いを見る。ズレていたら、上の `ichiki setup` を
もう一度流せば直る。

---

> **コマンドの書き方**
> `ichiki` という名前のコマンドは**ありません**（submodule なので PATH に入りません）。
> 以降の文書に出てくる `ichiki xxx` は、こう打つことの省略表記です。
>
> ```bash
> node .claude/ichiki/bin/ichiki.js xxx
> ```
>
> Ichiki のリポジトリの中にいるときは `node bin/ichiki.js xxx` です。
> コマンド一覧は `node .claude/ichiki/bin/ichiki.js --help` で見られます。

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

## 使う

```bash
# 1. モックが規約に適合しているか
node .claude/ichiki/bin/ichiki.js lint <mockup>

# 2. フィールド台帳を出す
node .claude/ichiki/bin/ichiki.js scan

# 3. テーマを生成する
node .claude/ichiki/bin/ichiki.js build <mockup> <テーマの置き場所> --acf-map <出力先>/acf-map.yaml

# まとめて（lint → a11y → scan → build → 検証 → php -l）
node .claude/ichiki/bin/ichiki.js gate <mockup>
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

## 2本立て

| | | |
|---|---|---|
| `gate` | モック → テーマ | サイト不要 |
| （テーマを WordPress に入れる） | | |
| `deliver` | 公開後のサイト → 成果物 | **サイトが要る** |

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
node .claude/ichiki/bin/ichiki.js doctor      # 案件側の受け入れ状態（依存・設定・コマンドのコピー）
node .claude/ichiki/bin/ichiki.js selftest    # Ichiki 自身の健全性
```

`doctor` が見るもの: 依存が入っているか / `.ichiki.json` があるか /
バージョンが一致しているか / **スラッシュコマンドのコピーが本体と同じか**。

`selftest`（Ichiki 自身の健全性）の中身は
[開発者向け資料.md「テストを厚くしている場所」](docs/開発者向け資料.md)を見てください。

## 対象と前提

WordPress 6.5+ / PHP 8.1+ / クラシックテーマ。
必須プラグイン: Advanced Custom Fields（無料版）/ Safe SVG / Contact Form 7。
ACF PRO 専用機能（Repeater / Flexible Content / オプションページ）には依存しない。
