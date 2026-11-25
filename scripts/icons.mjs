// Draws the extension icon at 16/32/48/128px into src/icons/, with no image library.
// The mark: a contact list (avatar + name, three rows) on Facebook blue.
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';

const BLUE = [8, 102, 255];
const WHITE = [255, 255, 255];
const SAMPLES = 4; // 4x4 supersampling for smooth edges

/** Signed distance to a rounded rectangle, on a 128-unit canvas. */
const roundRect = (x0, y0, x1, y1, r) => (x, y) => {
  const qx = Math.abs(x - (x0 + x1) / 2) - ((x1 - x0) / 2 - r);
  const qy = Math.abs(y - (y0 + y1) / 2) - ((y1 - y0) / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;

const tile = roundRect(4, 4, 124, 124, 28);
const marks = [36, 64, 92].flatMap((y, i) => [
  circle(40, y, 10),
  roundRect(58, y - 5, [100, 88, 94][i], y + 5, 5),
]);

function colourAt(x, y) {
  if (tile(x, y) > 0) return null;
  return marks.some((d) => d(x, y) <= 0) ? WHITE : BLUE;
}

function render(size) {
  const px = new Uint8Array(size * size * 4);
  const unit = 128 / size;
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const c = colourAt((pxl + (sx + 0.5) / SAMPLES) * unit, (py + (sy + 0.5) / SAMPLES) * unit);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const i = (py * size + pxl) * 4;
      if (a) [px[i], px[i + 1], px[i + 2]] = [r / a, g / a, b / a];
      px[i + 3] = Math.round((a / SAMPLES ** 2) * 255);
    }
  }
  return png(size, px);
}

// Minimal PNG encoder: RGBA, 8-bit, no filtering.
const CRC = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../src/icons/', import.meta.url);
await mkdir(out, { recursive: true });
for (const size of [16, 32, 48, 128]) await writeFile(new URL(`${size}.png`, out), render(size));
console.log('Icons written to src/icons/');
