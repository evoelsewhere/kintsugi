import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.site-dist');
const origin = new URL(process.env.SITE_URL ?? 'https://kintsugi.evoelsewhere.asia/');
if (origin.protocol !== 'https:' || origin.search || origin.hash || origin.username || origin.password) {
  throw new Error('SITE_URL must be a public HTTPS URL without credentials, a query or a fragment');
}
if (!origin.pathname.endsWith('/')) origin.pathname += '/';
const base = origin.pathname;
const repository = 'https://github.com/evoelsewhere/kintsugi';
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const plain = (value) => value.replace(/<[^>]+>/g, '').replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_>#]/g, '').replace(/\s+/g, ' ').trim();
const slug = (value) => plain(value).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
const urlFor = (file) => `docs/${file.replace(/\.md$/, '.html').replace(/(^|\/)README\.html$/, '$1index.html')}`;
const absolute = (url) => new URL(url, origin).href;
async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(file) : entry.name.endsWith('.md') ? [file] : [];
  }));
  return groups.flat().sort();
}
const files = await markdownFiles(path.join(root, 'docs'));
const pages = await Promise.all(files.map(async (file) => {
  const source = await readFile(file, 'utf8');
  const relative = path.relative(path.join(root, 'docs'), file).split(path.sep).join('/');
  const title = plain(source.match(/^#\s+(.+)$/m)?.[1] ?? relative);
  const firstParagraph = source.split(/\n\s*\n/).find((paragraph) => /^[A-Za-z]/.test(paragraph));
  return { file, relative, source, title, description: plain(firstParagraph ?? `Kintsugi documentation: ${title}.`).slice(0, 190), url: urlFor(relative), group: relative.includes('/') ? relative.split('/')[0] : 'overview' };
}));
const groups = [['overview', 'Documentation'], ['guides', 'Guides'], ['methodology', 'Methodology'], ['product', 'Product'], ['reference', 'Reference'], ['architecture', 'Architecture'], ['decisions', 'Decisions'], ['development', 'Delivery record']];
for (const [group, title] of groups) {
  if (group === 'overview' || pages.some((page) => page.relative === `${group}/README.md`)) continue;
  const members = pages.filter((page) => page.group === group);
  const relative = `${group}/README.md`;
  pages.push({ file: path.join(root, 'docs', relative), relative, group, title,
    source: `# ${title}\n\nBrowse the Kintsugi ${title.toLowerCase()} documentation.\n\n${members.map((page) => `- [${page.title}](${path.posix.relative(group, page.relative)})`).join('\n')}`,
    description: `Kintsugi ${title.toLowerCase()}: ${members.map((page) => page.title).join(', ').slice(0, 140)}.`,
    url: urlFor(relative), generated: true });
}
const byFile = new Map(pages.map((page) => [page.file, page]));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, 'site'), output, { recursive: true, filter: (file) => !['mock', 'README.md'].includes(path.basename(file)) });
const require = createRequire(import.meta.url);
await mkdir(path.join(output, 'assets/vendor'), { recursive: true });
await cp(require.resolve('mermaid/dist/mermaid.min.js'), path.join(output, 'assets/vendor/mermaid.min.js'));
await cp(require.resolve('mermaid/LICENSE'), path.join(output, 'assets/vendor/mermaid-LICENSE'));
const landing = (await readFile(path.join(output, 'index.html'), 'utf8')).replaceAll('https://kintsugi.evoelsewhere.asia/', origin.href);
await writeFile(path.join(output, 'index.html'), landing);
const search = [];
for (const page of pages) {
  const headings = [];
  const counts = new Map();
  const marked = new Marked({ gfm: true, renderer: {
    heading({ tokens, depth, text }) {
      const key = slug(text);
      const count = counts.get(key) ?? 0;
      counts.set(key, count + 1);
      const id = count ? `${key}-${count}` : key;
      if (depth > 1 && depth < 4) headings.push({ id, text: plain(text), depth });
      return `<h${depth} id="${escape(id)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
    html({ text }) { return escape(text); },
    code({ text, lang }) {
      if (lang === 'mermaid') return `<figure class="diagram"><div class="diagram-visual" role="img" aria-label="Architecture or workflow diagram"></div><details open><summary>Diagram source (Mermaid)</summary><pre class="mermaid-source"><code>${escape(text)}</code></pre></details></figure>`;
      return `<pre><code${lang ? ` class="language-${escape(lang)}"` : ''}>${escape(text)}</code></pre>`;
    },
  }, walkTokens(token) {
    if ((token.type === 'link' || token.type === 'image') && token.href && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(token.href)) {
      const [pathname, fragment] = token.href.split('#');
      const target = path.resolve(path.dirname(page.file), decodeURIComponent(pathname));
      const local = byFile.get(target) ?? byFile.get(path.join(target, 'README.md'));
      token.href = local ? `${base}${local.url}${fragment ? `#${fragment}` : ''}` : `${repository}/blob/master/${path.relative(root, target).split(path.sep).map(encodeURIComponent).join('/')}${fragment ? `#${fragment}` : ''}`;
    }
  } });
  const body = marked.parse(page.source);
  const canonical = absolute(page.url);
  const sourceRelative = page.generated ? 'README.md' : page.relative;
  const sidebar = groups.map(([key, label]) => {
    const entries = pages.filter((entry) => entry.group === key);
    if (!entries.length) return '';
    return `<details${key === page.group || key === 'guides' ? ' open' : ''}><summary>${label}</summary>${entries.map((entry) => `<a href="${base}${entry.url}"${entry === page ? ' aria-current="page"' : ''}>${escape(entry.title)}</a>`).join('')}</details>`;
  }).join('');
  const structured = { '@context': 'https://schema.org', '@type': 'TechArticle', headline: page.title, description: page.description, url: canonical, isPartOf: { '@type': 'WebSite', name: 'Kintsugi', url: origin.href }, inLanguage: 'en' };
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(page.title)} · Kintsugi docs</title><meta name="description" content="${escape(page.description)}"><link rel="canonical" href="${canonical}">
<meta property="og:type" content="article"><meta property="og:title" content="${escape(page.title)} · Kintsugi"><meta property="og:description" content="${escape(page.description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${absolute('assets/social-card.jpg')}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${base}assets/brand/kintsugi-mark-light.svg" type="image/svg+xml"><link rel="stylesheet" href="${base}assets/docs.css">
<script type="application/ld+json">${JSON.stringify(structured).replace(/</g, '\\u003c')}</script><script src="${base}assets/docs.js" defer></script></head>
<body><a class="skip" href="#article">Skip to content</a><header><a class="brand" href="${base}"><img src="${base}assets/brand/kintsugi-mark-light.svg" width="28" height="28" alt="">Kintsugi <span>/ docs</span></a><nav aria-label="Documentation shortcuts"><a href="${base}docs/guides/first-project.html">Start here</a><a href="${repository}">GitHub ↗</a></nav></header>
<div class="docs-layout"><aside class="sidebar"><label for="doc-search">Find a document</label><input id="doc-search" type="search" placeholder="Search guides, concepts, commands…" autocomplete="off"><p id="search-status" role="status"></p><ul id="search-results" hidden></ul><details class="doc-navigation" open><summary>Browse documentation</summary><nav aria-label="Documentation">${sidebar}</nav></details></aside>
<main id="article"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="${base}">Home</a> / <a href="${base}docs/index.html">Docs</a> / ${escape(page.group)}</nav><div class="article-meta">${escape(page.group)} · Development documentation <a href="${repository}/blob/master/docs/${sourceRelative}">${page.generated ? 'Documentation source' : 'View Markdown'} ↗</a></div><article>${body}</article><footer>Built from this repository's Markdown. <a href="${repository}/edit/master/docs/${sourceRelative}">Suggest an edit ↗</a> · <a href="${base}docs/guides/docker-images.html">Deploy Docker images</a></footer></main>
<aside class="toc"><nav aria-label="On this page"><b>On this page</b>${headings.map((heading) => `<a class="level-${heading.depth}" href="#${escape(heading.id)}">${escape(heading.text)}</a>`).join('')}</nav></aside></div></body></html>`;
  await mkdir(path.dirname(path.join(output, page.url)), { recursive: true });
  await writeFile(path.join(output, page.url), html);
  search.push({ title: page.title, description: page.description, group: page.group, url: `${base}${page.url}`, text: plain(page.source) });
}
await writeFile(path.join(output, 'docs/search.json'), JSON.stringify(search));
// These are the actual package files, copied at build time rather than maintained twice.
await mkdir(path.join(output, 'downloads'), { recursive: true });
for (const file of ['docker-compose.yml', '.env.example']) await cp(path.join(root, 'deploy/compose', file), path.join(output, 'downloads', file === '.env.example' ? 'env.example' : file));
const urls = ['', ...pages.map((page) => page.url)];
await writeFile(path.join(output, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `<url><loc>${escape(absolute(url))}</loc></url>`).join('')}</urlset>\n`);
await writeFile(path.join(output, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${absolute('sitemap.xml')}\n`);
await writeFile(path.join(output, '.nojekyll'), '');
// Fail the build on missing internal documents, images, scripts or downloads.
for (const file of ['index.html', ...pages.map((page) => page.url)]) {
  const html = await readFile(path.join(output, file), 'utf8');
  for (const match of html.matchAll(/(?:href|src|poster)="([^"#]+)(?:#[^"]*)?"/g)) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(match[1])) continue;
    const clean = match[1].split(/[?#]/)[0];
    const target = clean.startsWith(base) ? clean.slice(base.length) : path.posix.join(path.posix.dirname(file), clean);
    const found = await stat(path.join(output, target || 'index.html')).catch(() => null);
    if (!found) throw new Error(`Broken local link in ${file}: ${match[1]}`);
  }
}
console.log(`Built landing page + ${pages.length} documentation pages, search, downloads and sitemap in ${output}`);
