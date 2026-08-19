#!/usr/bin/env node
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

const cmd = process.argv[2];
const args = process.argv.slice(3);

function parseScanArgs(args) {
  const opts = { dir: null, out: '.', project: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') opts.out = args[++i];
    else if (args[i] === '--project') opts.project = args[++i];
    else if (!args[i].startsWith('--') && !opts.dir) opts.dir = args[i];
  }
  return opts;
}

if (cmd === 'scan') {
  const opts = parseScanArgs(args);
  if (!opts.dir) {
    console.error('usage: mockup2wp scan <mockup-dir> [--out DIR] [--project NAME]');
    process.exit(1);
  }
  opts.tmpl = path.join(__dirname, '..', 'templates', 'CLAUDE.md.tmpl');
  const r = spawnSync('node', [path.join(__dirname, '..', 'src', 'scan.js'), opts.dir, opts.out], {
    stdio: 'inherit',
  });
  process.exit(r.status === null ? 1 : r.status);
} else {
  console.error(`unknown command: ${cmd || '(none)'}\ncommands:\n  scan <mockup-dir> [--out DIR] [--project NAME]`);
  process.exit(1);
}
