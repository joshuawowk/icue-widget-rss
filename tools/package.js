#!/usr/bin/env node
/**
 * Build the .icuewidget from a clean staging copy.
 *
 * `icuewidget package .` in the repo root sweeps in whatever happens to be
 * lying around — node_modules, tools/shots, fixtures — and produced a 19 MB
 * package once. Only these files belong in a build.
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
for (const rel of SHIP) {
  const src = path.join(WIDGET, rel);
  if (!fs.existsSync(src)) { console.error('missing: ' + rel); process.exit(1); }
  const dst = path.join(stage, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

const cli = process.env.ICUEWIDGET_CLI || 'icuewidget';
execFileSync(cli, ['validate', stage], { stdio: 'inherit' });
execFileSync(cli, ['package', stage], { stdio: 'inherit' });

const version = JSON.parse(fs.readFileSync(path.join(WIDGET, 'manifest.json'), 'utf8')).version;
const built = path.join(path.dirname(stage), 'rss-reader.icuewidget');
const out = path.join(WIDGET, 'dist', 'RSS Reader ' + version + '.icuewidget');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(built, out);
fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(built, { force: true });
console.log('\npackaged: ' + out);
