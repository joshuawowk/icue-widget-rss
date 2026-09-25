#!/usr/bin/env node
/**
 * Proves the harness is worth trusting: deliberately reintroduce each bug that
 * has actually shipped and confirm tools/icue-test.js fails on it.
 * A harness that cannot fail is not a test.
 */
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const WIDGET = path.resolve(__dirname, '..');

const MUTATIONS = [
  {
    name: 'v1.0.0 bug — top-level function collides with iCUE\'s `let maxItems`',
    apply: (h) => h.replace('maxStories()', 'maxItems()')
                   .replace(/  \(function \(\) \{\n/, '')
                   .replace('  })();\n  </script>', '  </script>'),
    expect: /declaration collides|SyntaxError|already been declared|stuck on loading|rendered stories/i
  },
  {
    name: 'v1.0.1 bug — handlers registered on window.icueEvents',
    apply: (h) => {
      const target = "      icueEvents = {\n        'onDataUpdated'";
      if (!h.includes(target)) throw new Error('selftest mutation target not found');
      return h.replace(target, "      window.icueEvents = {\n        'onDataUpdated'");
    },
    expect: /window\.icueEvents|onICUEInitialized handler|stuck on loading/i
  },
  {
    name: 'strict mode (breaks iCUE property injection)',
    apply: (h) => h.replace('  (function () {', "  (function () {\n    'use strict';"),
    expect: /strict/i
  },
  {
    name: 'slider missing data-step (silent import rejection)',
    apply: (h) => h.replace(' data-max="40" data-step="1" />', ' data-max="40" />'),
    expect: /data-step/i
  },
];

let failures = 0;
for (const m of MUTATIONS) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'selftest-'));
  fs.cpSync(WIDGET, stage, { recursive: true, filter: (s) => !s.includes('node_modules') && !s.includes('.git') });
  const p = path.join(stage, 'index.html');
  const mutated = m.apply(fs.readFileSync(p, 'utf8'));
  fs.writeFileSync(p, mutated);

  // The staged copy deliberately has no node_modules, so point require() back at
  // the repo's. PLAYWRIGHT_BROWSERS_PATH is only forced where that cache exists
  // (the Anthropic container); elsewhere Playwright's own default is correct.
  const env = { ...process.env };
  if (fs.existsSync('/opt/pw-browsers')) env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
  env.NODE_PATH = [path.join(WIDGET, 'node_modules'), process.env.NODE_PATH || '']
    .filter(Boolean).join(path.delimiter);

  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, [path.join(stage, 'tools', 'icue-test.js')],
      { encoding: 'utf8', timeout: 300000, env: env });
  } catch (e) { out = (e.stdout || '') + (e.stderr || ''); code = e.status ?? 1; }

  const caught = code !== 0 && m.expect.test(out);
  console.log((caught ? '  ✓ caught: ' : '  ✗ MISSED: ') + m.name);
  if (!caught) {
    failures++;
    console.log('      exit=' + code + '\n      ' + out.split('\n').filter(l => l.includes('✗')).slice(0, 4).join('\n      '));
  } else {
    console.log('      → ' + (out.split('\n').filter(l => l.includes('✗'))[0] || '').trim());
  }
  fs.rmSync(stage, { recursive: true, force: true });
}
console.log(failures ? '\n✗ harness missed ' + failures + ' known bug(s)' : '\n✓ harness catches every known-bad build');
process.exit(failures ? 1 : 0);
