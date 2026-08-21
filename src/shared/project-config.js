'use strict';

// 案件設定（.ichiki.json）の読み書き。**唯一の実装。**
//
// モックの構造ではなく「案件の体裁・環境」を持つ。
//   project / mockup / theme_dir / site_url / ichiki_version / plugins_required
//   title_separator ← `<title>` の区切り文字（ページごとに変わらないのでここ）
//   retrofit        ← リバース途中であることの宣言（下記）
//
// retrofit（既存モックを制約語彙に変換している最中だけ書く）:
//   { "before": "<変換前のモックの場所>", "note": "<状況>" }
//   これがあると規約（rules/ichiki.md「モックの置き場所」）から外れた配置を
//   **宣言された逸脱**として扱える。書かずに外れていると、ただの事故と区別が付かない。
//   未解決リンクを許すのもこの宣言に紐づく（変換していないページへのリンクは
//   途中である以上必ず出るため）。

const fs = require('fs');
const path = require('path');

const FILENAME = '.ichiki.json';

// モックのディレクトリから上へ辿って探す。見つからなければ cwd を見る。
// gate は案件ルートから叩かれるが、convert 単体はモックのパスだけ渡されることがある。
function findConfigPath(startDir) {
  let dir = path.resolve(startDir || process.cwd());
  for (let i = 0; i < 8; i++) {
    const f = path.join(dir, FILENAME);
    if (fs.existsSync(f)) return f;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  const cwdFile = path.join(process.cwd(), FILENAME);
  return fs.existsSync(cwdFile) ? cwdFile : null;
}

function readConfig(startDir) {
  const p = findConfigPath(startDir);
  if (!p) return { path: null, conf: {} };
  try {
    return { path: p, conf: JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch (e) {
    throw new Error(`${p} が JSON として読めません: ${e.message}`);
  }
}

// キーの並びを固定して書く。人が読むファイルなので、書き直すたびに順序が変わると差分が汚れる。
const ORDER = [
  'project',
  'mockup',
  'theme_dir',
  'site_url',
  'title_separator',
  'retrofit',
  'plugins_required',
  'ichiki_version',
];

function writeConfig(filePath, conf) {
  const out = {};
  for (const k of ORDER) if (conf[k] !== undefined) out[k] = conf[k];
  for (const k of Object.keys(conf)) if (out[k] === undefined) out[k] = conf[k];
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2) + '\n', 'utf8');
}

module.exports = { FILENAME, findConfigPath, readConfig, writeConfig };
