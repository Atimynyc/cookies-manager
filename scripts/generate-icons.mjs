import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const sizes = [16, 32, 48, 128];

writeFileSync(
  new URL("../assets/logo.svg", import.meta.url),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="Bitten cookie logo">
  <defs>
    <mask id="bite">
      <rect width="128" height="128" fill="#fff"/>
      <circle cx="100" cy="39" r="18" fill="#000"/>
      <circle cx="104" cy="64" r="15" fill="#000"/>
      <circle cx="83" cy="25" r="13" fill="#000"/>
    </mask>
  </defs>
  <g mask="url(#bite)">
    <circle cx="60" cy="67" r="48" fill="#D99A43"/>
    <path fill="#F4C56F" d="M60 20a47 47 0 1 0 0 94 47 47 0 0 0 0-94Zm0 9a38 38 0 1 1 0 76 38 38 0 0 1 0-76Z" opacity=".72"/>
    <circle cx="49" cy="46" r="6" fill="#5A351E"/>
    <circle cx="70" cy="75" r="7" fill="#5A351E"/>
    <circle cx="42" cy="82" r="5" fill="#5A351E"/>
  </g>
</svg>
`
);

for (const size of sizes) {
  writeFileSync(new URL(`../assets/icon-${size}.png`, import.meta.url), createIcon(size));
}

function createIcon(size) {
  const scale = size / 128;
  const pixels = Buffer.alloc(size * size * 4);
  const samples = size <= 32 ? 4 : 3;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = (x + (sx + 0.5) / samples) / scale;
          const py = (y + (sy + 0.5) / samples) / scale;
          const color = colorAt(px, py);
          const alpha = color.a / 255;

          r += color.r * alpha;
          g += color.g * alpha;
          b += color.b * alpha;
          a += alpha;
        }
      }

      const sampleCount = samples * samples;
      const alpha = a / sampleCount;
      const offset = (y * size + x) * 4;

      if (alpha > 0) {
        pixels[offset] = Math.round(r / a);
        pixels[offset + 1] = Math.round(g / a);
        pixels[offset + 2] = Math.round(b / a);
        pixels[offset + 3] = Math.round(alpha * 255);
      }
    }
  }

  return encodePng(size, size, pixels);
}

function colorAt(x, y) {
  const cookieCenter = { x: 60, y: 67 };
  const radius = 48;
  const biteCircles = [
    { x: 100, y: 39, r: 18 },
    { x: 104, y: 64, r: 15 },
    { x: 83, y: 25, r: 13 }
  ];

  const distanceFromCenter = distance(x, y, cookieCenter.x, cookieCenter.y);
  const inCookie = distanceFromCenter <= radius;
  const inBite = biteCircles.some((circle) => distance(x, y, circle.x, circle.y) <= circle.r);

  if (!inCookie || inBite) {
    return transparent();
  }

  const chip = [
    { x: 49, y: 46, r: 6 },
    { x: 70, y: 75, r: 7 },
    { x: 42, y: 82, r: 5 }
  ].find((circle) => distance(x, y, circle.x, circle.y) <= circle.r);

  if (chip) {
    return rgba(90, 53, 30, 255);
  }

  const shade = clamp((y - 25) / 86, 0, 1);
  const edge = clamp((distanceFromCenter - 35) / 13, 0, 1);
  const highlight = distance(x, y, 47, 42) < 32 ? 1 : 0;

  const base = mix(
    { r: 244, g: 197, b: 111 },
    { r: 217, g: 145, b: 60 },
    shade * 0.72 + edge * 0.18
  );

  if (highlight) {
    const amount = clamp((32 - distance(x, y, 47, 42)) / 32, 0, 1) * 0.22;
    return rgba(
      Math.round(mixValue(base.r, 255, amount)),
      Math.round(mixValue(base.g, 219, amount)),
      Math.round(mixValue(base.b, 143, amount)),
      255
    );
  }

  return rgba(base.r, base.g, base.b, 255);
}

function rgba(r, g, b, a) {
  return { r, g, b, a };
}

function transparent() {
  return rgba(0, 0, 0, 0);
}

function distance(x1, y1, x2, y2) {
  return Math.hypot(x1 - x2, y1 - y2);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mix(from, to, amount) {
  return {
    r: Math.round(mixValue(from.r, to.r, amount)),
    g: Math.round(mixValue(from.g, to.g, amount)),
    b: Math.round(mixValue(from.b, to.b, amount))
  };
}

function mixValue(from, to, amount) {
  return from + (to - from) * amount;
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const sourceStart = y * stride;
    const targetStart = y * (stride + 1);
    raw[targetStart] = 0;
    rgba.copy(raw, targetStart + 1, sourceStart, sourceStart + stride);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr(width, height)),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function ihdr(width, height) {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(width, 0);
  buffer.writeUInt32BE(height, 4);
  buffer[8] = 8;
  buffer[9] = 6;
  buffer[10] = 0;
  buffer[11] = 0;
  buffer[12] = 0;
  return buffer;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}
