/**
 * Parser for the ANI animation file format used by Atomic Bomberman.
 *
 * ANI files contain one or more animation frames, each with a name,
 * hotspot, and RLE-compressed 16-bit image data (TGA-style).
 */

export interface ANIFrame {
  name: string;
  width: number;
  height: number;
  hotspotX: number;
  hotspotY: number;
  pixels: Uint8ClampedArray; // RGBA, length = width * height * 4
}

export interface ParsedANI {
  frames: ANIFrame[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readASCII(view: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) {
    s += String.fromCharCode(view.getUint8(offset + i));
  }
  return s;
}

// ---------------------------------------------------------------------------
// Pixel decoding (16-bit ARGB-1555 -> RGBA)
// ---------------------------------------------------------------------------

function decodePixel(low: number, high: number): [number, number, number, number] {
  const r = (high & 0x7c) << 1;
  const g = ((high & 0x03) << 6) | ((low & 0xe0) >> 2);
  const b = (low & 0x1f) << 3;
  const a = (high & 0x80) ? 255 : 0;
  return [r, g, b, a];
}

// ---------------------------------------------------------------------------
// TGA-style RLE decompression
// ---------------------------------------------------------------------------

function decompressRLE(
  view: DataView,
  offset: number,
  compressedSize: number,
  totalPixels: number,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(totalPixels * 4);
  let pixelIndex = 0;
  const end = offset + compressedSize;

  while (offset < end && pixelIndex < totalPixels) {
    const packetHeader = view.getUint8(offset);
    offset += 1;

    const low = view.getUint8(offset);
    const high = view.getUint8(offset + 1);
    offset += 2;

    if (packetHeader & 0x80) {
      // RLE packet — repeat pixel (packetHeader & 0x7F) + 1 times
      const count = (packetHeader & 0x7f) + 1;
      const [r, g, b, a] = decodePixel(low, high);
      for (let i = 0; i < count && pixelIndex < totalPixels; i++) {
        const base = pixelIndex * 4;
        pixels[base] = r;
        pixels[base + 1] = g;
        pixels[base + 2] = b;
        pixels[base + 3] = a;
        pixelIndex++;
      }
    } else {
      // Raw packet — first pixel, then (packetHeader & 0x7F) more pixels
      const additional = packetHeader & 0x7f;
      const [r, g, b, a] = decodePixel(low, high);
      const base = pixelIndex * 4;
      pixels[base] = r;
      pixels[base + 1] = g;
      pixels[base + 2] = b;
      pixels[base + 3] = a;
      pixelIndex++;

      for (let i = 0; i < additional && pixelIndex < totalPixels; i++) {
        const lo = view.getUint8(offset);
        const hi = view.getUint8(offset + 1);
        offset += 2;
        const [pr, pg, pb, pa] = decodePixel(lo, hi);
        const b2 = pixelIndex * 4;
        pixels[b2] = pr;
        pixels[b2 + 1] = pg;
        pixels[b2 + 2] = pb;
        pixels[b2 + 3] = pa;
        pixelIndex++;
      }
    }
  }

  return pixels;
}

// ---------------------------------------------------------------------------
// CIMG chunk parser
// ---------------------------------------------------------------------------

interface CIMGData {
  width: number;
  height: number;
  hotspotX: number;
  hotspotY: number;
  pixels: Uint8ClampedArray;
}

function parseCIMG(view: DataView, offset: number): CIMGData {
  // imageType (2) + unknown (2) + additionalSize (4) + unknown (4)
  // + width (2) + height (2) + hotspotX (2) + hotspotY (2)
  // + keycolorBytes (2) + unknown (2)

  // const imageType = view.getUint16(offset, true);
  offset += 2; // imageType
  offset += 2; // unknown

  const additionalSize = view.getUint32(offset, true);
  offset += 4;

  offset += 4; // unknown

  const width = view.getUint16(offset, true);
  offset += 2;
  const height = view.getUint16(offset, true);
  offset += 2;
  const hotspotX = view.getUint16(offset, true);
  offset += 2;
  const hotspotY = view.getUint16(offset, true);
  offset += 2;
  // const keycolorBytes = view.getUint16(offset, true);
  offset += 2; // keycolorBytes
  offset += 2; // unknown

  // Skip palette data
  const paletteSize = additionalSize - 24;
  offset += paletteSize;

  // Special header (12 bytes)
  offset += 2; // unknown
  offset += 2; // unknown
  const compressedSizePlus12 = view.getUint32(offset, true);
  offset += 4;
  // const uncompressedSize = view.getUint32(offset, true);
  offset += 4; // uncompressedSize

  const compressedSize = compressedSizePlus12 - 12;
  const totalPixels = width * height;

  const pixels = decompressRLE(view, offset, compressedSize, totalPixels);

  return { width, height, hotspotX, hotspotY, pixels };
}

// ---------------------------------------------------------------------------
// Chunk reading helpers
// ---------------------------------------------------------------------------

interface ChunkHeader {
  signature: string;
  payloadLength: number;
  chunkID: number;
}

function readChunkHeader(view: DataView, offset: number): ChunkHeader {
  const signature = readASCII(view, offset, 4);
  const payloadLength = view.getUint32(offset + 4, true);
  const chunkID = view.getUint16(offset + 8, true);
  return { signature, payloadLength, chunkID };
}

const CHUNK_HEADER_SIZE = 10;

// ---------------------------------------------------------------------------
// FRAM chunk parser — reads sub-chunks to build a frame
// ---------------------------------------------------------------------------

function parseFRAM(view: DataView, offset: number, payloadLength: number): ANIFrame {
  const end = offset + payloadLength;
  let name = '';
  let cimg: CIMGData | null = null;

  while (offset < end) {
    const sub = readChunkHeader(view, offset);
    offset += CHUNK_HEADER_SIZE;

    switch (sub.signature) {
      case 'FNAM': {
        const raw = readASCII(view, offset, sub.payloadLength);
        name = raw.trim();
        offset += sub.payloadLength;
        break;
      }
      case 'CIMG': {
        cimg = parseCIMG(view, offset);
        offset += sub.payloadLength;
        break;
      }
      default:
        // HEAD, PAL , or unknown — skip
        offset += sub.payloadLength;
        break;
    }
  }

  if (!cimg) {
    // Frame with no image data — return an empty 1x1 frame
    return {
      name,
      width: 0,
      height: 0,
      hotspotX: 0,
      hotspotY: 0,
      pixels: new Uint8ClampedArray(0),
    };
  }

  return {
    name,
    width: cimg.width,
    height: cimg.height,
    hotspotX: cimg.hotspotX,
    hotspotY: cimg.hotspotY,
    pixels: cimg.pixels,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function parseANI(buffer: ArrayBuffer): ParsedANI {
  const view = new DataView(buffer);

  // --- File header (16 bytes) ---
  const signature = readASCII(view, 0, 10);
  if (signature !== 'CHFILEANI ') {
    throw new Error(
      `Invalid ANI file: expected signature "CHFILEANI ", got "${signature}"`,
    );
  }
  // const fileLength = view.getUint32(10, true);
  // const fileID = view.getUint16(14, true);

  const frames: ANIFrame[] = [];
  let offset = 16; // past the file header

  while (offset < buffer.byteLength) {
    const chunk = readChunkHeader(view, offset);
    offset += CHUNK_HEADER_SIZE;

    switch (chunk.signature) {
      case 'FRAM': {
        const frame = parseFRAM(view, offset, chunk.payloadLength);
        frames.push(frame);
        offset += chunk.payloadLength;
        break;
      }
      default:
        // Skip any top-level chunk we don't care about
        offset += chunk.payloadLength;
        break;
    }
  }

  return { frames };
}
