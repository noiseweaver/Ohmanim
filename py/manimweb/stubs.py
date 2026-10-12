"""Stand-ins for Manim's native dependencies that cannot run in WebAssembly.

Anything here is only touched by features we don't support in the browser
(OpenGL renderer, video encoding with PyAV, boolean path ops). Importing works;
using them raises a clear error.
"""
import sys
import types


class _Missing:
    def __init__(self, name):
        self._name = name

    def __getattr__(self, attr):
        return _Missing(f"{self._name}.{attr}")

    def __call__(self, *a, **k):
        raise RuntimeError(f"{self._name} is not available in the browser build of Manim")

    def __mro_entries__(self, bases):
        return (object,)


def _stub(name, **attrs):
    mod = types.ModuleType(name)
    mod.__dict__.update(attrs)
    mod.__getattr__ = lambda attr, _n=name: _Missing(f"{_n}.{attr}")
    mod.__path__ = []  # allow submodule imports
    sys.modules[name] = mod
    return mod


def install():
    for name in [
        "moderngl", "moderngl_window", "moderngl_window.context", "moderngl_window.context.pyglet",
        "moderngl_window.context.pyglet.window", "moderngl_window.timers", "moderngl_window.timers.clock",
        "av", "av.audio", "av.audio.stream", "av.video", "av.video.stream", "av.container",
        "pathops", "audioop", "pydub", "pydub.utils", "srt", "screeninfo", "watchdog",
        "watchdog.events", "watchdog.observers",
    ]:
        if name not in sys.modules:
            _stub(name)
    if "mapbox_earcut" not in sys.modules:
        _stub("mapbox_earcut", triangulate_float32=_earcut, triangulate_float64=_earcut)


def _earcut(verts, rings):
    raise RuntimeError("earcut triangulation (OpenGL renderer) is not available in the browser")
