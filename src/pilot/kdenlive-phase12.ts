import * as crypto from 'crypto';
import * as fs from 'fs';

export interface PngPixelRecord {
  format: 'png';
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  compressionMethod: number;
  filterMethod: number;
  interlaceMethod: number;
  fileSizeBytes: number;
  sha256: string;
}

export interface KdenlivePhaseSessionRecord {
  targetApp: 'kdenlive';
  appBinary: string;
  windowTitle: string;
  launchedAt: string;
  layoutRequested: 'fullscreen' | 'maximized';
  monitor: {
    name: string;
    width: number;
    height: number;
    originX: number;
    originY: number;
  };
  windowBounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fullScreenshotPath: string;
  pixelRecordPath: string;
  legacyInputsIgnored: string[];
  phaseGate: {
    currentPhase: 2;
    phase1: 'complete';
    phase2: 'complete';
    phase3: 'blocked_until_confirmation';
  };
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function parsePngPixelRecord(buffer: Buffer): PngPixelRecord {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Unsupported image format: expected PNG signature');
  }
  if (buffer.length < 33) {
    throw new Error('PNG buffer too small to contain IHDR');
  }

  const ihdrLength = buffer.readUInt32BE(8);
  const ihdrType = buffer.subarray(12, 16).toString('ascii');
  if (ihdrLength !== 13 || ihdrType !== 'IHDR') {
    throw new Error('Invalid PNG: missing IHDR chunk');
  }

  return {
    format: 'png',
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer.readUInt8(24),
    colorType: buffer.readUInt8(25),
    compressionMethod: buffer.readUInt8(26),
    filterMethod: buffer.readUInt8(27),
    interlaceMethod: buffer.readUInt8(28),
    fileSizeBytes: buffer.length,
    sha256: sha256(buffer),
  };
}

export function readPngPixelRecord(filePath: string): PngPixelRecord {
  return parsePngPixelRecord(fs.readFileSync(filePath));
}
