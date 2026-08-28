---
description: モックアップをスキャンして acf-map.yaml と案件用 CLAUDE.md を生成する（Ichiki Phase 0）  
argument-hint: <mockup-dir> [project-name]  
allowed-tools: Bash(node:*), Read, Write, Edit  
---

# /setup — Ichiki Phase 0

モックアップをスキャンし、ACF フィールドの台帳 `acf-map.yaml` と案件用 `CLAUDE.md` を出す。

引数:

- `$1` = モックのディレクトリ（省略時は `.ichiki.json` の `mockup`）
- `$2` = プロジェクト名（省略時はモックの位置から導く）

## この工程で AI は判断しない

scan は**宣言（`data-*`）を読むだけ**で、推測しない。同じモックなら毎回同じ出力になる。

以前は、クラス名の部分一致で hero を判定したり、祖先を遡ってセクション名を決めたりしていた。  
そのため `/setup` の手順に「装飾タブの判定をレビューする」「命名を確認する」という  
**人が推測を後始末する工程**があった。宣言を読む方式に変えたので、どちらも消えた。

## 手順

1. **モックが制約語彙に適合しているか確かめる。** ここが通らないと scan は動かない。

   ```bash
   node ./.claude/ichiki/bin/ichiki.js lint $1
   ```

   error が出たら、その行を直す。**指摘そのものが作業リストになる。**  
   制約なしのモックを受け取った場合もここから始める（後付けで通る）。

2. スキャンする。

   ```bash
   node ./.claude/ichiki/bin/ichiki.js scan $1 . --project $2
   ```

   出るもの:

   | | |
   |---|---|
   | `acf-map.yaml` | フィールド台帳。検収成果物の入力にもなる |
   | `coverage.json` | 全テキストノードの分類。未分類が1件でもあれば非ゼロ終了 |
   | `CLAUDE.md` | 案件用。固定ルールは import に任せる |

3. `coverage.json` の `unclaimed` を確認する。

   宣言が無い＝**更新対象外の固定文言**になる。取りこぼしではないが、  
   「これらはお客様が編集できません」という合意が要る。lint の L20 と同じ集合。

4. `CLAUDE.md` を仕上げる。

   - 案件固有情報だけを書く。固定ルールは `@.claude/ichiki/rules/ichiki.md` と  
     `@.claude/ichiki/rules/vocabulary.md` の import に任せ、本文に展開しない。  
   - 「## ACF化除外」に、この案件だけの除外があれば書く。

5. `.ichiki.json` を確認する。

   **scan が作る（無ければ）。手で書かない。** `title_separator` も既定値が入る。

   ```jsonc
   {
     "project": "…",
     "mockup": "./",
     "theme_dir": "…/wp-content/themes/…",   // 環境依存。空で出るので書き足す
     "site_url": "http://localhost:10000",   // 同上
     "title_separator": " | ",               // <title> の区切り。既定 " | "
     "ichiki_version": "0.3.0"
   }
   ```

   `title_separator` はモックの `<title>` がその区切りで書かれているかを  
   変換時に全ページ検査する。違えば名指しで停止するので、**モックを書くときに  
   このファイルを見る必要はない。**

## 守ること

- **フィールドを手で増減しない。** scan が列挙した集合がすべて。  
  足りなければ**モックに宣言を足して** scan し直す。  
- `acf-map.yaml` を手で編集しない。モックが唯一の入力元。  
  手で直すと、次の scan で消える上に、変換器との突き合わせで停止する。
