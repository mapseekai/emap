import type {
  CapabilityAuthorizer,
  CapabilityDefinition,
  CapabilityDescriptor,
  CapabilityInvocation,
  CapabilityRegistryContract,
  CapabilityRun,
} from '../services/capabilities';
import { freezeJson, validateCapabilityInput } from './schema';

interface Entry {
  descriptor: CapabilityDescriptor;
  execute: CapabilityDefinition['execute'];
  controller: AbortController;
}

/** Instance-scoped discovery, authorization and execution; never an LLM transport. */
export class CapabilityRegistry implements CapabilityRegistryContract {
  private readonly entries = new Map<string, Entry>();
  private readonly runs: CapabilityRun[] = [];
  private nextRun = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(private readonly authorize?: CapabilityAuthorizer) {}

  register(definition: CapabilityDefinition): () => void {
    if (this.disposed) throw new Error('Capability registry is disposed');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(definition.id))
      throw new Error('Invalid capability id');
    if (this.entries.has(definition.id))
      throw new Error(`Capability already registered: ${definition.id}`);
    const { execute, ...metadata } = definition;
    if (typeof execute !== 'function') throw new TypeError('Capability execute must be a function');
    const descriptor = freezeJson(structuredClone(metadata));
    const entry = { descriptor, execute, controller: new AbortController() };
    this.entries.set(descriptor.id, entry);
    return () => {
      if (this.entries.get(descriptor.id) !== entry) return;
      this.entries.delete(descriptor.id);
      entry.controller.abort(new DOMException('Capability was unloaded', 'AbortError'));
    };
  }

  list(category?: string): readonly CapabilityDescriptor[] {
    return [...this.entries.values()]
      .map((entry) => entry.descriptor)
      .filter((item) => !category || item.category === category);
  }
  get(id: string): CapabilityDescriptor | undefined {
    return this.entries.get(id)?.descriptor;
  }
  search(query: string): readonly CapabilityDescriptor[] {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return this.list()
      .map((item) => {
        const text = [
          item.id,
          item.title,
          item.description,
          ...(item.keywords ?? []),
          ...(item.whenToUse ?? []),
        ]
          .join(' ')
          .toLowerCase();
        return {
          item,
          score: terms.reduce((score, term) => score + Number(text.includes(term)), 0),
        };
      })
      .filter((item) => !terms.length || item.score > 0)
      .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
      .map((item) => item.item);
  }
  history(): readonly CapabilityRun[] {
    return this.runs.map((run) => ({ ...run }));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values())
      entry.controller.abort(new DOMException('Workspace disposed', 'AbortError'));
    this.entries.clear();
  }

  async execute<T = unknown>(
    id: string,
    input: Readonly<Record<string, unknown>> = {},
    invocation: CapabilityInvocation = {},
  ): Promise<T> {
    if (this.disposed) throw new Error('Capability registry is disposed');
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Unknown capability: ${id}`);
    const origin = invocation.origin ?? 'api';
    if (!['api', 'ui', 'agent'].includes(origin)) throw new Error('Invalid capability origin');
    const run: { -readonly [K in keyof CapabilityRun]: CapabilityRun[K] } = {
      runId: ++this.nextRun,
      capabilityId: id,
      origin,
      status: 'running',
      startedAt: Date.now(),
    };
    this.runs.push(run);
    if (this.runs.length > 200) this.runs.shift();
    const controller = new AbortController();
    const releases: Array<() => void> = [];
    for (const signal of [entry.controller.signal, invocation.signal]) {
      if (!signal) continue;
      const abort = () => controller.abort(signal.reason);
      if (signal.aborted) abort();
      else {
        signal.addEventListener('abort', abort, { once: true });
        releases.push(() => signal.removeEventListener('abort', abort));
      }
    }
    const assertActive = () => {
      if (controller.signal.aborted)
        throw controller.signal.reason ?? new DOMException('Capability cancelled', 'AbortError');
      if (this.entries.get(id) !== entry)
        throw new DOMException('Capability was replaced', 'AbortError');
    };
    try {
      assertActive();
      validateCapabilityInput(entry.descriptor.inputSchema, input);
      const args = freezeJson(structuredClone(input));
      const execute = async () => {
        assertActive();
        const allowed = this.authorize
          ? await this.authorize({
              capability: entry.descriptor,
              origin,
              input: args,
            })
          : origin !== 'agent' || entry.descriptor.effects.every((effect) => effect === 'read');
        if (!allowed) throw new Error(`Capability requires host authorization: ${id}`);
        assertActive();
        const result = await entry.execute(args, {
          signal: controller.signal,
          origin,
          assertActive,
        });
        assertActive();
        return result;
      };
      const mutates = entry.descriptor.effects.some((effect) => effect !== 'read');
      const pending = mutates ? this.queue.then(execute, execute) : execute();
      if (mutates) this.queue = pending.catch(() => undefined);
      const result = await pending;
      run.status = 'succeeded';
      return result as T;
    } catch (error) {
      run.status = controller.signal.aborted ? 'cancelled' : 'failed';
      run.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      run.durationMs = Date.now() - run.startedAt;
      for (const release of releases) release();
    }
  }
}
