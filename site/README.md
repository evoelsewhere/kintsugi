# Public landing page and documentation

The existing GitHub Pages site is served at <https://kintsugi.evoelsewhere.asia/>. This is separate from the development installation used to capture the product screenshots.

Run `pnpm site:build` from the repository root. It copies the landing page and assets, renders every `docs/**/*.md` file to HTML, rewrites document links, creates full-text search and a sitemap, and copies the current Compose bundle for download. Mermaid diagrams use the repository's installed renderer, served locally with readable source as a fallback. Output lives in the ignored `.site-dist/` directory. Preview with `python3 -m http.server 4173 --directory .site-dist`.

Edit documentation in `docs/`, never in the generated output. Every rendered page links back to its Markdown source. The Pages workflow rebuilds when source documents, the site, the Compose bundle or the builder change; it can also be run manually on `master`. `SITE_URL` overrides the canonical HTTPS root for another deployment. Update the landing metadata and `CNAME` when changing the public domain.

## Product screenshots

`assets/screenshots/*.jpg` were captured on 26 October 2026 from the authorized development portal at `https://kintsugi.fhmq9.cloud`, with AWS CardDemo data:

| File | View |
|---|---|
| `overview.jpg` | Portfolio overview |
| `catalog.jpg` | Assessment → Catalog |
| `understand.jpg` | AS-IS Understanding → Units & traceability |
| `design.jpg` | Unit Design → Overview |
| `telemetry.jpg` | Governance → Telemetry |

These are development examples, not customer evidence or release certification. Capture the normal rendered UI, wait for loading to finish and inspect screenshots before replacing them. Never capture passwords, tokens or provider settings. The earlier illustrative screens remain under `assets/ui/` and `mock/` for reference; mocks are excluded from the published bundle.

## Star video and social card

`scripts/generate-site-media.py` creates the 8-second H.264 MP4, its poster and the 1200×630 social card. It requires Pillow and imageio-ffmpeg. The video is explicitly labeled as an illustrative GitHub interaction and changes no account state. English captions and native video controls are included; playback starts only when the visitor requests it.

## Verify and publish

The build rejects missing local links and assets. Check desktop and mobile layouts, documentation navigation and search, image links, video playback, canonical metadata and the sitemap. Deployment uses `.github/workflows/deploy-site.yml` and its existing GitHub Pages environment; pushing to `master` or manually running that workflow publishes the generated bundle.
