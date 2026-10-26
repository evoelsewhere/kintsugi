(() => {
  const siteRoot = new URL('../', document.querySelector('script[src$="assets/docs.js"]').src);
  if (matchMedia('(max-width: 700px)').matches) document.querySelector('.doc-navigation').open = false;
  const input = document.querySelector('#doc-search');
  const results = document.querySelector('#search-results');
  const status = document.querySelector('#search-status');
  let index;
  let sequence = 0;
  input.addEventListener('input', async () => {
    const current = ++sequence;
    const query = input.value.trim().toLowerCase();
    results.replaceChildren();
    results.hidden = true;
    if (!query) { status.textContent = ''; return; }
    try {
      index ??= fetch(new URL('docs/search.json', siteRoot)).then((response) => {
        if (!response.ok) throw new Error('Search index unavailable');
        return response.json();
      });
      const pages = await index;
      if (current !== sequence) return;
      const words = query.split(/\s+/);
      const matches = pages.filter((page) => words.every((word) => `${page.title} ${page.text}`.toLowerCase().includes(word)))
        .sort((a, b) => Number(b.title.toLowerCase().includes(query)) - Number(a.title.toLowerCase().includes(query)));
      status.textContent = `${matches.length} document${matches.length === 1 ? '' : 's'} found${matches.length > 12 ? ' · showing first 12' : ''}`;
      for (const page of matches.slice(0, 12)) {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = page.url;
        link.textContent = page.title;
        li.append(link);
        results.append(li);
      }
      results.hidden = matches.length === 0;
    } catch {
      index = undefined;
      status.textContent = 'Search is unavailable. Browse the documentation below.';
    }
  });
  const diagrams = document.querySelectorAll('.diagram');
  if (!diagrams.length) return;
  let engine;
  const loadEngine = () => engine ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('assets/vendor/mermaid.min.js', siteRoot).href;
    script.onload = () => {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', suppressErrorRendering: true });
      resolve(window.mermaid);
    };
    script.onerror = reject;
    document.head.append(script);
  });
  let queue = Promise.resolve();
  const render = (figure, index) => {
    queue = queue.then(async () => {
      try {
        const mermaid = await loadEngine();
        const source = figure.querySelector('code').textContent;
        const { svg } = await mermaid.render(`doc-diagram-${index}`, source);
        figure.querySelector('.diagram-visual').innerHTML = svg;
        figure.querySelector('details').open = false;
      } catch {
        // The original, readable source remains available when a diagram cannot render.
        figure.querySelector('.diagram-visual').remove();
      }
    });
  };
  if (!('IntersectionObserver' in window)) diagrams.forEach(render);
  else {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) {
        observer.unobserve(entry.target);
        render(entry.target, [...diagrams].indexOf(entry.target));
      }
    }, { rootMargin: '400px' });
    diagrams.forEach((figure) => observer.observe(figure));
  }
})();
