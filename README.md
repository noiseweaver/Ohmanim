# Manim Visual

Build [Manim](https://www.manim.community/) slideshows for teaching by arranging things on a canvas, with no code. The focus is electronics (circuit symbols, wires, current flow, signal graphs), and it also covers general shapes, text, LaTeX and function plots.

It is a static web app (installable PWA) hosted on GitHub Pages. Everything runs in your browser and lessons autosave locally.

## How it works

Manim can't run inside a browser: it needs Cairo, Pango, ffmpeg and (for math) LaTeX, none of which exist in WebAssembly/Pyodide today. So the app has two halves that share the same geometry:

1. **Editor, preview and presenter in the browser.** Objects are drawn as SVG in Manim's own coordinate system (a 14.2 × 8 frame, y up). Animations (Create, FadeIn, Write, Transform, Indicate, current flow and so on) are approximated in the browser so you can rehearse and even present straight from the app.
2. **Export to Manim.** "Export to Manim" writes a self-contained Python script built from the same primitives, so the rendered video matches what you laid out. Choose:
   - **manim-slides** (default): each step becomes a click, ready for `manim-slides present` or a self-contained HTML slideshow.
   - **Plain Scene**: a single video, with a short pause where each click would be.

```bash
pip install "manim<0.22" manim-slides     # manim-slides does not support manim 0.22 yet
manim-slides render lesson.py RCCircuit
manim-slides RCCircuit                     # present
manim-slides convert RCCircuit lesson.html # web slideshow
```

## Authoring model

- **Slides** hold objects. Each object has an **Enter** animation and a **Step**; objects with the same step appear together, and each step is one click.
- **Duplicate slide (⧉)** continues the scene. Objects keep their identity across slides, so anything you move, recolour, resize or change (such as closing a switch) morphs into its new state (`ReplacementTransform`), and anything you delete fades out. "Show previous slide" ghosts what will fade out.
- **Emphasis** plays on an object at its step: Indicate, Circumscribe, Wiggle, Flash, or **Current flow** (a pulse travelling along a wire or component).
- **Wires**: press `W` (or click Wire) and drag between terminals. Component terminals sit on the 0.5 grid so snapping lines them up.

Shortcuts: `V` select, `W` wire, `R` / `Shift+R` rotate, `Del` delete, `Ctrl+D` duplicate, arrows nudge (`Shift` for 1 unit), `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+S` save, `F5` present. In the presenter: `→` / `Space` / click next, `←` back, `N` notes, `Esc` exit.

## Files

| Path | What |
| --- | --- |
| `js/components.js` | Object registry: every component's geometry as primitives, plus inspector fields |
| `js/render.js` | Primitives to SVG, morphing, and the slide timeline shared by preview and export |
| `js/player.js` | In-browser animation player used by "Play slide" and the presenter |
| `js/export.js` | Manim / manim-slides Python generator |
| `js/app.js` | Editor UI |
| `sw.js`, `manifest.webmanifest` | Offline support and install |

No build step: serve the folder (`python3 -m http.server`) and open it. Pushing to `main` deploys via `.github/workflows/pages.yml`.

Adding a component means adding one `def(...)` in `js/components.js` with its primitives; the palette, preview, morphing and export pick it up automatically.
