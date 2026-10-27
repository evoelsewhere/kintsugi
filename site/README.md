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

The GIF loops while visible. Clicking it or using Enter/Space switches between the animation and its still poster, without a separate toolbar. Reduced-motion and data-saving preferences require explicit playback; leaving the viewport or hiding the tab restores the poster. A hidden description explains the animation. Without JavaScript, the poster links directly to the GIF. The MP4 remains available as the source for future exports.

## Star video and social card

`scripts/generate-site-media.py` creates the 8-second H.264 MP4, its poster and the 1200×630 social card. It requires Pillow and imageio-ffmpeg. The video is explicitly labeled as an illustrative GitHub interaction and changes no account state. English captions and native video controls are included; playback starts only when the visitor requests it.

## Platform strip

The “Bring your own” strip pairs each platform name with its SVG mark (`assets/platforms/`; sources and license are included there). `assets/platforms.js` adds an inaccessible duplicate of the list for a seamless, left-to-right loop. Hovering, focusing the list, or using its pause button stops the movement. Reduced-motion preferences and browsers without JavaScript show the complete static list instead.

## Verify and publish

The build rejects missing local links and assets. Check desktop and mobile layouts, documentation navigation and search, image links, video playback, canonical metadata and the sitemap. Deployment uses `.github/workflows/deploy-site.yml` and its existing GitHub Pages environment; pushing to `master` or manually running that workflow publishes the generated bundle.
