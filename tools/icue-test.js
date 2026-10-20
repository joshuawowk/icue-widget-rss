#!/usr/bin/env node
/**
 * iCUE widget test harness.
 *
 * Runs the widget the way iCUE actually runs it, so a broken build is caught
 * here instead of on the panel. Two passes:
 *
 *   1. STATIC  — the silent-killer checks `icuewidget validate` does not make:
 *                declaration collisions with the globals iCUE injects, wrong
 *                icueEvents wiring, strict mode / modules, external <script src>,
 *                control metadata gaps, and tr() keys missing from translation.json.
 *
 *   2. RUNTIME — loads index.html in Chromium behind a faithful replica of iCUE's
 *                Qt bridge, injecting iCUE's VERBATIM bootstrap (tools/icue-bootstrap.js,
 *                captured from a live iCUE instance) as a document-start script.
 *                Asserts onICUEInitialized actually fires, the widget paints, a
 *                settings change propagates, and each Xeneon Edge slot size renders.
 *
 * Usage:  node tools/icue-test.js [--init-delay=MS] [--keep] [--shots=DIR]
 */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WIDGET_DIR = path.resolve(__dirname, '..');
const BOOTSTRAP = fs.readFileSync(path.join(__dirname, 'icue-bootstrap.js'), 'utf8');

const argv = process.argv.slice(2);
const arg = (n, d) => { const m = argv.find(a => a.startsWith('--' + n + '=')); return m ? m.split('=')[1] : d; };
const INIT_DELAY = Number(arg('init-delay', 150));
const SHOTS = arg('shots', path.join(WIDGET_DIR, 'tools', 'shots'));
const KEEP = argv.includes('--keep');
const LIVE = argv.includes('--live');   // hit the real network instead of tools/fixtures

// Self-hosted CORS relay + a paper that needs it. The default is a placeholder: the
// widget only accepts a plain-http proxy on a private address (10.x, 172.16-31.x,
// 192.168.x, 127.x), so it must stay in one of those ranges. The offline tests stub the
// relay, so any such address works; set RELAY_ORIGIN to your own relay for --live runs,
// e.g. RELAY_ORIGIN=http://<your-host>:8787 npm run test:live
const RELAY_ORIGIN = (process.env.RELAY_ORIGIN || 'http://10.0.0.10:8787').replace(/\/+$/, '');
const BLOX_FEED = 'https://www.valleybreeze.com/search/?f=rss&t=article' +
  '&c=news/north_smithfield_and_blackstone&l=15&s=start_time&sd=desc';

let pass = 0, fail = 0;
const ok = (l) => { pass++; console.log('  ✓ ' + l); };
const bad = (l, d) => { fail++; console.log('  ✗ ' + l + (d ? '\n      ' + String(d).replace(/\n/g, '\n      ') : '')); };
const check = (l, cond, d) => cond ? ok(l) : bad(l, d);

// Globals iCUE's bootstrap declares with `let` before the widget's script parses.
// Re-declaring any of these is a SyntaxError that kills the whole <script>.
const BOOTSTRAP_LETS = ['uniqueId', 'tick_offset', 'tick_start', 'iCUE_initialized', 'icueEvents'];
const BOOTSTRAP_FNS = ['updateTick', 'tick', 'applyData', 'requestUpdate'];

function parseProperties(html) {
  const props = [];
  const re = /<meta\s+name="x-icue-property"([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(html))) {
    const a = m[1];
    const attr = (k) => { const r = new RegExp(k + '="([^"]*)"').exec(a); return r ? r[1] : undefined; };
    props.push({
      name: attr('content'),
      type: attr('data-type'),
      def: attr('data-default'),
      min: attr('data-min'), max: attr('data-max'), step: attr('data-step'),
      filters: attr('data-filters'),
      raw: m[0]
    });
  }
  return props;
}

// data-default holds a JS expression ('#fff', 12, ''). Evaluate it the way iCUE would.
function evalDefault(expr, type) {
  if (expr === undefined) return type === 'media-selector' ? null : '';
  try { return Function('return (' + expr + ')')(); } catch (e) { return expr; }
}

