(() => {
  const video = document.querySelector('#portal-motion');
  if (!video) return;
  video.muted = true;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let visible = false;
  let interacted = false;
  const update = () => {
    if (!visible || document.hidden || motion.matches || navigator.connection?.saveData) {
      video.pause();
    } else if (!interacted) {
      video.play().catch(() => { /* Native controls remain available. */ });
    }
  };
  video.addEventListener('pointerdown', () => { interacted = true; });
  video.addEventListener('keydown', () => { interacted = true; });
  motion.addEventListener('change', update);
  document.addEventListener('visibilitychange', update);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio >= .3;
      update();
    }, { threshold: .3 }).observe(video);
  } else {
    visible = true;
    update();
  }
})();
