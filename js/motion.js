// Small feedback animations (Web Animations API). All of them are skipped when the system asks
// for reduced motion.
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(.2, .9, .3, 1.2)';

// A menu or popover opening: grows from its anchor edge and fades in.
export function pop(el, from = 'top') {
  if (!el || reduced()) return;
  const dy = from === 'bottom' ? 8 : -6;
  el.animate([{ opacity: 0, transform: `translateY(${dy}px) scale(.96)` }, { opacity: 1, transform: 'none' }], { duration: 170, easing: EASE });
}

// Draw the eye to something that just changed.
export function flash(el) {
  if (!el || reduced()) return;
  el.animate([{ boxShadow: '0 0 0 0 color-mix(in srgb, var(--accent) 70%, transparent)', backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)' },
    { boxShadow: '0 0 0 6px transparent', backgroundColor: 'transparent' }], { duration: 650, easing: 'ease-out' });
}

// Something new appearing (an object on the canvas, a slide in the list).
export function appear(el) {
  if (!el || reduced()) return;
  el.animate([{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE });
}

// Animate a list re-render: remember where items were, re-render, then slide each item from its
// old place to its new one (FLIP). Items are matched by their data-key.
export function flip(container, render) {
  if (reduced()) return render();
  const before = new Map([...container.querySelectorAll('[data-key]')].map((el) => [el.dataset.key, el.getBoundingClientRect()]));
  render();
  for (const el of container.querySelectorAll('[data-key]')) {
    const was = before.get(el.dataset.key), now = el.getBoundingClientRect();
    if (!was) { appear(el); continue; }
    const dx = was.left - now.left, dy = was.top - now.top;
    if (dx || dy) el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 280, easing: EASE });
  }
}

// Brief nudge when something can't happen (e.g. deleting the last slide).
export function shake(el) {
  if (!el || reduced()) return;
  el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }], { duration: 300 });
}