function staticChecks(html, props) {
  console.log('\n── static ──');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const code = scripts.join('\n');
  const propNames = props.map(p => p.name).filter(Boolean);
  const reserved = new Set([...BOOTSTRAP_LETS, ...BOOTSTRAP_FNS, ...propNames, 'pluginLinkprovider_initialized']);

  // Top-level declarations = anything not nested inside the widget IIFE.
  const collisions = [];
  for (const name of reserved) {
    const re = new RegExp('(?:^|\\n)\\s*(?:var|let|const|function|async function)\\s+' + name + '\\b');
    if (re.test(code)) collisions.push(name);
  }
  check('no declaration collides with an iCUE-injected global', collisions.length === 0,
    collisions.length ? 'colliding: ' + collisions.join(', ') + '\n(iCUE let-declares these; redeclaring is a SyntaxError that kills the script)' : '');

  check('icueEvents wired by BARE assignment', /(?:^|[^.\w])icueEvents\s*=\s*\{/m.test(code),
    'expected `icueEvents = {...}` (no var/let/const, not window.icueEvents)');
  check('icueEvents never assigned via window', !/window\.icueEvents\s*=/.test(code.replace(/\/\/[^\n]*/g, '')),
    'window.icueEvents is NOT the global let the bridge reads — handlers would never fire');
  check('no strict mode', !/['"]use strict['"]/.test(code),
    "iCUE injects properties as bare globals; strict mode breaks that");
  check('no ES modules', !/<script[^>]*type=["']module["']/.test(html));

  const externalSrc = [...html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)].map(m => m[1]);
  check('no external <script src> (QtWebEngine silently blocks them over file://)',
    externalSrc.length === 0, externalSrc.join(', '));

  const head = html.slice(0, html.indexOf('</head>'));
  const unclosed = [...head.matchAll(/<(?:meta|link)\b[^>]*>/g)].map(m => m[0]).filter(t => !t.trim().endsWith('/>'));
  check('all <head> void elements self-close (iCUE parses <head> as XML)',
    unclosed.length === 0, unclosed.slice(0, 3).join('\n'));

  check('every x-icue-property has a data-type', props.every(p => p.type), '');
  check('property names are alphanumeric only',
    propNames.every(n => /^[A-Za-z0-9]+$/.test(n)), propNames.filter(n => !/^[A-Za-z0-9]+$/.test(n)).join(', '));

  const sliders = props.filter(p => p.type === 'slider');
  const badSlider = sliders.filter(p => !p.min || !p.max || !p.step);
  check('every slider has data-min/data-max/data-step (missing step = silent import rejection)',
    badSlider.length === 0, badSlider.map(p => p.name).join(', '));

  const media = props.filter(p => p.type === 'media-selector');
  const badMedia = media.filter(p => !p.filters);
  check('every media-selector has data-filters', badMedia.length === 0, badMedia.map(p => p.name).join(', '));

  // tr() keys must all exist in translation.json
  const tp = path.join(WIDGET_DIR, 'translation.json');
  if (fs.existsSync(tp)) {
    let tj; try { tj = JSON.parse(fs.readFileSync(tp, 'utf8')); } catch (e) { tj = null; }
    check('translation.json is valid JSON', !!tj);
    if (tj) {
      const table = tj.en && tj.en.translation ? tj.en.translation : tj;
      const keys = [...html.matchAll(/tr\('([^']+)'\)/g)].map(m => m[1]);
      const missing = [...new Set(keys)].filter(k => !(k in table));
      check('every tr() key exists in translation.json', missing.length === 0, missing.join(', '));
    }
  }
  return { propNames };
}

// Build the dataScript exactly as iCUE composes it: one `let` per property,
// then the verbatim bootstrap, with the property assignments spliced into applyData.
function buildDataScript(props) {
  const decls = props.map(p => 'let ' + p.name + ' = ' + JSON.stringify(evalDefault(p.def, p.type)) + ';').join('\n');
  const assigns = props.map(p => '\t' + p.name + ' = data.' + p.name + ';').join('\n');
  let s = BOOTSTRAP;
  s = s.replace('let uniqueId = "', decls + '\nlet uniqueId = "');
  s = s.replace('\tuniqueId = data.uniqueId;', assigns + '\n\tuniqueId = data.uniqueId;');
  return s;
}

// Faithful stand-in for iCUE's Qt bridge: QWebChannel + the backend QObject.
function qtShim(props, initDelay) {
  const data = {};
  for (const p of props) data[p.name] = evalDefault(p.def, p.type);
  data.uniqueId = '{844cf1a5-b2b0-4834-a753-28d210755d66}';
  return `
(function () {
  function Signal() { this.h = []; }
  Signal.prototype.connect = function (fn) { this.h.push(fn); };
  Signal.prototype.emit = function () { var a = arguments; this.h.slice().forEach(function (f) { f.apply(null, a); }); };

  var initialized = false;
  var backend = {
    data: ${JSON.stringify(data)},
    dataChanged: new Signal(),
    updateRequested: new Signal(),
    initialized: new Signal(),
    tick: 0,
    localStoragePath: '',
    tr: function (s) { return s; },
    iCUEGlobalObject: { version: 'harness' },
    isInitialized: function () { return Promise.resolve(initialized); },
    notifyInitialized: function () {}
  };

  window.qt = { webChannelTransport: {} };
  window.QWebChannel = function (transport, cb) { cb({ objects: { backend: backend } }); };

  // Test hooks — how iCUE pushes a settings change and a refresh request.
  window.__icue = {
    setData: function (patch) {
      Object.assign(backend.data, patch);
      backend.dataChanged.emit(backend.data);
    },
    requestUpdate: function () { backend.updateRequested.emit(); },
    initializedFired: false
  };

  setTimeout(function () {
    initialized = true;
    window.__icue.initializedFired = true;
    backend.initialized.emit();
  }, ${initDelay});
})();
`;
}

// Deterministic network. Feeds and images are served from tools/fixtures so the
// harness tests the widget, not the internet. hackaday.com itself is refused, which
// is exactly what a browser does with a feed that sends no CORS header.
function installNetwork(page) {
  if (LIVE) return Promise.resolve();
  const F = path.join(__dirname, 'fixtures');
  const wpcom = fs.readFileSync(path.join(F, 'wpcom.json'), 'utf8');
  const wired = fs.readFileSync(path.join(F, 'wired.xml'), 'utf8');
  const rss2json = fs.readFileSync(path.join(F, 'rss2json.json'), 'utf8');
  const blox = fs.readFileSync(path.join(F, 'blox.xml'), 'utf8');
  const thumb = fs.readFileSync(path.join(F, 'thumb.png'));
  const cors = { 'access-control-allow-origin': '*' };
  return page.route('**/*', async (route) => {
    const u = route.request().url();
    if (u.startsWith('file://')) return route.continue();
    if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(u) || /wp-content|\/photos\//.test(u)) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: thumb, headers: cors });
    }
    if (/^https:\/\/hackaday\.com\//.test(u)) return route.abort('failed');   // no CORS header
    // A BLOX/TownNews paper: the feed is real but the site sends no CORS header,
    // so only the self-hosted relay can read it.
    if (/^https:\/\/www\.valleybreeze\.com\//.test(u)) return route.abort('failed');
    if (u.indexOf(RELAY_ORIGIN) === 0) {
      return route.fulfill({ status: 200, contentType: 'application/rss+xml', body: blox, headers: cors });
    }
    if (u.includes('public-api.wordpress.com')) {
      if (/\/sites\/[^/]+\?fields=name/.test(u)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'Hackaday' }), headers: cors });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: wpcom, headers: cors });
    }
    if (u.includes('api.rss2json.com')) return route.fulfill({ status: 200, contentType: 'application/json', body: rss2json, headers: cors });
    if (u.includes('wired.com/feed')) return route.fulfill({ status: 200, contentType: 'application/xml', body: wired, headers: cors });
    return route.abort('failed');
  });
}

