#!/usr/bin/env node
/**
 * Build the .icuewidget from a clean staging copy, using the official CLI.
 *
 * `icuewidget package .` in the repo root zips every non-hidden file under it, including
 * node_modules, tools/shots and fixtures (it produced a 19 MB package once). Only the
 * files the widget loads belong in a build: this stages exactly those, then runs
 * `icuewidget validate` and `icuewidget package -o` on the staging directory, so the
 * archive is what the CLI itself would build for that folder.
 *
 * Usage:  npm run package        (needs the CLI: npm install -g icuewidget-cli)
 * Output: dist/RSS-Reader-<version>.icuewidget   (gitignored)
 * Override the CLI binary with ICUEWIDGET_CLI.
 */
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const WIDGET = path.resolve(__dirname, '..');
const SHIP = [
  'index.html',
  'manifest.json',
  'translation.json',
  'styles/RssReader.css',
  'resources/icon.png',
  'resources/icon.svg'
];

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'icue-pkg-'));
try {
  for (const rel of SHIP) {
    const src = path.join(WIDGET, rel);
    if (!fs.existsSync(src)) { console.error('missing: ' + rel); process.exit(1); }
    const dst = path.join(stage, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }

  const version = JSON.parse(fs.readFileSync(path.join(WIDGET, 'manifest.json'), 'utf8')).version;
  const out = path.join(WIDGET, 'dist', 'RSS-Reader-' + version + '.icuewidget');
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const cli = process.env.ICUEWIDGET_CLI || 'icuewidget';
  execFileSync(cli, ['validate', stage], { stdio: 'inherit' });
  execFileSync(cli, ['package', stage, '-o', out], { stdio: 'inherit' });
  console.log('\npackaged: ' + out);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
