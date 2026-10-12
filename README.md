# Manim Visual

Build [Manim](https://www.manim.community/) slideshows for teaching by arranging things on a canvas, with no code. The focus is electronics (circuit symbols, wires, current flow, signal graphs), and it also covers general shapes, text, LaTeX and function plots.

It is a static web app (installable PWA) hosted on GitHub Pages. Everything runs in your browser and lessons autosave locally.

## How it works

Everything runs in the browser, including Manim itself.

1. **Editor and live preview.** Objects are drawn as SVG in Manim's own coordinate system (a 14.2 × 8 frame, y up). Animations are approximated instantly so you can arrange and rehearse.
2. **Real Manim, in a Web Worker.** "Render video" runs unmodified [Manim Community Edition](https://www.manim.community/) under [Pyodide](https://pyodide.org/) (CPython compiled to WebAssembly). Manim's native dependencies are replaced by small pure-Python stand-ins in `py/manimweb/`:
   - **Cairo** becomes a recorder: Manim's camera draws as usual and every path, bezier curve, colour and gradient is replayed on an `OffscreenCanvas` (Canvas 2D has the same drawing model).
   - **Pango** (used by `Text`) becomes [fontTools](https://github.com/fonttools/fonttools) laying out glyphs from the fonts in `fonts/` (18 open families: sans, serif, mono and handwritten), using Pango's metrics so sizes match a normal install. Characters a font lacks fall back to DejaVu Sans.
   - **LaTeX** (used by `MathTex` and `Tex`) becomes [MathJax](https://www.mathjax.org/): the scene runs once to collect every formula, MathJax typesets them on the page, and the scene runs again with SVG shaped like dvisvgm's output. `MathTex` parts, `get_part_by_tex` and colouring by part keep working.
   - **PyAV/ffmpeg** becomes [WebCodecs](https://developer.mozilla.org/docs/Web/API/WebCodecs_API) plus [mp4-muxer](https://github.com/Vanilagy/mp4-muxer), producing an MP4 you can download.
   - **skia-pathops** (used by `Union`, `Intersection`, `Difference`, `Exclusion`) becomes [Shapely](https://shapely.readthedocs.io/) (GEOS), loaded only when a scene uses them. Results are fine polylines rather than exact curves.
   - OpenGL and sound are stubbed; scenes that need them won't render.
3. **Presenting.** After a render, Present plays the Manim video and pauses at every `next_slide()`, like manim-slides. If the slides changed since the last render, it falls back to the live preview.
4. **Code.** The Code button shows the generated script. You can edit it, or paste any Manim scene, and render that instead. The same file also renders on a computer with `manim` or `manim-slides`.

The first render downloads Pyodide, NumPy, SciPy and Manim (about 60 MB); the browser caches them. Rendering needs WebCodecs (current Chrome, Edge, Safari or Firefox).

To render on a computer instead:

```bash
pip install "manim<0.22" manim-slides     # manim-slides does not support manim 0.22 yet
manim-slides render lesson.py RCCircuit
manim-slides RCCircuit                     # present
```

## Authoring model

- **Slides** hold objects. Each object has an **Enter** animation and a **Step**; objects with the same step appear together, and each step is one click.
- **Duplicate slide (⧉)** continues the scene. Objects keep their identity across slides, so anything you move, recolour, resize or change (such as closing a switch) morphs into its new state (`ReplacementTransform`), and anything you delete fades out. "Show previous slide" ghosts what will fade out.
- **Emphasis** plays on an object at its step: Indicate, Circumscribe, Wiggle, Flash, or **Current flow** (a pulse travelling along a wire or component).
- **Wires**: press `W` (or click Wire) and drag between terminals. Component terminals sit on the 0.5 grid so snapping lines them up.
- **Palette**: shapes sit in collapsible categories (Electronics, Shapes, Text, Graphs) split into subsections, with a search box on top.
- **Your own shapes**: select one or more objects (shift-click or drag a box), then **Save as shape**. Pick a category or make a new one; the shape appears under it in the palette, ready to click or drag into any lesson. Saved shapes live in this browser; **Export** / **Import** above the palette moves them between browsers or shares them as a JSON file. **Draw** (`P`) makes a freeform outline: click points, click the first point to close it, `Enter` or double-click to leave it open; drag its corner handles afterwards to reshape it.
- **Groups**: `Ctrl+G` groups the selection into one object that moves, rotates, scales, animates and recolours together; `Ctrl+Shift+G` ungroups. Saved shapes are placed as groups.

Shortcuts: `V` select, `W` wire, `P` draw, `R` / `Shift+R` rotate, `Del` delete, `Ctrl+D` duplicate, `Ctrl+A` select all, `Ctrl+G` / `Ctrl+Shift+G` group / ungroup, arrows nudge (`Shift` for 1 unit), `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+S` save, `F5` present. In the presenter: `→` / `Space` / click next, `←` back, `N` notes, `Esc` exit.

## Files

| Path | What |
| --- | --- |
| `js/components.js` | Object registry: every component's geometry as primitives, plus inspector fields |
| `js/render.js` | Primitives to SVG, morphing, and the slide timeline shared by preview and export |
| `js/player.js` | In-browser animation player used by "Play slide" and the presenter |
| `js/export.js` | Manim / manim-slides Python generator |
| `js/manim/` | In-browser Manim: worker (Pyodide), canvas replay, MP4 encoding, MathJax bridge |
| `py/manimweb/` | Pure-Python stand-ins for Cairo, Pango, LaTeX and Manim's other native dependencies |
| `vendor/` | MathJax 3.2.2 and mp4-muxer 5.2.2 (with licences) |
| `js/app.js` | Editor UI |
| `sw.js`, `manifest.webmanifest` | Offline support and install |

No build step: serve the folder (`python3 -m http.server`) and open it. Pyodide loads from jsDelivr. Pushing to `main` deploys via `.github/workflows/pages.yml`.

Adding a component means adding one `def(...)` in `js/components.js` with its primitives; the palette, preview, morphing and export pick it up automatically.
