#!/usr/bin/env node
// Imports a source logo PNG into the app icon set: auto-crops to the artwork's
// bounding box, squares it with padding, and area-resamples to build/icon.png
// (512, used by electron-builder for the .ico/.icns) plus a 32px tray icon
// whose base64 data URL is printed for embedding in src/main/lib/tray.ts.
//
// Usage: node scripts/import-icon.mjs <source.png>   (default: /tmp/pasted-icon.png)

import zlib from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] ?? '/tmp/pasted-icon.png';

// ---- PNG decode (8-bit RGBA / RGB, non-interlaced) ----
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
      if (colorType !== 6 && colorType !== 2) throw new Error(`unsupported color type ${colorType}`);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  let cur = Buffer.alloc(stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    for (let x = 0; x < stride; x++) {
      const v = raw[rp++];
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let recon;
      if (filter === 0) recon = v;
      else if (filter === 1) recon = v + a;
      else if (filter === 2) recon = v + b;
      else if (filter === 3) recon = v + ((a + b) >> 1);
      else recon = v + paeth(a, b, c);
      cur[x] = recon & 255;
    }
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      const si = x * channels;
      rgba[di] = cur[si];
      rgba[di + 1] = cur[si + 1];
      rgba[di + 2] = cur[si + 2];
      rgba[di + 3] = channels === 4 ? cur[si + 3] : 255;
    }
    prev.set(cur);
    cur = Buffer.alloc(stride);
  }
  return { width, height, rgba };
}

// ---- PNG encode (8-bit RGBA) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(size, rgba) {
  const stride = size * 4 + 1;
  const r = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    r[y * stride] = 0;
    rgba.copy(r, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(r, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- bounding box of the artwork (ignore transparent / near-white backdrop) ----
function contentBounds({ width, height, rgba }) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3];
      const nearWhite = rgba[i] > 238 && rgba[i + 1] > 238 && rgba[i + 2] > 238;
      if (a > 40 && !nearWhite) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

// ---- square crop centered on the content, padded, backdrop-filled ----
function squareCrop(src, bounds, padFrac = 0.1) {
  const w = bounds.maxX - bounds.minX + 1;
  const h = bounds.maxY - bounds.minY + 1;
  const pad = Math.round(Math.max(w, h) * padFrac);
  const side = Math.max(w, h) + pad * 2;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const left = Math.round(cx - side / 2);
  const top = Math.round(cy - side / 2);

  // Fill with the source's corner pixel so out-of-image padding matches the
  // backdrop (transparent stays transparent; white stays white).
  const bg = [src.rgba[0], src.rgba[1], src.rgba[2], src.rgba[3]];
  const out = Buffer.alloc(side * side * 4);
  for (let p = 0; p < side * side; p++) {
    out[p * 4] = bg[0];
    out[p * 4 + 1] = bg[1];
    out[p * 4 + 2] = bg[2];
    out[p * 4 + 3] = bg[3];
  }
  for (let y = 0; y < side; y++) {
    const sy = top + y;
    if (sy < 0 || sy >= src.height) continue;
    for (let x = 0; x < side; x++) {
      const sx = left + x;
      if (sx < 0 || sx >= src.width) continue;
      const di = (y * side + x) * 4;
      const si = (sy * src.width + sx) * 4;
      out.copy(out, di, di, di); // no-op keeps lint calm
      src.rgba.copy(out, di, si, si + 4);
    }
  }
  return { width: side, height: side, rgba: out };
}

// ---- area-averaging resample (premultiplied alpha) ----
function resample(src, dw, dh) {
  const { width: sw, height: sh, rgba } = src;
  const dst = Buffer.alloc(dw * dh * 4);
  const sxs = sw / dw;
  const sys = sh / dh;
  for (let dy = 0; dy < dh; dy++) {
    const fy0 = dy * sys;
    const fy1 = (dy + 1) * sys;
    for (let dx = 0; dx < dw; dx++) {
      const fx0 = dx * sxs;
      const fx1 = (dx + 1) * sxs;
      let r = 0;
      let g = 0;
      let b = 0;
      let aAcc = 0;
      let wsum = 0;
      for (let sy = Math.floor(fy0); sy < Math.ceil(fy1); sy++) {
        const wy = Math.min(fy1, sy + 1) - Math.max(fy0, sy);
        if (wy <= 0) continue;
        for (let sx = Math.floor(fx0); sx < Math.ceil(fx1); sx++) {
          const wx = Math.min(fx1, sx + 1) - Math.max(fx0, sx);
          if (wx <= 0) continue;
          const w = wx * wy;
          const i = (sy * sw + sx) * 4;
          const sa = rgba[i + 3] / 255;
          r += rgba[i] * sa * w;
          g += rgba[i + 1] * sa * w;
          b += rgba[i + 2] * sa * w;
          aAcc += rgba[i + 3] * w;
          wsum += w;
        }
      }
      const di = (dy * dw + dx) * 4;
      if (wsum > 0) {
        const aAvg = aAcc / wsum;
        const af = aAvg / 255;
        if (af > 0) {
          dst[di] = Math.min(255, Math.round(r / wsum / af));
          dst[di + 1] = Math.min(255, Math.round(g / wsum / af));
          dst[di + 2] = Math.min(255, Math.round(b / wsum / af));
        }
        dst[di + 3] = Math.round(aAvg);
      }
    }
  }
  return dst;
}

const src = decodePng(readFileSync(SRC));
const bg = [src.rgba[0], src.rgba[1], src.rgba[2], src.rgba[3]];
const bounds = contentBounds(src);
console.log(`source ${src.width}x${src.height}, corner pixel rgba=[${bg}]`);
console.log(`content bounds x:[${bounds.minX},${bounds.maxX}] y:[${bounds.minY},${bounds.maxY}]`);

const square = squareCrop(src, bounds);
console.log(`square crop ${square.width}x${square.width}`);

mkdirSync(join(ROOT, 'build'), { recursive: true });
writeFileSync(join(ROOT, 'build', 'icon.png'), encodePng(512, resample(square, 512, 512)));
console.log('wrote build/icon.png (512x512)');

const trayPng = encodePng(32, resample(square, 32, 32));
const trayDataUrl = 'data:image/png;base64,' + trayPng.toString('base64');

// Patch the embedded tray icon in place so this script is the single source of
// truth for the icon set.
const trayFile = join(ROOT, 'src', 'main', 'lib', 'tray.ts');
let trayTs = readFileSync(trayFile, 'utf8');
const re = /const TRAY_ICON_DATA_URL =\s*'[^']*';/;
if (!re.test(trayTs)) throw new Error('could not find TRAY_ICON_DATA_URL in tray.ts');
trayTs = trayTs.replace(re, `const TRAY_ICON_DATA_URL =\n  '${trayDataUrl}';`);
writeFileSync(trayFile, trayTs);
console.log('patched src/main/lib/tray.ts tray icon');
