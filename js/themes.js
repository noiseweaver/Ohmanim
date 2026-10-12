// Editor colour themes. Most are the built-in themes from Perun (packages/theme), mapped onto
// this app's colour slots; "Manim" is the original look. Slides keep their own colours.
export const THEMES = [
  {"id": "manim", "name": "Manim", "desc": "Deep slate with Manim blue and green, the original look", "dark": true, "c": {"bg": "#14171d", "panel": "#1b1f27", "panel2": "#232833", "line": "#2e3442", "text": "#e6e8ee", "muted": "#8d94a5", "accent": "#58c4dd", "accent2": "#83c167", "sel": "#ffb000", "danger": "#ff6b6b", "stage": "#0f1217"}},
  {"id": "dark", "name": "Dark", "desc": "Low glare dark theme with muted voltage colors", "dark": true, "c": {"bg": "#191c22", "panel": "#111318", "panel2": "#1d2025", "line": "#44474e", "text": "#e2e2e9", "muted": "#a9acb6", "accent": "#a8c7fa", "accent2": "#98c379", "sel": "#61afef", "danger": "#ffb4ab", "stage": "#191c22"}},
  {"id": "light", "name": "Light", "desc": "Paper white background with deep voltage colors", "dark": false, "c": {"bg": "#fbfbfe", "panel": "#f9f9ff", "panel2": "#ededf4", "line": "#c4c6d0", "text": "#191c20", "muted": "#44474e", "accent": "#415f91", "accent2": "#2e7d32", "sel": "#1565c0", "danger": "#ba1a1a", "stage": "#fbfbfe"}},
  {"id": "classic", "name": "Classic", "desc": "The CircuitJS1 look: black background, green and red voltages, yellow current", "dark": true, "c": {"bg": "#000000", "panel": "#1e1e1e", "panel2": "#2b2b2b", "line": "#4a4a4a", "text": "#f0f0f0", "muted": "#a8a8a8", "accent": "#00b3b3", "accent2": "#00ff00", "sel": "#00ffff", "danger": "#ff5050", "stage": "#000000"}},
  {"id": "high-contrast", "name": "High Contrast", "desc": "Black and white with bright voltage colors, thick lines and large current dots", "dark": true, "c": {"bg": "#000000", "panel": "#000000", "panel2": "#141414", "line": "#ffffff", "text": "#ffffff", "muted": "#e0e0e0", "accent": "#ffd400", "accent2": "#3dff6e", "sel": "#00e5ff", "danger": "#ff6b6b", "stage": "#000000"}},
  {"id": "colorblind-safe", "name": "Colorblind Safe", "desc": "Blue to orange voltages and Okabe-Ito accents on the Dark background", "dark": true, "c": {"bg": "#191c22", "panel": "#111318", "panel2": "#1d2025", "line": "#44474e", "text": "#e2e2e9", "muted": "#a9acb6", "accent": "#56b4e9", "accent2": "#e69f00", "sel": "#cc79a7", "danger": "#f0a35e", "stage": "#191c22"}},
  {"id": "chalkboard", "name": "Chalkboard", "desc": "Slate green with chalky pastel voltages, for teaching on a projector", "dark": true, "c": {"bg": "#2a3a33", "panel": "#1f2c26", "panel2": "#2a3a33", "line": "#4a5e55", "text": "#efede5", "muted": "#b8c2bb", "accent": "#bde8a8", "accent2": "#bde8a8", "sel": "#a6d8f7", "danger": "#f6b0b0", "stage": "#2a3a33"}},
  {"id": "eink", "name": "E-ink", "desc": "Black on white for e-ink screens: grey voltage steps, thick lines, big dots", "dark": false, "c": {"bg": "#ffffff", "panel": "#ffffff", "panel2": "#f2f2f2", "line": "#000000", "text": "#000000", "muted": "#333333", "accent": "#000000", "accent2": "#000000", "sel": "#000000", "danger": "#000000", "stage": "#ffffff"}},
  {"id": "blueprint", "name": "Blueprint", "desc": "Deep blue with white line work on a light cyan grid", "dark": true, "c": {"bg": "#123a6b", "panel": "#0d2c52", "panel2": "#153a68", "line": "#3a6aa5", "text": "#eef4ff", "muted": "#b7c8e4", "accent": "#9fd0ff", "accent2": "#a8f0c4", "sel": "#7fe3ff", "danger": "#ffb3b3", "stage": "#123a6b"}},
  {"id": "phosphor", "name": "Phosphor", "desc": "Green phosphor oscilloscope screen: voltage shows as brightness", "dark": true, "c": {"bg": "#050d07", "panel": "#030a05", "panel2": "#0b1a0f", "line": "#1e4a2a", "text": "#8cffad", "muted": "#62c582", "accent": "#39ff7a", "accent2": "#b8ffcc", "sel": "#d4ff6a", "danger": "#ffc46a", "stage": "#050d07"}},
  {"id": "engineering-paper", "name": "Engineering Paper", "desc": "Cream paper, pencil-grey parts and a faint green grid, for handouts", "dark": false, "c": {"bg": "#f6f3e7", "panel": "#fbf9f1", "panel2": "#efecdf", "line": "#cfcbb8", "text": "#1f1f1a", "muted": "#4d4b40", "accent": "#3a6b45", "accent2": "#2f7a3a", "sel": "#2860a8", "danger": "#a8352a", "stage": "#f6f3e7"}},
  {"id": "nord", "name": "Nord", "desc": "Arctic blue-grey, after the Nord palette", "dark": true, "c": {"bg": "#2e3440", "panel": "#242933", "panel2": "#2e3440", "line": "#4c566a", "text": "#eceff4", "muted": "#a5adbd", "accent": "#88c0d0", "accent2": "#a3be8c", "sel": "#88c0d0", "danger": "#d8848c", "stage": "#2e3440"}},
  {"id": "solarized-dark", "name": "Solarized Dark", "desc": "Deep teal with warm accents, after Solarized", "dark": true, "c": {"bg": "#002b36", "panel": "#00212b", "panel2": "#073642", "line": "#2f5560", "text": "#eee8d5", "muted": "#93a1a1", "accent": "#268bd2", "accent2": "#859900", "sel": "#268bd2", "danger": "#f0625f", "stage": "#002b36"}},
  {"id": "gruvbox-dark", "name": "Gruvbox Dark", "desc": "Warm retro browns and pastels, after Gruvbox", "dark": true, "c": {"bg": "#282828", "panel": "#1d2021", "panel2": "#282828", "line": "#504945", "text": "#ebdbb2", "muted": "#a89984", "accent": "#fabd2f", "accent2": "#b8bb26", "sel": "#83a598", "danger": "#fb4934", "stage": "#282828"}},
  {"id": "adwaita-dark", "name": "Adwaita Dark", "desc": "Neutral greys with GNOME blue, after libadwaita", "dark": true, "c": {"bg": "#1e1e1e", "panel": "#242424", "panel2": "#303030", "line": "#484848", "text": "#ffffff", "muted": "#c0bfbc", "accent": "#78aeed", "accent2": "#8ff0a4", "sel": "#78aeed", "danger": "#ff7b63", "stage": "#1e1e1e"}},
  {"id": "solarized-light", "name": "Solarized Light", "desc": "Warm cream with Solarized accents", "dark": false, "c": {"bg": "#fdf6e3", "panel": "#fdf6e3", "panel2": "#eee8d5", "line": "#d3cbb7", "text": "#073642", "muted": "#586e75", "accent": "#1a6496", "accent2": "#6c7c00", "sel": "#268bd2", "danger": "#b8291f", "stage": "#fdf6e3"}},
  {"id": "dracula", "name": "Dracula", "desc": "Purple-grey with neon accents, after Dracula", "dark": true, "c": {"bg": "#282a36", "panel": "#21222c", "panel2": "#343746", "line": "#44475a", "text": "#f8f8f2", "muted": "#bfbfbf", "accent": "#bd93f9", "accent2": "#50fa7b", "sel": "#bd93f9", "danger": "#ff6e6e", "stage": "#282a36"}},
  {"id": "monokai", "name": "Monokai", "desc": "Olive-black with vivid pinks and greens, after Monokai", "dark": true, "c": {"bg": "#272822", "panel": "#1e1f1c", "panel2": "#34352f", "line": "#49483e", "text": "#f8f8f2", "muted": "#c2c2b0", "accent": "#a6e22e", "accent2": "#a6e22e", "sel": "#66d9ef", "danger": "#ff6188", "stage": "#272822"}},
  {"id": "tokyo-night", "name": "Tokyo Night", "desc": "Deep indigo with soft neon, after Tokyo Night", "dark": true, "c": {"bg": "#1a1b26", "panel": "#16161e", "panel2": "#24283b", "line": "#3b4261", "text": "#c0caf5", "muted": "#a9b1d6", "accent": "#7aa2f7", "accent2": "#9ece6a", "sel": "#7aa2f7", "danger": "#f7768e", "stage": "#1a1b26"}},
  {"id": "catppuccin-mocha", "name": "Catppuccin Mocha", "desc": "Soothing pastels on dark blue-grey, after Catppuccin Mocha", "dark": true, "c": {"bg": "#1e1e2e", "panel": "#181825", "panel2": "#313244", "line": "#45475a", "text": "#cdd6f4", "muted": "#a6adc8", "accent": "#cba6f7", "accent2": "#a6e3a1", "sel": "#89b4fa", "danger": "#f38ba8", "stage": "#1e1e2e"}},
  {"id": "catppuccin-latte", "name": "Catppuccin Latte", "desc": "Soft pastels on warm white, after Catppuccin Latte", "dark": false, "c": {"bg": "#eff1f5", "panel": "#eff1f5", "panel2": "#e6e9ef", "line": "#bcc0cc", "text": "#4c4f69", "muted": "#5c5f77", "accent": "#8839ef", "accent2": "#2f8a1e", "sel": "#1e66f5", "danger": "#d20f39", "stage": "#eff1f5"}},
  {"id": "rose-pine", "name": "Rosé Pine", "desc": "Muted plum with rose and gold, after Rosé Pine", "dark": true, "c": {"bg": "#191724", "panel": "#16141f", "panel2": "#26233a", "line": "#403d52", "text": "#e0def4", "muted": "#908caa", "accent": "#ebbcba", "accent2": "#9ccfd8", "sel": "#c4a7e7", "danger": "#eb6f92", "stage": "#191724"}},
  {"id": "everforest-dark", "name": "Everforest Dark", "desc": "Calm forest greens and warm beige, after Everforest", "dark": true, "c": {"bg": "#2d353b", "panel": "#232a2e", "panel2": "#343f44", "line": "#475258", "text": "#ddd0b4", "muted": "#9da9a0", "accent": "#a7c080", "accent2": "#a7c080", "sel": "#7fbbb3", "danger": "#e67e80", "stage": "#2d353b"}},
  {"id": "obsidian-dark", "name": "Obsidian Dark", "desc": "Charcoal with violet accent, after Obsidian's default dark theme", "dark": true, "c": {"bg": "#1e1e1e", "panel": "#161616", "panel2": "#262626", "line": "#363636", "text": "#dadada", "muted": "#b3b3b3", "accent": "#a882ff", "accent2": "#44cf6e", "sel": "#5d9cff", "danger": "#fb464c", "stage": "#1e1e1e"}},
  {"id": "obsidian-light", "name": "Obsidian Light", "desc": "White with violet accent, after Obsidian's default light theme", "dark": false, "c": {"bg": "#ffffff", "panel": "#ffffff", "panel2": "#f6f6f6", "line": "#e0e0e0", "text": "#222222", "muted": "#5c5c5c", "accent": "#7852ee", "accent2": "#078a3a", "sel": "#086ddd", "danger": "#c8243a", "stage": "#ffffff"}},
  {"id": "kanagawa", "name": "Kanagawa", "desc": "Ink blue with muted woodblock colors, after Kanagawa", "dark": true, "c": {"bg": "#1f1f28", "panel": "#16161d", "panel2": "#2a2a37", "line": "#54546d", "text": "#dcd7ba", "muted": "#c8c093", "accent": "#7e9cd8", "accent2": "#98bb6c", "sel": "#7e9cd8", "danger": "#ff5d62", "stage": "#1f1f28"}},
  {"id": "ayu-dark", "name": "Ayu Dark", "desc": "Near black with warm orange and gold, after Ayu", "dark": true, "c": {"bg": "#0b0e14", "panel": "#0d1017", "panel2": "#131721", "line": "#2d3340", "text": "#bfbdb6", "muted": "#9b9a94", "accent": "#e6b450", "accent2": "#aad94c", "sel": "#59c2ff", "danger": "#f07178", "stage": "#0b0e14"}},
];

