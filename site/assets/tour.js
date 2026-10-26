(() => {
  const image = document.querySelector('#portal-tour');
  const button = document.querySelector('#tour-toggle');
  const status = document.querySelector('#tour-status');
  if (!image || !button) return;
  const poster = image.getAttribute('src');
  const animation = image.dataset.animation;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let playing = false;
  let loading = false;
  let generation = 0;
  let ready;
  button.hidden = false;
  const pause = () => {
    generation++;
    loading = false;
    playing = false;
    image.src = poster;
    button.textContent = 'Play tour';
    button.setAttribute('aria-pressed', 'false');
  };
  const play = async () => {
    const current = ++generation;
    loading = true;
    button.textContent = 'Cancel loading';
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
      loading = false;
      playing = true;
      button.textContent = 'Pause tour';
      button.setAttribute('aria-pressed', 'true');
      status.textContent = '';
    } catch {
      if (current !== generation) return;
      ready = undefined;
      pause();
      status.textContent = 'The tour could not load. You can retry or download the GIF.';
    }
  };
  button.addEventListener('click', () => playing || loading ? pause() : play());
  motion.addEventListener('change', (event) => { if (event.matches) pause(); });
  // Keep the lightweight poster as the initial paint, then load the GIF after the
  // page. Reduced-motion and data-saving preferences require an explicit play.
  if (!motion.matches && !navigator.connection?.saveData) {
    if (document.readyState === 'complete') play();
    else window.addEventListener('load', play, { once: true });
  }
})();
