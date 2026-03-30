import { describe, expect, it } from 'vitest';
import { parsePngPixelRecord } from '../../src/pilot/kdenlive-phase12';

describe('kdenlive phase 1/2 pixel record', () => {
  it('parses PNG IHDR metadata and file hash', () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yF9kAAAAASUVORK5CYII=',
      'base64',
    );

    const record = parsePngPixelRecord(png);

    expect(record.format).toBe('png');
    expect(record.width).toBe(1);
    expect(record.height).toBe(1);
    expect(record.bitDepth).toBe(8);
    expect(record.colorType).toBe(4);
    expect(record.fileSizeBytes).toBe(png.length);
    expect(record.sha256).toHaveLength(64);
  });

  it('rejects non-PNG buffers', () => {
    expect(() => parsePngPixelRecord(Buffer.from('not-a-png'))).toThrow(/expected PNG signature/i);
  });
});