export const STYLES = [
  { id: 'studio', name: 'Studio', desc: 'Flat panels, fine borders, compact. Like Keynote or Figma.' },
  { id: 'soft', name: 'Soft', desc: 'Rounded cards, gentle shadows and pill buttons. Like Material 3.' },
  { id: 'glass', name: 'Glass', desc: 'Frosted, see-through panels over a colour wash. Like visionOS or Fluent.' },
  { id: 'technical', name: 'Technical', desc: 'Square corners, monospace labels and drafting lines. Like a blueprint.' },
];

const KEY = 'manimvis.appearance.v1';
export function loadLook() {
  try { return { theme: 'manim', style: 'studio', follow: false, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return { theme: 'manim', style: 'studio', follow: false }; }
}
export function saveLook(look) { try { localStorage.setItem(KEY, JSON.stringify(look)); } catch {} }

// Pick black or white text for a background colour.
function onColor(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#0b0d12' : '#ffffff';
}

export function themeById(id) { return THEMES.find((t) => t.id === id) || THEMES[0]; }

// The theme to show: with "follow system", a dark theme is swapped for its light partner (or back).
export function effectiveTheme(look) {
  let t = themeById(look.theme);
  if (look.follow && window.matchMedia) {
    const wantDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (t.dark !== wantDark) t = themeById(wantDark ? 'dark' : 'light');
  }
  return t;
}

export function applyLook(look) {
  const t = effectiveTheme(look), c = t.c, root = document.documentElement;
  for (const [k, v] of Object.entries(c)) root.style.setProperty('--' + k, v);
  root.style.setProperty('--on-accent', onColor(c.accent));
  root.style.setProperty('--on-danger', onColor(c.danger));
  root.style.colorScheme = t.dark ? 'dark' : 'light';
  root.dataset.style = look.style;
  root.dataset.tone = t.dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', c.panel);
}

// A small picture of the editor in a theme, for the picker.
export function themeSwatch(t) {
  const c = t.c;
  return `<svg viewBox="0 0 120 68" aria-hidden="true"><rect width="120" height="68" fill="${c.panel}"/><rect x="0" y="0" width="120" height="10" fill="${c.panel2}"/>
    <rect x="96" y="3" width="20" height="4" rx="2" fill="${c.accent}"/><rect x="4" y="14" width="18" height="50" rx="2" fill="${c.panel2}"/>
    <rect x="26" y="14" width="66" height="38" rx="2" fill="${c.stage}" stroke="${c.line}" stroke-width=".6"/>
    <circle cx="48" cy="33" r="7" fill="none" stroke="${c.accent}" stroke-width="1.6"/><path d="M60 38 l8 -10 l8 10 z" fill="${c.accent2}"/>
    <rect x="26" y="55" width="66" height="9" rx="2" fill="${c.panel2}"/><rect x="30" y="58" width="16" height="3" rx="1.5" fill="${c.sel}"/>
    <rect x="96" y="14" width="20" height="3" rx="1.5" fill="${c.muted}"/><rect x="96" y="20" width="14" height="3" rx="1.5" fill="${c.text}"/></svg>`;
}
