# Public landing page and documentation

The existing GitHub Pages site is served at <https://kintsugi.evoelsewhere.asia/>. This is separate from the development installation used to capture the product screenshots.

Run `pnpm site:build` from the repository root. It copies the landing page and assets, renders every `docs/**/*.md` file to HTML, rewrites document links, creates full-text search and a sitemap, and copies the current Compose bundle for download. Mermaid diagrams use the repository's installed renderer, served locally with readable source as a fallback. Output lives in the ignored `.site-dist/` directory. Preview with `python3 -m http.server 4173 --directory .site-dist`.

Edit documentation in `docs/`, never in the generated output. Every rendered page links back to its Markdown source. The Pages workflow rebuilds when source documents, the site, the Compose bundle or the builder change; it can also be run manually on `master`. `SITE_URL` overrides the canonical HTTPS root for another deployment. Update the landing metadata and `CNAME` when changing the public domain.

## Product screenshots

`assets/screenshots/*.jpg` were recaptured in **light theme** on 26 October 2026 from the authorized development portal at `https://kintsugi.fhmq9.cloud`, with AWS CardDemo data:

| File | View |
|---|---|
| `overview.jpg` | Portfolio overview |
| `catalog.jpg` | Assessment → Catalog |
| `understand.jpg` | AS-IS Understanding → Units & traceability |
| `design.jpg` | Unit Design → Overview |
| `telemetry.jpg` | Governance → Telemetry |

These are development examples, not customer evidence or release certification. Capture the normal rendered UI, wait for loading to finish and inspect screenshots before replacing them. Never capture passwords, tokens or credential configuration forms. The earlier illustrative screens remain under `assets/ui/` and `mock/` for reference; mocks are excluded from the published bundle.

## Product motion clip

The centered introduction leads into `assets/motion/portal-motion.gif`, exported from the product recording `portal-motion.mp4`. Five continuously recorded scenes show actual scrolling, typing into filters, changing tabs, opening a unit's design and tests, and inspecting runtime telemetry in the Light development portal. The full viewport stays fixed, with no zoom, pan or crop. The website supplies one outer border; the footage has no inset frame. The edit adds a small cursor and subtle click pulses at recorded targets, short captions and crossfades. Recording does not start jobs, change project configuration or manufacture successful results.

`assets/motion/provenance.json` records the source, edit, scene timings and GIF export settings. `scripts/render-portal-motion.py <recordings-directory>` rebuilds the MP4, GIF, poster and English captions from each scene's `capture.json`, timestamped browser frames and recorded click positions; it needs Pillow and imageio-ffmpeg. The GIF uses 15 fps at 1080 pixels wide with a 128-color palette. Raw recordings and intermediate encodes stay outside the published bundle. Use browser tools to record real UI actions, then inspect the footage before editing.

The GIF loops while visible (`assets/product-gif.js`, shared with the Star animation). Clicking it or using Enter/Space switches between the animation and its still poster, without a separate toolbar. Reduced-motion and data-saving preferences require explicit playback; leaving the viewport or hiding the tab restores the poster. A hidden description explains the animation. Without JavaScript, the poster links directly to the GIF. The MP4 remains available as the source for future exports.

## Star animation and social card

`assets/video/github-star.gif` shows the public Kintsugi repository in GitHub's dark theme inside a browser window: the pointer moves to Star while the view pushes in, clicks, and the button changes to Starred with the count going up before the view pulls back out. `scripts/render-github-star.py` draws `scripts/github-star/scene.html` (with Primer Octicons, MIT, license beside it) frame by frame in headless Chromium and writes the GIF and its poster; it needs Playwright and Pillow. The scene is a local rendering of a snapshot of the repository page: nothing is sent to GitHub and no account is used. Refresh the snapshot in the scene (file list, commit, counts) before re-rendering. The GIF uses the same player as the product clip: it loops while visible, and clicking it toggles the poster.

`scripts/generate-site-media.py` creates the 1200×630 social card; it requires Pillow.

## Platform strip

The “Bring your own” strip pairs each platform name with its SVG mark (`assets/platforms/`; sources and license are included there). `assets/platforms.js` adds an inaccessible duplicate of the list for a seamless, left-to-right loop. Hovering, focusing the list, or using its pause button stops the movement. Reduced-motion preferences and browsers without JavaScript show the complete static list instead.

## Hero headline

`assets/hero-typing.js` types the headline and then cycles through the further messages listed at the top of the script: each is typed, held, erased and replaced, with a gold caret. Every message is laid out invisibly in the same place, so the heading keeps the height of the tallest one and the content below never moves. Screen readers get the headline from the HTML once; reduced-motion preferences and browsers without JavaScript show it as static text. Edit the HTML headline and the first message together.

## Hero dot field

`assets/dot-field.js` redraws the hero's dot grid on a canvas at the same positions as the CSS `.grid-bg` pattern. With a mouse over the hero, the plane tilts toward the pointer and the dots under it rise in a soft gold swell, seen in perspective; leaving the hero lets it settle flat, and drawing stops once it is still or scrolled out of view. Reduced-motion preferences, touch-only devices and browsers without JavaScript keep the static CSS dots.

## Verify and publish

The build rejects missing local links and assets. Check desktop and mobile layouts, documentation navigation and search, image links, video playback, canonical metadata and the sitemap. Deployment uses `.github/workflows/deploy-site.yml` and its existing GitHub Pages environment; pushing to `master` or manually running that workflow publishes the generated bundle.
