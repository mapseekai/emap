export const MAX_MSDF_BYTES = 32 * 1024 ** 2;

export async function readMsdfBytes(
  stream: ReadableStream<Uint8Array>,
  limit = MAX_MSDF_BYTES,
): Promise<ArrayBuffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error('MSDF resource exceeds byte limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
}

export class MsdfHttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`MSDF resource HTTP ${status}: ${url}`);
  }
}

export async function fetchMsdfResource(
  url: string,
  signal?: AbortSignal,
  limit = MAX_MSDF_BYTES,
): Promise<{ url: string; bytes: ArrayBuffer }> {
  const response = await fetch(url, { signal, credentials: 'same-origin' });
  if (!response.ok) {
    await response.body?.cancel();
    throw new MsdfHttpError(response.status, url);
  }
  if (!response.body) throw new Error('MSDF resource has no response body.');
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body.cancel();
    throw new Error('MSDF resource exceeds byte limit.');
  }
  return { url: response.url || url, bytes: await readMsdfBytes(response.body, limit) };
}

export async function fetchBytes(
  url: string,
  signal?: AbortSignal,
  limit = MAX_MSDF_BYTES,
): Promise<ArrayBuffer> {
  return (await fetchMsdfResource(url, signal, limit)).bytes;
}
