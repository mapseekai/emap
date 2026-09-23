import { MsdfFontEngine } from './font-engine';
import type { MsdfRequest, MsdfResponse, ShapedText, GeneratedGlyph } from './protocol';
const scope = globalThis as unknown as {
  location: Location;
  onmessage: (event: MessageEvent<MsdfRequest>) => void;
  postMessage(message: MsdfResponse, transfer?: Transferable[]): void;
};
let engine: Promise<MsdfFontEngine> | null = null;
let tail = Promise.resolve();
const jobs = new Map<number, AbortController>();
scope.onmessage = ({ data }) => {
  if (data.type === 'cancel') {
    jobs.get(data.id)?.abort();
    return;
  }
  const controller = new AbortController();
  jobs.set(data.id, controller);
  tail = tail
    .catch(() => {})
    .then(async () => {
      try {
        controller.signal.throwIfAborted();
        if (!Array.isArray(data.requests) || data.requests.length > 512)
          throw new Error('MSDF request batch exceeds limit.');
        engine ??= MsdfFontEngine.create(new URL('msdf/', scope.location.href).href).catch((e) => {
          engine = null;
          throw e;
        });
        const instance = await engine;
        const result: ShapedText[] | GeneratedGlyph[] = [];
        for (let i = 0; i < data.requests.length; i++) {
          controller.signal.throwIfAborted();
          if (data.type === 'shape')
            (result as ShapedText[]).push(
              await instance.shape(data.requests[i], controller.signal),
            );
          else
            (result as GeneratedGlyph[]).push(
              await instance.glyph(data.requests[i], controller.signal),
            );
          if (i % 8 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        controller.signal.throwIfAborted();
        scope.postMessage(
          { id: data.id, result, stats: instance.stats },
          data.type === 'glyphs'
            ? (result as GeneratedGlyph[]).map((g) => g.data.buffer as ArrayBuffer)
            : [],
        );
      } catch (error) {
        scope.postMessage({
          id: data.id,
          error: controller.signal.aborted
            ? 'Cancelled MSDF job'
            : error instanceof Error
              ? error.message
              : String(error),
        });
      } finally {
        jobs.delete(data.id);
      }
    });
};
