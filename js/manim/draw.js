// Replays the drawing commands recorded by py/manimweb/cairo_shim.py onto a
// Canvas 2D context. Works in windows and workers (OffscreenCanvas).
export const FRAME_W = 14.222222222222221, FRAME_H = 8;

// images: bitmaps for op 13, in the order of manimweb.IMAGES; videos: {start, frames} per clip
// for op 14, in the order of manimweb.VIDEOS, where frames[0] is frame `start` of the file.
export function drawOps(ctx, ops, width, height, bg, images = [], videos = []) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = bg || '#000000';
  ctx.fillRect(0, 0, width, height);
  // Same matrix Manim gives Cairo: scene units -> pixels, y up.
  const sx = width / FRAME_W, sy = height / FRAME_H;
  ctx.setTransform(sx, 0, 0, -sy, width / 2, height / 2);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  ctx.beginPath();
  const n = ops.length;
  let i = 0;
  const rgba = (r, g, b, a) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
  while (i < n) {
    switch (ops[i++]) {
      case 1: ctx.moveTo(ops[i], ops[i + 1]); i += 2; break;
      case 2: ctx.bezierCurveTo(ops[i], ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4], ops[i + 5]); i += 6; break;
      case 3: ctx.closePath(); break;
      case 4: ctx.beginPath(); break;
      case 5: { const c = rgba(ops[i], ops[i + 1], ops[i + 2], ops[i + 3]); ctx.fillStyle = c; ctx.strokeStyle = c; i += 4; break; }
      case 6: {
        const g = ctx.createLinearGradient(ops[i], ops[i + 1], ops[i + 2], ops[i + 3]);
        const k = ops[i + 4]; i += 5;
        for (let s = 0; s < k; s++, i += 5) g.addColorStop(Math.min(1, Math.max(0, ops[i])), rgba(ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4]));
        ctx.fillStyle = g; ctx.strokeStyle = g; break;
      }
      case 7: ctx.fill(); break;
      case 8: ctx.stroke(); break;
      case 9: ctx.lineWidth = ops[i++]; break;
      case 10: ctx.lineJoin = ['miter', 'round', 'bevel'][ops[i++]] || 'round'; break;
      case 11: ctx.lineCap = ['butt', 'round', 'square'][ops[i++]] || 'butt'; break;
      case 12: ctx.lineTo(ops[i], ops[i + 1]); i += 2; break;
      case 13: {
        const img = images[ops[i]], [ulx, uly, urx, ury, dlx, dly, a] = [1, 2, 3, 4, 5, 6, 7].map((k) => ops[i + k]);
        i += 8;
        if (!img) break;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.transform((urx - ulx) / img.width, (ury - uly) / img.width, (dlx - ulx) / img.height, (dly - uly) / img.height, ulx, uly);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
        break;
      }
      case 14: {
        const clip = videos[ops[i]], [ulx, uly, urx, ury, dlx, dly, a, f] = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => ops[i + k]);
        i += 9;
        // Past the end a clip holds its last frame.
        const fr = clip?.frames || [], img = fr[Math.max(0, Math.min(fr.length - 1, f - (clip?.start || 0)))];
        if (!img) break;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.transform((urx - ulx) / img.width, (ury - uly) / img.width, (dlx - ulx) / img.height, (dly - uly) / img.height, ulx, uly);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
        break;
      }
      default: return; // corrupt stream
    }
  }
}
