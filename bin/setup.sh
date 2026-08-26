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

# 手元の道具を先に見る。無いまま進むと `npm: command not found` だけが出て、
# **何を入れればいいか分からない画面**になる（実測）。
missing=""
need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "✗ $1 がありません"
    echo "    $2"
    missing="yes"
  fi
}
need node "https://nodejs.org/ から入れてください（18以上）"
need npm  "node と一緒に入ります。node を入れ直してください"
need git  "Xcode Command Line Tools（xcode-select --install）か https://git-scm.com/"
if [ -n "$missing" ]; then
  echo ""
  echo "上を入れてから、もう一度このコマンドを流してください。"
  exit 2
fi

# 無くても進めるが、後の工程で効くもの。ここで言っておく。
command -v php >/dev/null 2>&1 || \
  echo "※ php がありません。gate の php -l（テーマの文法検査）が飛ばされます"
command -v wp >/dev/null 2>&1 || \
  echo "※ wp-cli がありません。初期データの投入を手で叩くときに要ります"
# WordPress をどこで動かすかは案件と人による（Local / Herd / Docker / リモート）。
# **アプリの有無は検知しない。** 入っていても起動していなければ意味がなく、
# 起動していれば doctor の疎通確認が通る。要件だけ伝える。
echo "※ WordPress を動かす環境が要ります（Local / Herd など）。"
echo "   後で .ichiki.json の site_url と theme_dir にその場所を書きます。"

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
