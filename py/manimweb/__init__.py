"""Run Manim Community Edition without its native dependencies.

`install()` swaps in pure-Python stand-ins for Cairo (a command recorder),
ManimPango (fontTools text layout), LaTeX (pre-rendered MathJax SVG) and the
rest, then `render()` runs a scene and streams every frame's drawing commands
to a sink. In the browser the sink paints them on a canvas and encodes video.
"""
from array import array

_installed = False
TEX_SVG = {}  # "environment|expression" -> SVG markup, rendered by MathJax in the host
MISSING = []  # LaTeX the host still has to render; the scene is re-run once they arrive
IMAGES = []  # image file names the host can draw, in the order it holds their bitmaps
_PLACEHOLDER = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="10pt" height="10pt" viewBox="0 0 10 10">'
    '<path d="M0 0H10V10H0Z"/></svg>'
)


def install():
    global _installed
    if _installed:
        return
    from . import cairo_shim, pango_shim, pathops_shim, stubs

    stubs.install()
    cairo_shim.install()
    pango_shim.install()
    pathops_shim.install()
    import manim  # noqa: F401  (import with shims in place)

    _patch()
    _installed = True


def _patch():
    import manim
    from manim.camera.camera import Camera
    from manim.renderer.cairo_renderer import CairoRenderer
    from manim.utils import tex_file_writing
    from manim.mobject.text import tex_mobject

    from .cairo_shim import REC, IMAGE

    def reset(self):
        REC.ops = []
        if getattr(self, "pixel_array", None) is None:
            self.pixel_array = self.background  # never written to; kept for API shape
        return self

    def set_frame_to_background(self, background):
        reset(self)
        REC.ops = list(background) if isinstance(background, list) else []

    def display_multiple_image_mobjects(self, image_mobjects, pixel_array):
        # The host draws image files itself; Manim's pixel compositing is skipped. An image's
        # opacity (set_opacity, FadeIn) lives in its alpha channel, so compare it with the original.
        for m in image_mobjects:
            src = getattr(m, "_mv_src", None)
            if src not in IMAGES:
                continue
            alpha = 1.0
            pa, orig = getattr(m, "pixel_array", None), getattr(m, "orig_alpha_pixel_array", None)
            if pa is not None and pa.ndim == 3 and pa.shape[2] == 4:
                top = float(orig.max()) if orig is not None and orig.size else 255.0
                alpha = min(1.0, float(pa[:, :, 3].max()) / max(top, 1.0))
            if alpha <= 0:
                continue
            ul, ur, dl = m.points[0], m.points[1], m.points[2]
            REC.ops.extend((IMAGE, IMAGES.index(src), ul[0], ul[1], ur[0], ur[1], dl[0], dl[1], alpha))

    Camera.display_multiple_image_mobjects = display_multiple_image_mobjects
    Camera.reset = reset
    Camera.set_frame_to_background = set_frame_to_background
    # The real get_frame copies the whole pixel buffer; our "frame" is the op list.
    CairoRenderer.get_frame = lambda self: list(REC.ops)

    def tex_to_svg_file(expression, environment=None, tex_template=None):
        import hashlib
        from pathlib import Path

        key = _tex_key(expression, environment)
        svg = TEX_SVG.get(key)
        if svg is None:
            # Keep going with a placeholder so one pass collects every formula.
            if key not in MISSING:
                MISSING.append(key)
            svg = _PLACEHOLDER
        out = Path(manim.config.get_dir("tex_dir"))
        out.mkdir(parents=True, exist_ok=True)
        f = out / (hashlib.sha1(key.encode()).hexdigest()[:16] + ".svg")
        f.write_text(svg)
        return f

    tex_file_writing.tex_to_svg_file = tex_to_svg_file
    tex_mobject.tex_to_svg_file = tex_to_svg_file


def _tex_key(expression, environment):
    return f"{environment or ''}|{expression}"


class _Section:
    skip_animations = False


