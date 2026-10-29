(() => {
  // Redraws the hero's dot grid on a canvas as a plane seen in perspective: it tilts toward
  // the pointer and the dots under it rise into a soft gold swell. The CSS dots stay as the
  // fallback for reduced motion, touch-only devices and browsers without JavaScript.
  const host = document.querySelector('[data-dot-field]');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const hover = matchMedia('(hover: hover) and (pointer: fine)');
  if (!host || motion.matches || !hover.matches) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'dot-field';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  host.prepend(canvas);
  host.classList.add('has-dot-field');

  const GAP = 24;          // matches .grid-bg background-size
  const OFFSET = 1;        // matches radial-gradient(circle at 1px 1px, ...)
  const FOCAL = 1100;      // perspective distance in CSS pixels
  const LIFT = 120;        // height of the swell under the pointer
  const SPREAD = 150;      // radius of the swell
  const TILT = 0.12;       // maximum plane rotation in radians

  let width = 0, height = 0, dpr = 1;
  let target = { x: 0, y: 0, lift: 0 };
  let state = { x: 0, y: 0, lift: 0, tiltX: 0, tiltY: 0 };
  let frame = 0, visible = true;

  const resize = () => {
    const rect = host.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width; height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    draw();
  };

  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const cx = width / 2, cy = height / 2;
    const sinX = Math.sin(state.tiltX), cosX = Math.cos(state.tiltX);
    const sinY = Math.sin(state.tiltY), cosY = Math.cos(state.tiltY);
    const spread2 = 2 * SPREAD * SPREAD;
    const lifted = [];

    ctx.fillStyle = 'rgba(210,199,171,.7)';
    ctx.beginPath();
    for (let gy = OFFSET; gy < height + GAP; gy += GAP) {
      for (let gx = OFFSET; gx < width + GAP; gx += GAP) {
        const dx = gx - state.x, dy = gy - state.y;
        const h = state.lift * Math.exp(-(dx * dx + dy * dy) / spread2);
        // rotate the point (x, y, z) around the plane's centre, then project it
        const px = gx - cx, py = gy - cy;
        const x1 = px * cosY + h * sinY;
        const z1 = -px * sinY + h * cosY;
        const y2 = py * cosX - z1 * sinX;
        const z2 = py * sinX + z1 * cosX;
        const scale = FOCAL / (FOCAL - z2);
        const sx = cx + x1 * scale, sy = cy + y2 * scale;
        const r = Math.max(0.6, scale * (1 + h / LIFT * 1.4));
        if (h > 6) { lifted.push(sx, sy, r, h / LIFT); continue; }
        ctx.moveTo(sx + r, sy);
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();

    for (let i = 0; i < lifted.length; i += 4) {
      const t = lifted[i + 3];
      ctx.fillStyle = `rgba(${Math.round(210 - 26 * t)},${Math.round(199 - 69 * t)},${Math.round(171 - 129 * t)},${0.7 + 0.3 * t})`;
      ctx.beginPath();
      ctx.arc(lifted[i], lifted[i + 1], lifted[i + 2], 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const tick = () => {
    const ease = 0.12;
    state.x += (target.x - state.x) * ease;
    state.y += (target.y - state.y) * ease;
    state.lift += (target.lift - state.lift) * ease;
    const nx = target.lift ? (target.x / width - 0.5) * 2 : 0;
    const ny = target.lift ? (target.y / height - 0.5) * 2 : 0;
    state.tiltX += (-ny * TILT - state.tiltX) * ease;
    state.tiltY += (nx * TILT - state.tiltY) * ease;
    draw();
    const settled = Math.abs(target.lift - state.lift) < 0.3 && Math.abs(target.x - state.x) < 0.3
      && Math.abs(target.y - state.y) < 0.3 && Math.abs(-ny * TILT - state.tiltX) < 1e-4 && Math.abs(nx * TILT - state.tiltY) < 1e-4;
    frame = settled || !visible ? 0 : requestAnimationFrame(tick);
  };
  const wake = () => { if (!frame && visible && canvas.isConnected) frame = requestAnimationFrame(tick); };

  host.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    const rect = host.getBoundingClientRect();
    target.x = event.clientX - rect.left;
    target.y = event.clientY - rect.top;
    if (!target.lift) { state.x = target.x; state.y = target.y; }
    target.lift = LIFT;
    wake();
  });
  host.addEventListener('pointerleave', () => { target.lift = 0; wake(); });

  new ResizeObserver(resize).observe(host);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) wake(); }).observe(host);
  motion.addEventListener('change', () => { if (motion.matches) { cancelAnimationFrame(frame); canvas.remove(); host.classList.remove('has-dot-field'); } });
})();
