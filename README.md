# Ohmanim

**Ohmanim** is a visual editor for [Manim](https://www.manim.community/) lessons. You arrange circuits, shapes, text, maths and graphs on a canvas, decide what appears on each click, record a voiceover, and get either a slideshow to present or a narrated MP4. You never write code, but the Manim script is always there if you want it.

It focuses on teaching electronics (circuit symbols, wires, current flow, signal plots) and works just as well for general lessons.

**Open it:** https://noiseweaver.github.io/ohmanim/

## Runs entirely in your browser

There is no server and no account. The editor, the recorder and **real Manim itself** all run on your machine: Manim Community Edition runs under WebAssembly (Pyodide) in a background worker and encodes the video with WebCodecs. Lessons, images and voice clips are saved in your browser (localStorage and IndexedDB). It installs as an app (PWA) and keeps working offline after the first render has cached Python and Manim.

## Features

- **Canvas editor** with electronics parts (resistors, capacitors, sources, switches, transistors, op-amps and more), wires that snap to terminals, shapes, freeform drawing, text in 18 bundled fonts, LaTeX maths and function plots.
- **Slides that animate.** Each object enters on a click you choose. Duplicating a slide continues the scene: anything you move, recolour or change morphs into place, and anything you delete fades out. Emphasis effects include Indicate, Circumscribe, Wiggle, Flash and a current-flow pulse along wires.
- **Timeline** under the canvas: one track per object and one column per click. Drag blocks between clicks, add emphases and group tracks.
- **Voiceover.** Record a clip per click, or narrate a whole take while presenting. Clips pace the slides and are mixed into the rendered video.
- **Captions** for each clip, exported as separate timed WebVTT and SRT files rather than burned into the video.
- **Backgrounds:** colours, gradients, images (fill, fit, stretch or tile), patterns such as graph paper, perfboard and polar grids, and a vignette, plus presets like Blueprint and Oscilloscope. Set one per lesson or per slide.
- **Editing comfort:** zoom and pan, smart guides, align and distribute, typing straight onto the canvas, copy and paste between slides and lessons, undo and redo, and your own reusable shapes.
- **Themes:** 27 editor colour themes and 4 styles, and slide themes that recolour a whole lesson.
- **Present** from the live preview or from the rendered video, with speaker notes.
- **Export** the generated Manim or manim-slides Python, edit it, or paste any Manim scene and render that instead.

## Using it locally

There is no build step. Serve the folder and open it:

```bash
git clone https://github.com/Noiseweaver/ohmanim
cd ohmanim
python3 -m http.server 8000     # then open http://localhost:8000
```

Pyodide and Manim's Python packages are downloaded from jsDelivr and PyPI on the first render (about 60 MB) and cached by the browser.

## Limitations

- **Browser:** rendering needs WebCodecs (current Chrome, Edge, Safari or Firefox). Recording needs microphone access over HTTPS or localhost.
- **Manim features:** 3D scenes and the OpenGL renderer are not supported. Shape boolean operations (`Union`, `Difference` and the like) work, but produce fine polylines instead of exact curves.
- **Speed:** rendering in WebAssembly is slower than on a desktop install, and the first render waits for the download.
- **Storage** lives in this browser. Use Save to keep a lesson file, or to move it to another computer.
- **Captions** are typed by hand; there is no automatic transcription.

## How it works

Everything runs in the browser, including Manim itself.

1. **Editor and live preview.** Objects are drawn as SVG in Manim's own coordinate system (a 14.2 × 8 frame, y up). Animations are approximated instantly so you can arrange and rehearse.
2. **Real Manim, in a Web Worker.** "Render video" runs unmodified [Manim Community Edition](https://www.manim.community/) under [Pyodide](https://pyodide.org/) (CPython compiled to WebAssembly). Manim's native dependencies are replaced by small pure-Python stand-ins in `py/manimweb/`:
   - **Cairo** becomes a recorder: Manim's camera draws as usual and every path, bezier curve, colour and gradient is replayed on an `OffscreenCanvas` (Canvas 2D has the same drawing model).
   - **Pango** (used by `Text`) becomes [fontTools](https://github.com/fonttools/fonttools) laying out glyphs from the fonts in `fonts/` (18 open families: sans, serif, mono and handwritten), using Pango's metrics so sizes match a normal install. Characters a font lacks fall back to DejaVu Sans.
   - **LaTeX** (used by `MathTex` and `Tex`) becomes [MathJax](https://www.mathjax.org/): the scene runs once to collect every formula, MathJax typesets them on the page, and the scene runs again with SVG shaped like dvisvgm's output. `MathTex` parts, `get_part_by_tex` and colouring by part keep working.
   - **PyAV/ffmpeg** becomes [WebCodecs](https://developer.mozilla.org/docs/Web/API/WebCodecs_API) plus [mp4-muxer](https://github.com/Vanilagy/mp4-muxer), producing an MP4 you can download.
   - **skia-pathops** (used by `Union`, `Intersection`, `Difference`, `Exclusion`) becomes [Shapely](https://shapely.readthedocs.io/) (GEOS), loaded only when a scene uses them. Results are fine polylines rather than exact curves.
   - OpenGL is stubbed, so 3D scenes won't render. `add_sound` clips are mixed into the MP4's soundtrack.
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
- **Layout**: slides on the left, the canvas in the middle with the tool dock and the timeline under it, and the inspector on the right. On a phone the canvas comes first and the slides become a strip.
- **Shapes**: the dock under the canvas has a menu per category (Electronics, Shapes, Text, Graphs and any you create), split into subsections, plus a search. **Wire** lives in the Electronics menu since it is for schematics; while it is on, a "Wiring" chip in the dock turns it off.
- **Timeline**: one track per object and one column per click. Blocks show entrances, morphs from the previous slide, emphasis and fade-outs; drag a block to another click, click it to change the animation or move it, and use **+** in a cell to add an emphasis there. An object can have several emphases on different clicks. ▶ on a column plays that click.
- **Your own shapes**: select one or more objects (shift-click or drag a box), then **Save as shape**. Pick a category or make a new one; the shape appears in that category's menu, ready to click or drag into any lesson. Saved shapes live in this browser; **Export** / **Import** in the shape menu moves them between browsers or shares them as a JSON file. **Draw** (`P`) makes a freeform outline: click points, click the first point to close it, `Enter` or double-click to leave it open; drag its corner handles afterwards to reshape it.
- **Theme and style** (palette button, top right): 27 colour themes, most of them Perun's built-ins, and four styles that change the editor's shape and feel: Studio (flat), Soft (rounded with shadows), Glass (frosted panels) and Technical (square, monospace, drafting grid). They only change the editor; slides keep their own colours.
- **Slide theme** (slide inspector): recolours a lesson from any of the same themes, Obsidian style. Text given a style from the Text menu (Title, Heading 1–3, Body, Caption) takes that theme's heading colours, and other colours map to the theme's matching accents.
- **Backgrounds** (slide inspector): solid colours, linear or radial gradients, an image (fill, fit, stretch or tile, with opacity and darkening), a pattern (grid, graph paper, dot grid, perfboard, isometric, polar, ruled, diagonal, crosshatch) and a vignette, plus presets such as Blueprint and Oscilloscope. Set one for the whole lesson or give a slide its own; it cross-fades between slides. The editor grid (grid button in the dock) is separate: it only shows while editing, and snapping follows its spacing.
- **Voiceover**: the timeline's Narration row records a clip for any click (hover a cell, press Record), and Record voiceover presents from the current slide while you talk, cutting a new clip at every click. Each click lasts at least as long as its clip. Narration plays in Play slide and Present, goes into the rendered video's soundtrack, and exports as `self.add_sound` with the WAV files (Download media). Recording needs microphone access; images and clips are stored in the browser's IndexedDB. Click a clip to give it a **caption**: captions are never burned into the video. Rendering in the browser offers them as `.vtt` (WebVTT) and `.srt` files next to the MP4, timed to where each clip plays and split into cues of up to two lines, and the exported Python writes `<Lesson>.vtt` / `.srt` beside itself when Manim renders it.
- **Timeline groups**: shift-click two or more track names and press Group tracks (or Group in timeline in the inspector). A group folds its tracks into one row whose blocks move all their animations together; the objects stay separate on the slide.
- **Editing comfort**: zoom with the dock's − / % / + buttons, `Ctrl`+scroll at the pointer or a pinch; once zoomed in, scroll or hold `Space` (or the middle button) and drag to pan, and click the % to fit the slide again. Dragging shows pink smart guides and snaps to other objects' edges and centres and to the slide's centre and edges (hold `Alt` to move freely). The inspector's Align row lines one object up with the slide, or several with each other, and spaces three or more evenly. Double-click text, maths or a part's label (or press `Enter`) to type on the canvas. `Ctrl+C` / `Ctrl+X` / `Ctrl+V` copy objects between slides and lessons.
- **Groups**: `Ctrl+G` groups the selection into one object that moves, rotates, scales, animates and recolours together; `Ctrl+Shift+G` ungroups. Saved shapes are placed as groups.

Shortcuts: `V` select, `W` wire, `P` draw, `R` / `Shift+R` rotate, `Del` delete, `Ctrl+D` duplicate, `Ctrl+A` select all, `Ctrl+C` / `Ctrl+X` / `Ctrl+V` copy, cut, paste, `Ctrl+=` / `Ctrl+-` / `Ctrl+0` zoom in, out, fit, `Space`+drag pan, `Enter` edit text, `Ctrl+G` / `Ctrl+Shift+G` group / ungroup, arrows nudge (`Shift` for 1 unit), `Ctrl+Z` / `Ctrl+Shift+Z`, `Ctrl+S` save, `F5` present. In the presenter: `→` / `Space` / click next, `←` back, `N` notes, `Esc` exit.

## Files

| Path | What |
| --- | --- |
| `js/components.js` | Object registry: every component's geometry as primitives, plus inspector fields |
| `js/render.js` | Primitives to SVG, morphing, and the slide timeline shared by preview and export |
| `js/player.js` | In-browser animation player used by "Play slide" and the presenter |
| `js/export.js` | Manim / manim-slides Python generator |
| `js/manim/` | In-browser Manim: worker (Pyodide), canvas replay, MP4 encoding, MathJax bridge |
| `py/manimweb/` | Pure-Python stand-ins for Cairo, Pango, LaTeX and Manim's other native dependencies |
| `js/icons.js`, `js/themes.js` | Icon sprite (Lucide), the editor's themes and styles, and slide themes |
| `js/backgrounds.js` | Slide backgrounds: SVG preview and the Manim code that draws them |
| `js/voice.js`, `js/store.js` | Narration recording, playback and WAV export; IndexedDB storage for images and clips |
| `js/motion.js` | Small feedback animations (menus, slide moves, new objects), off under reduced motion |
| `vendor/` | MathJax 3.2.2, KaTeX 0.16.11, mp4-muxer 5.2.2 and Lucide icon licence |
| `js/app.js` | Editor UI |
| `sw.js`, `manifest.webmanifest` | Offline support and install |

Pushing to `main` deploys the site with `.github/workflows/pages.yml` (Settings → Pages → Source: GitHub Actions).

Adding a component means adding one `def(...)` in `js/components.js` with its primitives; the palette, preview, morphing and export pick it up automatically.
