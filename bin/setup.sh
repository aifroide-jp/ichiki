#!/bin/sh
# 案件に Ichiki を入れる。**submodule を追加したあと、案件のルートで1回だけ叩く。**
#
#   sh .claude/ichiki/bin/setup.sh
#
# 手打ちする行が多いと、どれかを飛ばしても気づけない（実測: コマンドのコピーを
# 忘れて旧手順が動き続けた）。順番に流して、最後に doctor で確認する。
set -e

ROOT="$(pwd)"
ICHIKI=".claude/ichiki"

if [ ! -d "$ICHIKI" ]; then
  echo "✗ $ICHIKI がありません。先に submodule を入れてください:"
  echo ""
  echo "  git submodule add https://github.com/aifroide-jp/ichiki .claude/ichiki"
  echo "  git submodule update --init --recursive"
  exit 2
fi

echo "1/4 依存を入れます（初回は数分かかります）"
( cd "$ICHIKI" && npm install --silent )

echo "2/4 見た目の比較に使うブラウザを入れます"
( cd "$ICHIKI" && npx --yes playwright install chromium >/dev/null 2>&1 ) || \
  echo "    ※ 入りませんでした。ichiki diff を使うときに入れ直してください"

echo "3/4 スラッシュコマンドを配置します"
mkdir -p .claude/commands
cp "$ICHIKI"/commands/*.md .claude/commands/

echo "4/4 案件設定とフィールド台帳を作ります"
node "$ICHIKI/bin/ichiki.js" scan . . || {
  echo ""
  echo "✗ scan が止まりました。モックが規約に合っていない可能性があります。"
  echo "  上の出力を見て直してから、もう一度このスクリプトを流してください。"
  exit 1
}

echo ""
node "$ICHIKI/bin/ichiki.js" doctor || true
echo ""
echo "──────────────────────────────────────────"
echo "残りは手で書いてください（機械には分かりません）:"
echo ""
echo "  .ichiki.json の theme_dir  … WordPress の themes フォルダの場所"
echo "  .ichiki.json の site_url   … 開発中のサイトの URL"
echo ""
echo "書いたら `node $ICHIKI/bin/ichiki.js doctor` で確認できます。"