async function main() {
  const html = fs.readFileSync(path.join(WIDGET_DIR, 'index.html'), 'utf8');
  const props = parseProperties(html);
  console.log('Widget: ' + WIDGET_DIR);
  console.log('Properties iCUE will inject as globals: ' + props.map(p => p.name).join(', '));
  staticChecks(html, props);

  // Stage a harness copy: bootstrap + Qt shim injected at document start.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'icue-harness-'));
  fs.cpSync(WIDGET_DIR, stage, { recursive: true, filter: (s) => !s.includes('node_modules') && !s.includes('.git') });
  const injected = html.replace('<head>',
    '<head>\n<script>' + qtShim(props, INIT_DELAY) + '</script>\n<script>' + buildDataScript(props) + '</script>');
  fs.writeFileSync(path.join(stage, 'index.html'), injected);
  const url = 'file://' + path.join(stage, 'index.html').replace(/\\/g, '/');

  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });

  console.log('\n── runtime (iCUE bootstrap replica) ──');
  const SIZES = [
    { n: 'S-H', w: 840, h: 344 }, { n: 'S-V', w: 696, h: 416 },
    { n: 'L-H', w: 1688, h: 696 }, { n: 'XL-H', w: 2536, h: 696 }
  ];

  for (const s of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await installNetwork(page);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.story-row', { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(800);

    const st = await page.evaluate(() => ({
      handlerRegistered: typeof icueEvents === 'object' && typeof icueEvents.onICUEInitialized === 'function',
      icueInit: typeof iCUE_initialized !== 'undefined' && iCUE_initialized,
      crash: !!document.getElementById('icueCrash'),
      crashText: (document.getElementById('icueCrash') || {}).textContent || '',
      loading: (document.querySelector('.loading-state') || {}).style?.display !== 'none',
      content: (document.querySelector('.content') || {}).style?.display !== 'none',
      rows: document.querySelectorAll('.story-row').length,
      title: (document.getElementById('widgetTitleEl') || {}).textContent,
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    }));

    console.log('  [' + s.n + '] ' + JSON.stringify({ rows: st.rows, title: st.title, content: st.content }));
    check(s.n + ': iCUE saw our onICUEInitialized handler', st.handlerRegistered === true);
    check(s.n + ': no crash overlay', st.crash === false, st.crashText.slice(0, 300));
    check(s.n + ': not stuck on loading', st.loading === false);
    check(s.n + ': rendered stories', st.rows > 0);
    check(s.n + ': no horizontal overflow', st.hScroll === false);
    check(s.n + ': no page errors', errs.length === 0, errs.slice(0, 2).join('; '));
    await page.screenshot({ path: path.join(SHOTS, 'icue-' + s.n + '.png') });
    await ctx.close();
  }

  // A settings change must reach the widget through onDataUpdated.
  console.log('\n── settings propagation ──');
  const ctx = await browser.newContext({ viewport: { width: 840, height: 344 } });
  const page = await ctx.newPage();
  const errs2 = [];
  page.on('pageerror', e => errs2.push(e.message));
  await installNetwork(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.story-row', { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => document.querySelectorAll('.story-row').length);
  await page.evaluate(() => window.__icue.setData({ maxItems: 4, widgetTitle: 'Harness Title' }));
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => ({
    rows: document.querySelectorAll('.story-row').length,
    title: document.getElementById('widgetTitleEl').textContent,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim()
  }));
  check('onDataUpdated applied maxItems (' + before + ' → ' + after.rows + ')', after.rows === 4, JSON.stringify(after));
  check('onDataUpdated applied widgetTitle', after.title === 'Harness Title', after.title);
  await page.evaluate(() => window.__icue.setData({ accentColor: '#22d3ee' }));
  await page.waitForTimeout(500);
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim());
  check('onDataUpdated applied accentColor', accent === '#22d3ee', accent);
  check('no page errors during settings changes', errs2.length === 0, errs2.slice(0, 2).join('; '));
  await ctx.close();

  // ── interaction ──
  console.log('\n── interaction ──');
  const ictx = await browser.newContext({ viewport: { width: 840, height: 344 } });
  const ipage = await ictx.newPage();
  const errs3 = [];
  ipage.on('pageerror', e => errs3.push(e.message));
  await installNetwork(ipage);
  await ipage.goto(url, { waitUntil: 'domcontentloaded' });
  await ipage.waitForSelector('.story-row', { timeout: 45000 });

  await ipage.click('.story-row');
  await ipage.waitForTimeout(350);
  const detail = await ipage.evaluate(() => ({
    open: document.querySelector('.detail-view').style.display !== 'none',
    title: document.getElementById('detailTitle').textContent,
    descLen: (document.getElementById('detailDesc').textContent || '').length,
    link: document.getElementById('detailLink').textContent
  }));
  check('story tap opens the detail view', detail.open === true);
  check('detail shows a title and summary', !!detail.title && detail.descLen > 40, JSON.stringify(detail).slice(0, 160));
  check('detail links to the real article', /^https:\/\/hackaday\.com\/20/.test(detail.link), detail.link);
  await ipage.screenshot({ path: path.join(SHOTS, 'icue-detail.png') });

  await ipage.click('#backBtn'); await ipage.waitForTimeout(200);
  await ipage.click('#topbar'); await ipage.waitForTimeout(300);
  check('header tap opens the feed switcher',
    await ipage.evaluate(() => document.getElementById('filterBar').style.display !== 'none'));
  const chips = await ipage.$$('.filter-chip');
  check('one chip per configured feed', chips.length === 2, String(chips.length));
  const note = await ipage.evaluate(() => (document.getElementById('filterNote') || {}).textContent || '');
  check('the switcher names the route that answered', /^via wordpress\.com/.test(note), note);
  await chips[1].click(); await ipage.waitForTimeout(900);
  const after2 = await ipage.evaluate(() => ({
    title: document.getElementById('widgetTitleEl').textContent,
    rows: document.querySelectorAll('.story-row').length
  }));
  check('switching feeds parses the RSS/XML route', /wired/i.test(after2.title) && after2.rows > 0, JSON.stringify(after2));
  check('no page errors during interaction', errs3.length === 0, errs3.slice(0, 2).join('; '));
  await ipage.screenshot({ path: path.join(SHOTS, 'icue-feed2.png') });
  await ictx.close();

  // ── route fallback: WordPress down, rss2json must take over ──
  console.log('\n── route fallback ──');
  const fctx = await browser.newContext({ viewport: { width: 840, height: 344 } });
  const fpage = await fctx.newPage();
  await installNetwork(fpage);
  if (!LIVE) {
    await fpage.route('**/public-api.wordpress.com/**', r => r.abort('failed'));
  }
  await fpage.goto(url, { waitUntil: 'domcontentloaded' });
  await fpage.waitForSelector('.story-row', { timeout: 60000 }).catch(() => {});
  await fpage.waitForTimeout(600);
  const fb = await fpage.evaluate(() => ({
    rows: document.querySelectorAll('.story-row').length,
    title: (document.getElementById('widgetTitleEl') || {}).textContent
  }));
  check('falls through to the next working route when one dies', fb.rows > 0, JSON.stringify(fb));
  await fctx.close();

  // ── Feed Mode "rotate": the panel hands over every 15 minutes ──
  // Fake clock, because nobody should wait 15 real minutes for a test.
  console.log('\n── rotate mode ──');
  const octx = await browser.newContext({ viewport: { width: 840, height: 344 } });
  const opage = await octx.newPage();
  await opage.clock.install({ time: new Date() });
  await installNetwork(opage);
  await opage.goto(url, { waitUntil: 'domcontentloaded' });
  await opage.clock.runFor(3000);                       // let boot + grace poll timers fire
  await opage.waitForSelector('.story-row', { timeout: 45000 }).catch(() => {});
  await opage.evaluate(() => window.__icue.setData({ mergeFeeds: 'rotate' }));
  await opage.clock.runFor(2000);
  await opage.waitForTimeout(600);

  const rotTitle = () => opage.evaluate(() => ({
    title: (document.getElementById('widgetTitleEl') || {}).textContent,
    active: (document.querySelector('.filter-chip.on') || {}).textContent || '',
    rows: document.querySelectorAll('.story-row').length
  }));
  const rot0 = await rotTitle();
  await opage.clock.fastForward('15:00');
  await opage.waitForTimeout(600);
  const rot1 = await rotTitle();
  await opage.clock.fastForward('15:00');
  await opage.waitForTimeout(600);
  const rot2 = await rotTitle();

  check('rotate is a separate mode, not merge (one feed still shown)',
    rot0.rows > 0 && !/all feeds/i.test(rot0.title || ''), JSON.stringify(rot0));
  check('15 min later the panel is on the next feed',
    !!rot1.title && rot1.title !== rot0.title, JSON.stringify({ rot0: rot0.title, rot1: rot1.title }));
  check('the active chip follows the rotation',
    /wired/i.test(rot1.active), JSON.stringify(rot1));
  check('rotation wraps back to the first feed',
    rot2.title === rot0.title, JSON.stringify({ rot0: rot0.title, rot2: rot2.title }));

  // An open story is not yanked away mid-read — the beat is skipped.
  await opage.click('.story-row');
  await opage.waitForTimeout(300);
  await opage.clock.fastForward('15:00');
  await opage.waitForTimeout(400);
  const held = await opage.evaluate(() => ({
    detail: document.querySelector('.detail-view').style.display !== 'none',
    title: (document.getElementById('widgetTitleEl') || {}).textContent
  }));
  check('a beat that lands while a story is open is skipped',
    held.detail === true && held.title === rot2.title, JSON.stringify(held));
  await octx.close();

  // ── named feed through the self-hosted LAN relay (BLOX/TownNews paper) ──
  // The paper sends no CORS header and no public relay reads it reliably, so the
  // widget has to accept a plain-http LAN proxy and show the label, not the
  // "www.example.com - RSS Results ..." title the feed reports.
  console.log('\n── named feed + LAN relay ──');
  const rctx = await browser.newContext({ viewport: { width: 840, height: 344 } });
  const rpage = await rctx.newPage();
  const errs4 = [];
  rpage.on('pageerror', e => errs4.push(e.message));
  await installNetwork(rpage);
  await rpage.goto(url, { waitUntil: 'domcontentloaded' });
  await rpage.waitForSelector('.story-row', { timeout: 45000 }).catch(() => {});
  await rpage.evaluate((cfg) => window.__icue.setData(cfg), {
    feedUrl1: 'Valley Breeze|' + BLOX_FEED,
    feedUrl2: '',
    customProxy: RELAY_ORIGIN + '/?url={url}'
  });
  await rpage.waitForTimeout(3000);
  const relayState = await rpage.evaluate(() => ({
    rows: document.querySelectorAll('.story-row').length,
    title: (document.getElementById('widgetTitleEl') || {}).textContent,
    chips: [...document.querySelectorAll('.filter-chip')].map(c => c.textContent.trim()),
    sources: [...document.querySelectorAll('.story-row')].map(r => (r.textContent || '')).join(' | '),
    note: (document.getElementById('filterNote') || {}).textContent || ''
  }));
  check('LAN http relay is accepted as a custom proxy', relayState.rows > 0, JSON.stringify(relayState));
  check('label overrides the BLOX channel title', /^Valley Breeze$/.test((relayState.title || '').trim()), JSON.stringify(relayState));
  check('one chip, named by the label', relayState.chips.length === 1 && /Valley Breeze/.test(relayState.chips[0] || ''), JSON.stringify(relayState.chips));
  check('no "RSS Results of type article" leaks into the rows',
    !/RSS Results/i.test(relayState.sources), (relayState.sources.match(/[^|]*RSS Results[^|]*/) || [''])[0].slice(0, 120));
  check('bylines carry no e-mail address',
    !/@[\w.-]+\.[A-Za-z]{2,}/.test(relayState.sources), (relayState.sources.match(/\S+@\S+/) || [''])[0].slice(0, 80));
  check('the switcher shows the feed came through the custom proxy',
    /^via custom proxy/.test(relayState.note), relayState.note);
  check('no page errors on the relay route', errs4.length === 0, errs4.slice(0, 2).join('; '));
  await rpage.screenshot({ path: path.join(SHOTS, 'icue-relay-feed.png') });
  await rctx.close();

  // A configured proxy must not shadow the WordPress route: an RSS file holds
  // whatever the site publishes (~10 items), the posts API holds Max Stories.
  console.log('\n── proxy does not shadow wordpress.com ──');
  const wctx = await browser.newContext({ viewport: { width: 840, height: 344 } });
  const wpage = await wctx.newPage();
  await installNetwork(wpage);
  await wpage.goto(url, { waitUntil: 'domcontentloaded' });
  await wpage.waitForSelector('.story-row', { timeout: 45000 }).catch(() => {});
  await wpage.waitForTimeout(600);
  const wpBefore = await wpage.evaluate(() => document.querySelectorAll('.story-row').length);
  await wpage.evaluate((relay) => window.__icue.setData({ customProxy: relay + '/?url={url}' }), RELAY_ORIGIN);
  await wpage.waitForTimeout(2500);
  const wpAfter = await wpage.evaluate(() => ({
    rows: document.querySelectorAll('.story-row').length,
    note: (document.getElementById('filterNote') || {}).textContent || '',
    first: (document.querySelector('.story-title') || {}).textContent || ''
  }));
  check('a configured proxy does not shadow the wordpress.com route',
    /^via wordpress\.com/.test(wpAfter.note), wpAfter.note);
  check('setting a proxy does not shrink the story count',
    wpAfter.rows === wpBefore && wpBefore > 0, wpBefore + ' → ' + wpAfter.rows);
  check('the WordPress feed still shows its own stories',
    !/ICE detention|Quarter Auction/i.test(wpAfter.first), wpAfter.first.slice(0, 80));
  await wctx.close();

  // A feed quietly demoted to a public relay must say so: when a proxy is
  // configured and fails, the switcher names the failure instead of hiding it.
  if (!LIVE) {
    console.log('\n── proxy failure is visible ──');
    const dctx = await browser.newContext({ viewport: { width: 840, height: 344 } });
    const dpage = await dctx.newPage();
    await installNetwork(dpage);
    await dpage.route(RELAY_ORIGIN + '/**', r => r.abort('failed'));   // relay down
    await dpage.goto(url, { waitUntil: 'domcontentloaded' });
    await dpage.waitForSelector('.story-row', { timeout: 45000 }).catch(() => {});
    await dpage.evaluate((cfg) => window.__icue.setData(cfg), {
      feedUrl1: 'Valley Breeze|' + BLOX_FEED,
      feedUrl2: '',
      customProxy: RELAY_ORIGIN + '/?url={url}'
    });
    await dpage.waitForTimeout(3000);
    const down = await dpage.evaluate(() => ({
      note: (document.getElementById('filterNote') || {}).textContent || '',
      rows: document.querySelectorAll('.story-row').length
    }));
    check('a dead proxy does not take the feed down with it', down.rows > 0, JSON.stringify(down));
    check('the switcher reports the proxy failure', /custom proxy:/.test(down.note), down.note);
    await dctx.close();
  }

  // http is allowed only for addresses that cannot leave the LAN — a public
  // http proxy must never be contacted (it would leak the feed list in clear).
  const sctx = await browser.newContext({ viewport: { width: 840, height: 344 } });
  const spage = await sctx.newPage();
  const seen = [];
  spage.on('request', r => seen.push(r.url()));
  await installNetwork(spage);
  await spage.goto(url, { waitUntil: 'domcontentloaded' });
  await spage.waitForSelector('.story-row', { timeout: 45000 }).catch(() => {});
  await spage.evaluate((cfg) => window.__icue.setData(cfg), {
    feedUrl1: 'Valley Breeze|' + BLOX_FEED,
    feedUrl2: '',
    customProxy: 'http://relay.public.example/?url={url}'
  });
  await spage.waitForTimeout(2500);
  check('public http proxy is refused',
    !seen.some(u => u.indexOf('relay.public.example') !== -1),
    seen.filter(u => u.indexOf('example') !== -1).slice(0, 3).join(' '));
  await sctx.close();

  await browser.close();

  if (!KEEP) fs.rmSync(stage, { recursive: true, force: true });
  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' passed, ' + fail + ' failed');
  console.log('screenshots: ' + SHOTS);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
