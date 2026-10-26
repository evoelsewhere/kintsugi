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

## Light-theme portal tour

The hero embeds `assets/tour/portal-tour-light.gif`: a 30-second timelapse of 39 actual UI views, captured while navigating the development installation in Light mode. It covers portfolio and Delivery, assessment and the catalog, understanding and rules, design sets, build, every Monitoring tab, gates/audit/telemetry/permissions, projects and member plugins, shared memory, client setup, the plugin library, role management, Guideline and installation settings. Loading time is omitted. It does not start jobs, change project configuration or manufacture successful results.

`assets/tour/chapters.json` records the source, theme and scene timings. Raw captures and an intermediate MP4 stay outside the published bundle. `scripts/encode-portal-tour.py <capture-directory>` rebuilds the GIF and poster from a directory containing `manifest.json` and `frames/NNN.jpg`; it needs Pillow and imageio-ffmpeg. Use the browser tools to capture new views, then review every scene before encoding.

The lightweight poster paints first. The GIF starts after page load, with a Play/Pause button that switches between the GIF and poster. Reduced-motion and data-saving preferences keep the poster until the visitor chooses Play. Without JavaScript the poster, direct GIF download, screenshot link and chapter description remain available.

## Star video and social card

`scripts/generate-site-media.py` creates the 8-second H.264 MP4, its poster and the 1200×630 social card. It requires Pillow and imageio-ffmpeg. The video is explicitly labeled as an illustrative GitHub interaction and changes no account state. English captions and native video controls are included; playback starts only when the visitor requests it.

## Verify and publish

The build rejects missing local links and assets. Check desktop and mobile layouts, documentation navigation and search, image links, video playback, canonical metadata and the sitemap. Deployment uses `.github/workflows/deploy-site.yml` and its existing GitHub Pages environment; pushing to `master` or manually running that workflow publishes the generated bundle.
