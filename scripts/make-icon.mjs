// 由矢量图生成应用图标：build/icon.png 与 build/icon.ico
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const flutes = [0, 1, 2, 3, 4, 5, 6]
  .map((i) => {
    const x = 296 + i * 61.7;
    return `<rect x="${x}" y="220" width="15" height="640" fill="#fff" opacity="0.30"/><rect x="${x + 46}" y="220" width="16" height="640" fill="#170b02" opacity="0.40"/>`;
  })
  .join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#1f2f28"/><stop offset="1" stop-color="#0a100d"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.64" r="0.7">
      <stop offset="0" stop-color="#ffe0a3"/><stop offset="0.42" stop-color="#eba94f"/><stop offset="1" stop-color="#7a3f15"/>
    </radialGradient>
    <radialGradient id="halo" cx="0.5" cy="0.6" r="0.5">
      <stop offset="0" stop-color="#e6a24c" stop-opacity="0.55"/><stop offset="1" stop-color="#e6a24c" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="win"><path d="M296 812V470C296 330 392 226 512 226s216 104 216 244v342Z"/></clipPath>
    <clipPath id="tile"><rect x="64" y="64" width="896" height="896" rx="206"/></clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect x="64" y="64" width="896" height="896" fill="url(#bg)"/>
    <ellipse cx="512" cy="600" rx="470" ry="430" fill="url(#halo)"/>
    <g clip-path="url(#win)"><rect x="296" y="226" width="432" height="586" fill="url(#glow)"/>${flutes}</g>
    <path d="M296 812V470C296 330 392 226 512 226s216 104 216 244v342" fill="none" stroke="#f3ead8" stroke-width="36" stroke-linecap="round"/>
    <path d="M232 818h560" stroke="#f3ead8" stroke-width="44" stroke-linecap="round"/>
  </g>
  <rect x="66" y="66" width="892" height="892" rx="204" fill="none" stroke="#fff" stroke-opacity="0.12" stroke-width="4"/>
</svg>`;

const out = path.resolve('build');
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'icon.svg'), svg);
const png = (size) => sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
await fs.writeFile(path.join(out, 'icon.png'), await png(512));

// ICO 容器：每个尺寸直接内嵌 PNG
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((img, i) => {
  const at = 6 + 16 * i;
  header.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], at);
  header.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], at + 1);
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(img.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += img.length;
});
await fs.writeFile(path.join(out, 'icon.ico'), Buffer.concat([header, ...images]));
console.log('build/icon.png, build/icon.ico');
