'use strict';
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const yaml = require('js-yaml');

// ---- classification rules (RFP 2.2.1) -------------------------------------
const DECO_PATTERNS = ['bg-', 'pattern-', 'deco-'];
const HERO_RE = /(hero|main|top|kv|mv)/i;
const SECTION_TAGS = ['section', 'header', 'footer', 'main', 'article'];

function classList($, el) {
  return ($(el).attr('class') || '').split(/\s+/).filter(Boolean);
}
function tagOf(el) {
  return (el.tagName || el.name || '').toLowerCase();
}
function hasDecoClass(classes) {
  return classes.some(c => DECO_PATTERNS.some(p => c.includes(p)));
}
function ariaHidden($, el) {
  return $(el).attr('aria-hidden') === 'true';
}
// decoration if the element OR any ancestor is aria-hidden or carries a deco class
function isDecoration($, el) {
  if (ariaHidden($, el) || hasDecoClass(classList($, el))) return true;
  return $(el).parents().toArray().some(a =>
    ($(a).attr('aria-hidden') === 'true') || hasDecoClass(classList($, a)));
}

function sanitize(s) {
  const v = (s || '').toString().trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!v) return 'x';
  // ACF/PHP のキー・JS 変数として使えるよう、数字始まりは接頭辞を付ける
  return /^[0-9]/.test(v) ? 'sec_' + v : v;
}

// nearest meaningful section ancestor + whether it is a hero/main block
// パス1で id 持ち or セクションタグの祖先を優先し、無ければパス2で section風クラスを拾う。
// これにより section#features を内側の div.feature より優先できる。
function sectionFor($, el) {
  const ancestors = $(el).parents().toArray();
  let chosen = null;
  // パス1: id を持つ、またはセクションタグの最も近い祖先
  for (const a of ancestors) {
    if ($(a).attr('id') || SECTION_TAGS.includes(tagOf(a))) { chosen = a; break; }
  }
  // パス2: なければ section風クラスの最も近い祖先
  if (!chosen) {
    for (const a of ancestors) {
      if (classList($, a).some(c => /(section|hero|feature|block|content)/i.test(c))) {
        chosen = a; break;
      }
    }
  }
  if (!chosen) return { name: 'page', isHero: false };
  const tag = tagOf(chosen);
  const id = $(chosen).attr('id');
  const cls = classList($, chosen);
  const nameSrc = id || cls.find(c => !DECO_PATTERNS.some(p => c.includes(p)) && sanitize(c) !== sanitize(tag)) || tag;
  const isHero = HERO_RE.test(id || '') || cls.some(c => HERO_RE.test(c)) || HERO_RE.test(tag);
  return { name: sanitize(nameSrc), isHero };
}

// element -> {token (要素種別), acf type, default value}
function elementSpec($, el) {
  const tag = tagOf(el);
  const text = $(el).text().trim();
  if (/^h[1-3]$/.test(tag)) return { token: 'title', type: 'text', value: text };
  if (/^h[4-6]$/.test(tag)) return { token: 'heading', type: 'text', value: text };
  if (tag === 'p') return { token: 'text', type: 'textarea', value: text };
  if (tag === 'img') return { token: 'image', type: 'image', value: $(el).attr('src') || $(el).attr('data-src') || '' };
  if (tag === 'svg') return { token: 'icon', type: 'image', value: '<inline-svg>' };
  return null;
}

function scanHtml(html, file) {
  const $ = cheerio.load(html);
  $('section, main, article').each((i, el) => $(el).attr('data-ich-sec', String(i)));
  const page = {
    id: sanitize(file.replace(/\.html?$/i, '').replace(/\/index$/i, '')) || 'index',
    file,
    title: $('title').first().text().trim() || $('h1').first().text().trim() || file,
    sections: new Map(),   // name -> { fields: [] }（Mapで挿入順を保持）
    nav: [],
    forms: [],
    decoration: [],
    meta: {},
  };

  // meta tags
  page.meta.title = $('title').first().text().trim() || null;
  page.meta.description = $('meta[name="description"]').attr('content') || null;
  const ogp = {};
  $('meta[property^="og:"]').each((i, el) => { ogp[$(el).attr('property')] = $(el).attr('content') || ''; });
  if (Object.keys(ogp).length) page.meta.ogp = ogp;

  // navigation -> WP custom menu candidates
  $('nav').each((i, nav) => {
    const cls = classList($, nav);
    const links = [];
    $(nav).find('a').each((j, a) => links.push({ text: $(a).text().trim(), href: $(a).attr('href') || '' }));
    page.nav.push({ selector: 'nav' + (cls.length ? '.' + cls[0] : ''), links });
  });

  // forms -> Contact Form 7 conversion targets
  $('form').each((i, f) => {
    const fields = [];
    $(f).find('input,textarea,select').each((j, inp) => {
      if (tagOf(inp) === 'input' && ['submit', 'button', 'hidden'].includes(($(inp).attr('type') || '').toLowerCase())) return;
      fields.push({
        name: $(inp).attr('name') || '',
        tag: tagOf(inp),
        type: $(inp).attr('type') || tagOf(inp),
        placeholder: $(inp).attr('placeholder') || '',
      });
    });
    page.forms.push({ action: $(f).attr('action') || '', method: ($(f).attr('method') || 'get').toLowerCase(), fields });
  });

  // candidate editable elements, in document order
  $('h1,h2,h3,h4,h5,h6,p,img,svg').each((i, el) => {
    const spec = elementSpec($, el);
    if (!spec) return;
    if (isDecoration($, el)) {
      const cls = classList($, el);
      const decoClass = cls.find(c => DECO_PATTERNS.some(p => c.includes(p)));
      const reason = decoClass ? `class*="${decoClass}"` : 'aria-hidden="true"';
      page.decoration.push({ selector: tagOf(el) + (cls.length ? '.' + cls[0] : ''), reason });
      return;
    }
    const sec = sectionFor($, el);
    const tab = (sec.isHero && ['title', 'text', 'image'].includes(spec.token)) ? 'main' : 'section';
    if (!page.sections.has(sec.name)) page.sections.set(sec.name, { fields: [] });
    page.sections.get(sec.name).fields.push({ element: tagOf(el), token: spec.token, type: spec.type, value: spec.value, tab });
  });

  return page;
}

