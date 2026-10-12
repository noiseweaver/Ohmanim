// Turns the LaTeX that Manim asks for into SVG shaped like dvisvgm's output,
// using MathJax. Manim marks MathTex parts with dvisvgm specials; we map them
// to \cssId so the parts come back as <g id="..."> groups, just like dvisvgm.

export function texSource(expression, environment) {
  let tex = expression
    .replace(/\\special\{dvisvgm:raw <g id='([^']+)'>\}/g, '\\cssId{$1}{')
    .replace(/\\special\{dvisvgm:raw <\/g>\}/g, '}');
  const env = environment || '';
  if (env === 'align*' || env === 'align' || env === 'gather*' || env === 'equation*') return `\\begin{${env}}${tex}\\end{${env}}`;
  if (env === 'center' || env === '') return `\\text{${tex}}`; // Tex(): text mode with inline $math$
  return tex;
}

// adaptor: MathJax.startup.adaptor (browser) or a liteAdaptor (node).
export function texToSVG(MathJax, adaptor, expression, environment) {
  const node = MathJax.tex2svg(texSource(expression, environment), { display: true });
  let svg = adaptor.outerHTML(node);
  svg = svg.slice(svg.indexOf('<svg'), svg.lastIndexOf('</svg>') + 6);
  // MathJax units are 1/1000 em; dvisvgm uses pt with a 10pt font (1 em = 10).
  const vb = /viewBox="([^"]+)"/.exec(svg)[1].split(/\s+/).map(Number);
  const [x, y, w, h] = vb.map((v) => v / 100);
  const inner = svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'))
    .replace(/currentColor/g, '#000000')
    .replace(/ (data-[a-z-]+|aria-[a-z-]+|role|focusable)="[^"]*"/g, '');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${w}pt" height="${h}pt" viewBox="${x} ${y} ${w} ${h}"><g transform="scale(0.01)" stroke-width="0">${inner}</g></svg>`;
}
