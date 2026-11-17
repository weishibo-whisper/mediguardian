import { describe, expect, it } from 'vitest';
import {
  isSupportedImageDataUrl,
  MAX_VISION_IMAGE_BYTES,
  readLimitedRequestBody,
  RequestBodyTooLargeError,
} from '@/lib/vision-input';

describe('vision request input limits', () => {
  it('accepts supported image signatures and rejects mismatched MIME types', () => {
    expect(isSupportedImageDataUrl('data:image/jpeg;base64,/9j/AA==')).toBe(true);
    expect(isSupportedImageDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isSupportedImageDataUrl('data:image/png;base64,/9j/AA==')).toBe(false);
    expect(isSupportedImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
  });

  it('rejects image payloads above the server-side byte limit', () => {
    const image = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_VISION_IMAGE_BYTES)]);
    expect(isSupportedImageDataUrl(`data:image/jpeg;base64,${image.toString('base64')}`)).toBe(false);
  });

  it('bounds streamed request bodies even when content-length is absent', async () => {
    const request = new Request('http://localhost/api/vision', {
      method: 'POST',
      body: 'x'.repeat(1024),
    });
    await expect(readLimitedRequestBody(request, 100)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it('reads valid JSON payloads within the limit', async () => {
    const request = new Request('http://localhost/api/vision', {
      method: 'POST',
      body: JSON.stringify({ image: 'data:image/jpeg;base64,/9j/AA==' }),
    });
    expect(await readLimitedRequestBody(request)).toContain('data:image/jpeg');
  });
});
