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
      publicDir: pub,
      exists: fs.existsSync(path.join(pub, 'wp-config.php')),
    });
  }
  return out;
}

// Herd は台帳の形が公開されていないので、CLI が PATH にいるかだけ見る。
// Herd は mac / Windows どちらも `herd` を PATH に通す。
// 見つかっても**サイトの場所までは分からない**ので、そう言う。
function herdInstalled(hasCmd) {
  return hasCmd('herd');
}

// theme_dir を組み立てる
function themeDirFor(site, slug) {
  return path.join(site.publicDir, 'wp-content', 'themes', slug);
}

module.exports = { localSitesFile, localSites, herdInstalled, themeDirFor };
