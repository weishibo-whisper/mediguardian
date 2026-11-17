export const MAX_VISION_IMAGE_BYTES = 1_500_000;
export const MAX_VISION_REQUEST_BYTES = 2_200_000;

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('REQUEST_BODY_TOO_LARGE');
  }
}

export async function readLimitedRequestBody(
  request: Request,
  maxBytes = MAX_VISION_REQUEST_BYTES,
): Promise<string> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export function isSupportedImageDataUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) return false;

  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > MAX_VISION_IMAGE_BYTES || bytes.toString('base64') !== match[2]) {
    return false;
  }

  const mime = match[1].toLowerCase();
  if (mime === 'jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}
