#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { runScan } = require('../src/scan');

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

function writeIchikiConfig(opts) {
  const configPath = path.join(opts.out, '.ichiki.json');
  if (fs.existsSync(configPath)) return; // 上書きしない（theme_dir等を保護）
  const project = opts.project;
  const config = {
    project,
    mockup: opts.dir,
    theme_dir: `$HOME/Local Sites/${project}/app/public/wp-content/themes/${project}`,
    site_url: `http://${project}.local`,
    plugins_required: ['advanced-custom-fields', 'contact-form-7', 'safe-svg'],
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`  -> ${configPath}  ※ theme_dir の $HOME を実際のパスに合わせてください`);
}

if (cmd === 'scan') {
  const opts = parseScanArgs(args);
  if (!opts.dir) {
    console.error('usage: mockup2wp scan <mockup-dir> [--out DIR] [--project NAME]');
    process.exit(1);
  }
  opts.tmpl = path.join(__dirname, '..', 'templates', 'CLAUDE.md.tmpl');
  runScan(opts);
  writeIchikiConfig(opts);
} else {
  console.error(`unknown command: ${cmd || '(none)'}\ncommands:\n  scan <mockup-dir> [--out DIR] [--project NAME]`);
  process.exit(1);
}