// naming rule: {section}_{token}_{seq}; seq omitted when the token occurs once
function assignNames(page) {
  for (const [secName, sec] of page.sections) {
    const total = {};
    sec.fields.forEach(f => { total[f.token] = (total[f.token] || 0) + 1; });
    const seen = {};
    sec.fields.forEach(f => {
      seen[f.token] = (seen[f.token] || 0) + 1;
      const suffix = total[f.token] > 1 ? `_${seen[f.token]}` : '';
      f.field_name = `${secName}_${f.token}${suffix}`;
    });
  }
}

function buildAcfMap(pages, project) {
  const byTab = { main: 0, section: 0 };
  const outPages = pages.map(p => {
    const sections = [...p.sections].map(([name, sec]) => ({
      id: name,
      fields: sec.fields.map(f => ({
        element: f.element, field_name: f.field_name, tab: f.tab, type: f.type, default: f.value,
      })),
    }));
    return { id: p.id, title: p.title, file: p.file, sections, nav: p.nav, forms: p.forms, decoration: p.decoration, meta: p.meta };
  });

  // セクションの内容シグネチャ（id + 各フィールドの要素・名前・既定値）で完全一致を判定する
  const sig = sec => sec.id + '#' + sec.fields.map(f => `${f.element}:${f.field_name}=${f.default}`).join('|');
  const count = {}, sample = {};
  for (const p of outPages) for (const sec of p.sections) { const s = sig(sec); count[s] = (count[s] || 0) + 1; sample[s] = sec; }
  const threshold = Math.max(2, Math.ceil(outPages.length * 0.5));
  const commonSigs = new Set(Object.keys(count).filter(s => count[s] >= threshold));
  const common = [...commonSigs].map(s => sample[s]);
  for (const p of outPages) p.sections = p.sections.filter(sec => !commonSigs.has(sig(sec)));

  let candidates = 0, deco = 0;
  for (const sec of common) for (const f of sec.fields) { candidates++; byTab[f.tab] = (byTab[f.tab] || 0) + 1; }
  for (const p of outPages) {
    deco += p.decoration.length;
    for (const sec of p.sections) for (const f of sec.fields) { candidates++; byTab[f.tab] = (byTab[f.tab] || 0) + 1; }
  }

  return {
    project,
    generated_at: new Date().toISOString().slice(0, 10),
    common,
    pages: outPages,
    coverage: { acf_candidates: candidates, decoration: deco, by_tab: byTab },
  };
}

function renderClaudeMd(map, tmplPath) {
  const tmpl = fs.readFileSync(tmplPath, 'utf8');
  const pageLines = map.pages.map(p => `- ${p.title} (${p.file})`).join('\n');
  return tmpl
    .replace(/\{\{PROJECT\}\}/g, map.project)
    .replace(/\{\{GENERATED\}\}/g, map.generated_at)
    .replace(/\{\{PAGES\}\}/g, pageLines);
}

// mockup配下の .html を再帰収集する（base からの相対パスを返す）。
// 隠しフォルダと node_modules は除外する。
function listHtml(dir, base) {
  base = base || dir;
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listHtml(full, base));
    else if (/\.html?$/i.test(e.name)) out.push(path.relative(base, full));
  }
  return out;
}

function runScan({ dir, out, project, tmpl }) {
  const proj = project || sanitize(path.basename(path.resolve(dir)));
  const files = listHtml(dir).sort();
  if (!files.length) { console.error(`no .html files in ${dir}`); process.exit(1); }
  const pages = files.map(f => {
    const page = scanHtml(fs.readFileSync(path.join(dir, f), 'utf8'), f);
    assignNames(page);
    return page;
  });
  const map = buildAcfMap(pages, proj);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'acf-map.yaml'), yaml.dump(map, { lineWidth: 100, noRefs: true, sortKeys: false }));
  fs.writeFileSync(path.join(out, 'CLAUDE.md'), renderClaudeMd(map, tmpl));
  console.log(`scanned ${pages.length} page(s): ${proj}`);
  console.log(`  ACF candidates: ${map.coverage.acf_candidates} (main ${map.coverage.by_tab.main}, section ${map.coverage.by_tab.section})`);
  console.log(`  decoration: ${map.coverage.decoration}`);
  console.log(`  -> ${path.join(out, 'acf-map.yaml')}`);
  console.log(`  -> ${path.join(out, 'CLAUDE.md')}`);
  return map;
}

module.exports = { runScan, scanHtml, assignNames, buildAcfMap };
