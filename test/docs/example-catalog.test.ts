import { describe, expect, it } from 'vitest';
import { examples } from '../../docs-meta/examples';

describe('example catalog metadata', () => {
  it('defines unique, complete runnable example entries', () => {
    const ids = new Set<string>();

    for (const example of examples) {
      expect(ids.has(example.id), `${example.id} is duplicated`).toBe(false);
      ids.add(example.id);

      expect(example.title.zh.trim(), `${example.id} is missing zh title`).not.toBe('');
      expect(example.title.en.trim(), `${example.id} is missing en title`).not.toBe('');
      expect(example.docs, `${example.id} docs`).toHaveLength(1);
      expect(example.api, `${example.id} api`).toHaveLength(1);
      expect(example.success.trim(), `${example.id} success`).not.toBe('');
    }
  });
});
