(() => {
  const marquee = document.querySelector('#platform-marquee');
  const track = marquee?.querySelector('.platform-track');
  const list = track?.querySelector('.platform-list');
  const button = document.querySelector('#platform-toggle');
  if (!marquee || !track || !list || !button) return;

  const duplicate = list.cloneNode(true);
  duplicate.setAttribute('aria-hidden', 'true');
  track.append(duplicate);

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = false;
  const update = () => {
    marquee.classList.toggle('is-animated', !motion.matches);
    marquee.dataset.paused = String(paused);
    button.hidden = motion.matches;
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('aria-label', paused ? 'Resume platform animation' : 'Pause platform animation');
  };
  button.addEventListener('click', () => { paused = !paused; update(); });
  motion.addEventListener('change', update);
  update();
})();