class WebFileWriter:
    """Replaces SceneFileWriter: hands frames to a sink instead of ffmpeg/PyAV."""

    sink = None

    def __init__(self, renderer, scene_name, **kwargs):
        self.renderer = renderer
        self.sections = [_Section()]
        self.subcaptions = []

    def is_already_cached(self, h):
        return False

    def add_partial_movie_file(self, h):
        pass

    def begin_animation(self, allow_write=False, file_path=None):
        pass

    def end_animation(self, allow_write=False):
        pass

    def write_frame(self, frame, num_frames=1):
        if MISSING:
            return
        cam = self.renderer.camera
        bg = cam.background_color.to_hex() if hasattr(cam.background_color, "to_hex") else str(cam.background_color)
        WebFileWriter.sink("frame", array("f", frame).tobytes(), num_frames, bg)

    def next_section(self, name="", type_=None, skip_animations=False):
        if not MISSING:
            WebFileWriter.sink("section", name, 0, "")

    def add_sound(self, sound_file, time=0, gain=None, **k):
        # The host mixes the audio; it only needs which file starts when.
        if not MISSING:
            import os
            WebFileWriter.sink("sound", os.path.basename(str(sound_file)), float(time), "")

    def add_audio_segment(self, *a, **k):
        pass

    def save_image(self, image):
        pass

    def finish(self):
        pass

    def abort_encode_jobs(self):
        pass

    def print_file_ready_message(self, *a):
        pass


def make_slide_class():
    """A manim-slides compatible `Slide` whose next_slide() marks a pause."""
    from manim import Scene

    class Slide(Scene):
        def next_slide(self, notes="", **kwargs):
            if not MISSING:
                WebFileWriter.sink("slide", str(notes or ""), 0, "")

    return Slide


def render(code, scene_name=None, sink=None, width=1280, height=720, fps=30, tex=None, images=None):
    """Execute `code`, render `scene_name` (or the last Scene subclass) to `sink`.

    sink(kind, payload, n, bg): kind is "frame" (payload = float32 op bytes,
    n = repeat count, bg = background hex), "slide" (payload = notes), "sound"
    (payload = file name, n = start time in seconds) or "section".
    """
    install()
    import types
    import manim
    from manim import Scene, config, tempconfig
    from manim.renderer.cairo_renderer import CairoRenderer

    if tex:
        TEX_SVG.update(tex)
    IMAGES[:] = list(images or [])
    WebFileWriter.sink = sink or (lambda *a: None)
    MISSING.clear()
    from manim.mobject.svg import svg_mobject
    svg_mobject.SVG_HASH_TO_MOB_MAP.clear()  # keyed by file name; placeholders must not stick

    # Make `from manim_slides import Slide` work inside user code.
    ms = types.ModuleType("manim_slides")
    ms.Slide = make_slide_class()
    import sys
    sys.modules["manim_slides"] = ms
    sys.modules["manim_slides.slide"] = ms

    ns = {"__name__": "__manim_scene__"}
    exec(compile(code, "lesson.py", "exec"), ns)
    scenes = [v for v in ns.values() if isinstance(v, type) and issubclass(v, Scene) and v not in (Scene, ms.Slide)
              and v.__module__ == "__manim_scene__"]
    if scene_name:
        scenes = [s for s in scenes if s.__name__ == scene_name]
    if not scenes:
        raise ValueError("No Scene class found in the code")
    cls = scenes[-1]

    with tempconfig({
        "pixel_width": 16, "pixel_height": 9, "frame_rate": fps, "disable_caching": True,
        "write_to_movie": False, "save_last_frame": False, "verbosity": "WARNING", "progress_bar": "none",
        "media_dir": "/tmp/manimweb-media",
    }):
        renderer = CairoRenderer(file_writer_class=WebFileWriter)
        scene = cls(renderer=renderer)
        try:
            scene.render()
        except Exception:
            if not MISSING:
                raise
    if MISSING:
        return {"missing": list(MISSING)}
    return {"scene": cls.__name__}
