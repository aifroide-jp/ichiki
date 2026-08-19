#!/usr/bin/env bash
# Phase 0 ランナー（mac / Linux）
# 技術担当が MOCKUP と PROJECT を設定してから利用者さんに渡す
set -e
cd "$(dirname "$0")"

MOCKUP="./mockup"      # ← 技術担当が対象mockupフォルダ名に変更する
PROJECT="genba"        # ← 技術担当が案件名に変更する

# まずモックが制約語彙に適合しているか見る。ここが通らないとスキャンできない。
if ! node bin/ichiki.js lint "$MOCKUP"; then
  echo
  echo "NG: モックの書き方に直すところがあります。上の一覧を技術担当に渡してください"
  exit 1
fi

node bin/ichiki.js scan "$MOCKUP" ./out --project "$PROJECT"
echo
if [ -f ./out/acf-map.yaml ] && [ -f ./out/CLAUDE.md ]; then
  echo "OK: out フォルダに acf-map.yaml と CLAUDE.md ができました"
else
  echo "NG: ファイルができていません。技術担当に連絡してください"
  exit 1
fi
