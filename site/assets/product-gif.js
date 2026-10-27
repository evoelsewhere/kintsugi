(() => {
  const image = document.querySelector('#portal-motion');
  const control = document.querySelector('#motion-toggle');
  if (!image || !control) return;
  const poster = image.getAttribute('src');
  const animation = image.dataset.animation;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let visible = false;
  let userPaused = false;
  let manual = false;
  let playing = false;
  let loading = false;
  let failed = false;
  let generation = 0;
  let ready;
  control.setAttribute('role', 'button');
  const pause = () => {
    generation++;
    playing = loading = false;
    image.src = poster;
    control.setAttribute('aria-pressed', 'false');
    control.setAttribute('aria-label', 'Play product animation');
  };
  const play = async () => {
    if (playing || loading) return;
    const current = ++generation;
    loading = true;
    try {
      ready ??= new Promise((resolve, reject) => {
        const preload = new Image();
        preload.onload = resolve;
        preload.onerror = reject;
        preload.src = animation;
      });
      await ready;
      if (current !== generation) return;
      image.src = animation;
      playing = true;
      loading = false;
      control.setAttribute('aria-pressed', 'true');
      control.setAttribute('aria-label', 'Pause product animation');
    } catch {
      pause();
      failed = true;
      control.removeAttribute('role');
      control.removeAttribute('aria-pressed');
      control.setAttribute('aria-label', 'Open product animation');
    }
  };
  const update = () => {
    if (failed) return;
    if (!visible || document.hidden || userPaused || (!manual && (motion.matches || navigator.connection?.saveData))) pause();
    else play();
  };
  control.addEventListener('click', (event) => {
    if (failed) return;
    event.preventDefault();
    if (playing || loading) { userPaused = true; pause(); }
    else { userPaused = false; manual = true; play(); }
  });
  control.addEventListener('keydown', (event) => {
    if (event.key === ' ' && !failed) { event.preventDefault(); control.click(); }
  });
  motion.addEventListener('change', () => { manual = false; update(); });
  document.addEventListener('visibilitychange', update);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio >= .3;
      update();
    }, { threshold: .3 }).observe(image);
  } else {
    visible = true;
    update();
  }
  pause();
})();
