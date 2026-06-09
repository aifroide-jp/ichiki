#!/usr/bin/env bash
# Phase 0 ランナー（mac / Linux）
# 技術担当が MOCKUP と PROJECT を設定してから利用者さんに渡す
set -e
cd "$(dirname "$0")"

MOCKUP="./mockup"      # ← 技術担当が対象mockupフォルダ名に変更する
PROJECT="genba"        # ← 技術担当が案件名に変更する

node bin/mockup2wp.js scan "$MOCKUP" --out ./out --project "$PROJECT"
echo
if [ -f ./out/acf-map.yaml ] && [ -f ./out/CLAUDE.md ]; then
  echo "OK: out フォルダに acf-map.yaml と CLAUDE.md ができました"
else
  echo "NG: ファイルができていません。技術担当に連絡してください"
fi
