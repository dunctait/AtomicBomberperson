/**
 * PCX image format parser.
 *
 * Parses 256-color RLE-encoded PCX files and returns RGBA pixel data.
 * Fuchsia (RGB 255, 0, 255) is treated as the transparent color key.
 */

export interface ParsedPCX {
  width: number;
  height: number;
  pixels: Uint8ClampedArray; // RGBA pixel data, length = width * height * 4
}

const PCX_IDENTIFIER = 0x0a;
const PCX_RLE_ENCODING = 1;
const HEADER_SIZE = 128;
const PALETTE_SIZE = 768; // 256 colors * 3 bytes (RGB)

// Transparency color key: fuchsia
const TRANSPARENT_R = 255;
const TRANSPARENT_G = 0;
const TRANSPARENT_B = 255;

export function parsePCX(buffer: ArrayBuffer): ParsedPCX {
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);

  if (data.length < HEADER_SIZE + PALETTE_SIZE) {
    throw new Error('PCX file is too small to contain a valid header and palette');
  }

  // --- Parse header ---
  const identifier = data[0];
  if (identifier !== PCX_IDENTIFIER) {
    throw new Error(`Invalid PCX identifier: expected 0x0A, got 0x${identifier.toString(16).toUpperCase()}`);
  }

  const encoding = data[2];
  if (encoding !== PCX_RLE_ENCODING) {
    throw new Error(`Unsupported PCX encoding: expected 1 (RLE), got ${encoding}`);
  }

  const bitsPerPixel = data[3];
  const xStart = view.getUint16(4, true);
  const yStart = view.getUint16(6, true);
  const xEnd = view.getUint16(8, true);
  const yEnd = view.getUint16(10, true);
  const numBitPlanes = data[65];
  const bytesPerLine = view.getUint16(66, true);

  const width = xEnd - xStart + 1;
  const height = yEnd - yStart + 1;

  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid PCX dimensions: ${width}x${height}`);
  }

  if (bitsPerPixel !== 8 || numBitPlanes !== 1) {
    throw new Error(
      `Only 256-color PCX files are supported (8 bpp, 1 plane). ` +
      `Got ${bitsPerPixel} bpp, ${numBitPlanes} planes.`,
    );
  }

  // --- Read the 256-color palette from end of file ---
  const paletteOffset = data.length - PALETTE_SIZE;
  const palette = new Uint8Array(PALETTE_SIZE);
  for (let i = 0; i < PALETTE_SIZE; i++) {
    palette[i] = data[paletteOffset + i];
  }

  // --- RLE decompress pixel data ---
  const totalBytesPerScanline = bytesPerLine * numBitPlanes;
  const decodedScanlines = new Uint8Array(totalBytesPerScanline * height);
  let srcPos = HEADER_SIZE;
  let dstPos = 0;
  const totalDecodeBytes = totalBytesPerScanline * height;

  while (dstPos < totalDecodeBytes && srcPos < paletteOffset) {
    const byte = data[srcPos++];
    if ((byte & 0xc0) === 0xc0) {
      // RLE run
      const count = byte & 0x3f;
      const value = data[srcPos++];
      for (let i = 0; i < count && dstPos < totalDecodeBytes; i++) {
        decodedScanlines[dstPos++] = value;
      }
    } else {
      // Literal value
      decodedScanlines[dstPos++] = byte;
    }
  }

  // --- Convert to RGBA ---
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    const scanlineOffset = y * totalBytesPerScanline;
    for (let x = 0; x < width; x++) {
      const paletteIndex = decodedScanlines[scanlineOffset + x];
      const r = palette[paletteIndex * 3];
      const g = palette[paletteIndex * 3 + 1];
      const b = palette[paletteIndex * 3 + 2];

      const pixelOffset = (y * width + x) * 4;
      pixels[pixelOffset] = r;
      pixels[pixelOffset + 1] = g;
      pixels[pixelOffset + 2] = b;

      // Fuchsia = transparent
      if (r === TRANSPARENT_R && g === TRANSPARENT_G && b === TRANSPARENT_B) {
        pixels[pixelOffset + 3] = 0;
      } else {
        pixels[pixelOffset + 3] = 255;
      }
    }
  }

  return { width, height, pixels };
}
