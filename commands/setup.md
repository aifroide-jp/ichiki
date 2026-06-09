---
description: mockupをスキャンして acf-map.yaml と 案件用 CLAUDE.md を生成する（Ichiki Phase 0）
argument-hint: <mockup-dir> [project-name]
allowed-tools: Bash(node:*), Bash(npx:*), Read, Write, Edit
---

# /setup — Ichiki Phase 0

mockup を WordPress 化する準備として、mockup をスキャンし、ACFフィールドの台帳 `acf-map.yaml` と案件用 `CLAUDE.md` を生成する。

引数:
- `$1` = mockup ディレクトリ（必須）
- `$2` = プロジェクト名（任意。省略時はディレクトリ名）

## 手順

1. 入力確認
   - `$1` が無ければ、mockup ディレクトリを尋ねて中断する。

2. 決定論スキャンを実行する
   - まず次を実行する（Ichiki を `.claude/ichiki/` に vendoring している前提。パスは案件に合わせて調整する）:
     `node ./.claude/ichiki/bin/mockup2wp.js scan $1 --out . --project $2`
   - 失敗したら `npx mockup2wp scan $1 --out . --project $2` を試す。
   - 生成された `acf-map.yaml` と `CLAUDE.md` を読む。

3. 装飾タブの判定をレビューする（Phase 1「目視確認」の前倒し）
   - `acf-map.yaml` の各ページの `decoration` と、`tab: section` のうち `element: svg`（icon）を確認する。
   - 機能的なアイコン（隣に見出し・本文がある、リンクを持つ等）が `decoration` に入っていれば `section` へ。純粋な背景・飾りが `section`/`main` に入っていれば `decoration` へ。**分類だけ**を直す。
   - 重要: フィールドを新規に作らない・削らない。スキャンが列挙した集合の中で `tab` と `field_name` だけ調整する（ACFカバレッジを決定論のまま保つため）。

4. 命名を確認する
   - `field_name` が命名規則 `{セクション名}_{要素種別}_{連番}` に沿い、人が見て分かる名前か確認する。
   - 自動生成の無意味なセクション名（`x` 等）があれば、意味のある名前に直す。

5. CLAUDE.md を仕上げる
   - 200行以内・案件固有情報のみに保つ。固定ルールは `@.claude/ichiki/rules/ichiki.md` の import に任せ、本文に展開しない。
   - 「## ACF化除外」ブロックに、明らかな除外（CSSアニメ用SVG、`<style>` 内インラインSVG、レビューで装飾と判断したもの）を追記する。

6. サマリーを報告する
   - ページ数、ACF候補数（タブ別）、装飾数、要確認の境界ケース一覧を簡潔に出す。
   - 境界ケースが残っていれば、ユーザーの確認を取ってから Phase 1（Claude Code 後処理）へ進む。

## 守ること
- スキャンの列挙結果を信頼し、フィールドの増減はしない。裁量は `tab` の調整・命名・除外宣言だけ。
- `@.claude/ichiki/rules/ichiki.md` の固定ルールは書き換えない。案件固有情報だけを `CLAUDE.md` に書く。
