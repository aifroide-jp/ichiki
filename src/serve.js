'use strict';

// モックを配信するだけの静的サーバ（依存なし）。
// python3 -m http.server はプレビュー起動時のサンドボックスで os.getcwd() が
// EPERM になり起動できなかったため、Node で置き換えている。
//
//   ichiki serve [rootDir] [port]
//
// 既定のルートは .ichiki.json の mockup。モックの内部参照はページ階層に応じた相対パス
// （vocabulary.md 7章・8章）なので、モックのルートをそのままドキュメントルートに
// 据えないと css/ images/ が解決しない。

const http = require('http');
const fs = require('fs');
const path = require('path');

// 既定は案件の設定から。本体に案件のディレクトリ名を焼き込まない
// （'mockup-real' は移設で消えた名前で、既定として機能していなかった）。
const rootDir = (() => {
  if (process.argv[2]) return path.resolve(process.cwd(), process.argv[2]);
  try {
    const { readConfig } = require('./shared/project-config');
    return path.resolve(process.cwd(), readConfig(process.cwd()).conf.mockup || './');
  } catch {
    return process.cwd();
  }
})();
const port = Number(process.argv[3] || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.yaml': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    // モックは頻繁に差し替わるうえ、キャッシュが残ると CSS 修正の確認を誤らせる。
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, '400 Bad Request');
  }

  // ルート外への脱出を防ぐ
  const target = path.resolve(path.join(rootDir, pathname));
  if (target !== rootDir && !target.startsWith(rootDir + path.sep)) {
    return send(res, 403, '403 Forbidden');
  }

  let filePath = target;
  let stat;
  try {
    stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = fs.statSync(filePath);
    }
  } catch {
    return send(res, 404, `404 Not Found: ${pathname}`);
  }

  try {
    send(res, 200, fs.readFileSync(filePath), MIME[path.extname(filePath).toLowerCase()]);
  } catch {
    send(res, 500, '500 Internal Server Error');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`serving ${rootDir} at http://localhost:${port}`);
});
