# Ichiki

**制約付きモックアップ（HTML/CSS）を WordPress クラシックテーマへ決定的に変換する。**  
同じモックなら毎回同じテーマになる。LLM は使わない。

---

## 対象と前提

WordPress 6.5+ / PHP 8.1+ / クラシックテーマ。  
必須プラグイン: Advanced Custom Fields（無料版）/ Safe SVG / Contact Form 7。  
ACF PRO 専用機能（Repeater / Flexible Content / オプションページ）には依存しない。

## 手順書（案件を進める人向け）

**初めてなら [01-セットアップ.md](docs/01-セットアップ.md) から。**  
事前に入れるもの・取り込み方・詰まりどころは、そちらにまとめてあります。

| | |
|---|---|
| [01-セットアップ.md](docs/01-セットアップ.md) | 案件で1回だけ。**事前に入れるもの・取り込み方・詰まりどころ** |
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
（`setup`/`scan` が生成する設定。人が書き足すのは `wp_root` / `local_site_container` / `site_url` だけ）。

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

取り込み方・更新のしかた・詰まったときの対処は  
[01-セットアップ.md](docs/01-セットアップ.md) にまとめてあります。

---

> コマンド一覧は `node .claude/ichiki/bin/ichiki.js --help` で見られます。
