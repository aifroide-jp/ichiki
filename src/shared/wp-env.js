'use strict';

// 手元の WordPress を探す。
//
// **アプリの実行ファイルを探さない。** `/Applications/Local.app` や
// `Local.exe` の場所を当てにいくと、OS ごと・インストール方法ごと・
// バージョンごとに分岐が増え続け、外したときに
// 「入っているのに入っていないと言う」ことになる。
// 実測: Windows に Local が入っているのに「Local を入れてください」と出した
// （正確には、そのときは検知すら無く無条件に出していた）。
//
// 代わりに **サイトの台帳** を読む。Local は Electron アプリなので
// userData の下に sites.json を置く。ここには name / domain / path があり、
// .ichiki.json に要る site_url と theme_dir がそのまま導ける。
//
// 台帳が無ければ「分からない」に倒す。**空振りしても嘘にならない**のがこの方式の要点で、
// 実行ファイル探しは空振りが即「入っていない」という嘘になるから採らない。

const fs = require('fs');
const os = require('os');
const path = require('path');

// Electron の userData。OS ごとにここだけが違う。
function userData(appName) {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), appName);
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', appName);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), appName);
}

function localSitesFile() {
  return path.join(userData('Local'), 'sites.json');
}

// Local のサイト一覧。無ければ空配列。
function localSites() {
  const f = localSitesFile();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return [];
  }
  const out = [];
  for (const s of Object.values(raw || {})) {
    if (!s || !s.path) continue;
    // 実測: Local は path を `~/Local Sites/...` と省略形で持つことがある
    // （2件のうち1件がそうだった）。展開しないと存在判定が必ず外れる。
    const root = s.path.startsWith('~')
      ? path.join(os.homedir(), s.path.slice(1))
      : s.path;
    // Local はサイト直下に app/public を作る（multiSite でも同じ）
    const pub = path.join(root, 'app', 'public');
    out.push({
      app: 'Local',
      name: s.name || path.basename(root),
      url: s.domain ? `http://${s.domain}` : null,
      // .ichiki.json の wp_root / local_site_container にそのまま貼れる形で持つ
      // （root = <wp_root>/<local_site_container>）。
      wpRoot: path.dirname(root),
      container: path.basename(root),
      publicDir: pub,
      phpVersion: s.phpVersion || null,
      exists: fs.existsSync(path.join(pub, 'wp-config.php')),
    });
  }
  return out;
}

// gate の `php -l` に使う php を探す。
//
// Ichiki が php を使うのはテーマの文法検査 1箇所だけで、wp-cli は一度も呼ばない。
// それだけのために PHP 環境をもう一つ入れさせるのは重い。
// Local は php を同梱していて、PATH に通っていないだけなので、そこから借りる。
//
//   <userData>/Local/lightning-services/php-<ver>+<n>/bin/<platform>/...
//
// **その先の形を決め打ちしない。** 実測で mac は
//   bin/darwin-arm64/php  と  bin/darwin-arm64/bin/php  の両方にあり、
// Windows は bin/win64/php.exe（bin が1段少ない）だった。
// 決め打ちした結果、Local が入っている Windows で「php がありません」と出た。
//
// 浅い順に候補を集め、**実際に -v が通ったものを採る**。
// 存在するかではなく動くかで決めれば、階層名も段数も当てなくてよい。
function findPhp(hasCmd) {
  // PATH にあるなら黙ってそれを使う（brew / システム / WSL、どれでもよい）
  if (hasCmd && hasCmd('php')) return { cmd: 'php', from: 'PATH' };

  const svc = path.join(userData('Local'), 'lightning-services');
  let dirs;
  try {
    dirs = fs.readdirSync(svc).filter((d) => d.startsWith('php-'));
  } catch {
    return null;
  }
  const ver = (d) => (d.match(/^php-(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
  dirs.sort((a, b) => {
    const [A, B] = [ver(a), ver(b)];
    for (let i = 0; i < 3; i++) if ((A[i] || 0) !== (B[i] || 0)) return (B[i] || 0) - (A[i] || 0);
    return 0;
  });
  // サイトが使っている版を優先する。検査は本番と同じ版でしたい
  const wanted = localSites().map((s) => s.phpVersion).filter(Boolean);
  const ordered = [...dirs.filter((d) => wanted.some((w) => d.startsWith(`php-${w}`))), ...dirs];

  const exe = process.platform === 'win32' ? 'php.exe' : 'php';
  for (const d of ordered) {
    for (const cand of collectPhp(path.join(svc, d, 'bin'), exe, 3)) {
      if (runsAsPhp(cand)) return { cmd: cand, from: `Local 同梱（${d}）` };
    }
  }
  return null;
}

// 深さを切って php 実体を集める。浅い順（幅優先）に返す。
function collectPhp(root, exe, maxDepth) {
  const out = [];
  let level = [root];
  for (let depth = 0; depth <= maxDepth && level.length; depth++) {
    const next = [];
    for (const dir of level) {
      let ents;
      try {
        ents = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of ents) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) next.push(full);
        else if (e.name === exe) out.push(full);
      }
    }
    level = next;
  }
  return out;
}

// 「あるか」ではなく「動くか」で決める。include/php のような紛れを弾ける。
function runsAsPhp(bin) {
  try {
    const r = require('child_process').spawnSync(bin, ['-v'], { encoding: 'utf8', timeout: 10000 });
    return r.status === 0 && /^PHP \d/.test(r.stdout || '');
  } catch {
    return false;
  }
}

module.exports = { localSitesFile, localSites, findPhp };
