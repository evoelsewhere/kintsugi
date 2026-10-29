(() => {
  // Types the hero headline, then cycles through further messages: each is typed, held,
  // erased and replaced. Every message is laid out invisibly in the same grid cell so the
  // heading keeps its tallest height and the page never jumps. Screen readers get the
  // first message once; reduced motion and browsers without JavaScript keep the static text.
  const heading = document.querySelector('[data-typing]');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  if (!heading || motion.matches) return;

  const MESSAGES = [
    ['Modernize the system you have.', 'Keep everything it knows.'],
    ['Read the legacy code you inherited.', 'Get specifications you can review.'],
    ['Design every unit from your templates.', 'Build with the assistants you use.'],
    ['Let AI carry the heavy lifting.', 'Keep people at every gate.'],
    ['Move from monolith to modular.', 'Keep every rule in Git.'],
  ];
  const TYPE = 48, ERASE = 20, BREAK = 260, HOLD = 2800, NEXT = 420;

  const original = heading.textContent.replace(/\s+/g, ' ').trim();
  const make = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  };
  const label = make('span', 'sr-only', original);
  const stack = make('span', 'typing-stack');
  MESSAGES.forEach(([first, second]) => {
    const variant = make('span', '', first + ' ');
    variant.append(make('em', '', second));
    stack.append(variant);
  });
  const live = make('span', 'typing-live');
  const lines = [make('span'), make('em')];
  const caret = make('span', 'caret');
  live.append(lines[0], lines[1]);
  stack.setAttribute('aria-hidden', 'true');
  live.setAttribute('aria-hidden', 'true');
  heading.replaceChildren(label, stack, live);
  heading.classList.add('is-typing');

  let message = 0, line = 0, length = 0, erasing = false, timer = 0, visible = true;
  const render = () => {
    lines.forEach((el, i) => {
      const text = MESSAGES[message][i];
      el.textContent = i < line ? text + (i === 0 ? ' ' : '') : i === line ? text.slice(0, length) : '';
    });
    lines[line].append(caret);
  };
  const step = () => {
    timer = 0;
    if (!visible) return;
    const text = MESSAGES[message][line];
    let delay;
    if (!erasing) {
      if (length < text.length) { length++; delay = TYPE + Math.random() * 40; }
      else if (line === 0) { line = 1; length = 0; delay = BREAK; }
      else { erasing = true; delay = HOLD; }
    } else if (length > 0) { length--; delay = ERASE; }
    else if (line === 1) { line = 0; length = MESSAGES[message][0].length; delay = ERASE; }
    else { erasing = false; message = (message + 1) % MESSAGES.length; delay = NEXT; }
    heading.classList.toggle('is-busy', delay < BREAK);
    render();
    timer = setTimeout(step, delay);
  };

  render();
  timer = setTimeout(step, 600);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !timer) timer = setTimeout(step, NEXT);
  }).observe(heading);
  motion.addEventListener('change', () => {
    if (!motion.matches) return;
    clearTimeout(timer);
    heading.classList.remove('is-typing', 'is-busy');
    heading.replaceChildren(MESSAGES[0][0] + ' ', make('em', '', MESSAGES[0][1]));
  });
})();
