# The Im-Possible City

Six scroll-driven "overlay text" websites, gathered into one master site.

- `index.html` — master site: live viewer, tiles for every layer, and links to each standalone site.
- `layers/01-skyline` … `layers/06-horizon` — the six layer websites. Each has its own palette and a fixed parallax stage (gradient, blob, grid, vector shapes, noise) with text panels overlaid on top.
- `shared/layer.css`, `shared/layer.js` — shared styles and the scroll engine (parallax, reveal-on-scroll, progress bar, marquee).

## Deployment

`.github/workflows/pages.yml` deploys the whole repo to GitHub Pages on every push to `main` (and the development branch). No build step is needed; the site is plain static HTML.

Live URL once deployed: `https://mrarun005.github.io/The-Im-Possible-City/`
