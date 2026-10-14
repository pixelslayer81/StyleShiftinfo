# website

A scroll-through, blog-style site about projects, built one page at a time and stitched together at the end. Plain HTML, CSS and JS with no build step.

## Layout

```
index.html          Temporary launcher linking to each page
shared/             reset.css, tokens.css (brand values), fonts/
pages/NN-slug/      One folder per page: index.html, style.css, sketch.js
```

- The two-digit prefix is the scroll order of the final site.
- Each page is self-contained except for `shared/`.
- Each `sketch.js` is a classic script (not an ES module, so pages work from `file://` with no server) that exposes `window.<Name>Sketch = { mount(container), unmount() }` so the final site can host it as one full-viewport section.
- Pages are designed as full-viewport sections (`100vw x 100vh`). The reference frame for layout and screenshots is 1440 x 900.

## Preview

Open any `pages/NN-slug/index.html` directly in a browser, or `index.html` for the list.

PowerShell: `Start-Process pages\02-flock\index.html`
