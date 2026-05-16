import { describe, expect, it } from 'vitest';
import AdmZipStub from './adm-zip-shim';

describe('adm-zip-shim', () => {
  it('throws an emap-branded error when instantiated', () => {
    expect(() => new (AdmZipStub as any)()).toThrowError(
      /adm-zip is Node-only.*fflate.*unreachable in a browser build/,
    );
  });
});
