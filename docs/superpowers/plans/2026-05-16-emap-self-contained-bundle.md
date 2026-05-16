# Self-Contained Browser Bundle (#8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the last unresolved Node dynamic require (`adm-zip`) from every shipped browser bundle and add a CI guardrail so `import "@zwishing/emap"` works zero-config in any browser bundler and never silently regresses.

**Architecture:** Add a browser stub for `adm-zip` aliased at Rollup build time (identical mechanism to the existing `iconv-lite` → `iconv-shim.ts` alias). Add a Vitest test that statically scans the built bundles for unresolved requires and behaviorally exercises `TopologySource.setData` against GeoJSON + a `.dbf` shapefile ZIP. Reorder `prepublishOnly` so the test runs against fresh artifacts. No public API, `package.json` exports, or `MapshaperAdapter` changes.

**Tech Stack:** TypeScript 5, Rollup 4 (`@rollup/plugin-alias`), Vitest 1, fflate, jsdom.

---

### Task 1: Add the `adm-zip` browser shim

**Files:**
- Create: `src/types/adm-zip-shim.ts`
- Test: `src/types/adm-zip-shim.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/types/adm-zip-shim.test.ts
import { describe, expect, it } from 'vitest';
import AdmZipStub from './adm-zip-shim';

describe('adm-zip-shim', () => {
  it('throws an emap-branded error when instantiated', () => {
    expect(() => new (AdmZipStub as any)()).toThrowError(
      /adm-zip is Node-only.*fflate.*unreachable in a browser build/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/types/adm-zip-shim.test.ts`
Expected: FAIL — `Cannot find module './adm-zip-shim'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/types/adm-zip-shim.ts
// Browser stub for adm-zip. mapshaper's zip path is `qc() ? <fflate> :
// new require('adm-zip')()`; in a browser qc() is truthy so this branch is
// dead. Aliased in at build time (rollup.config.mjs) the same way iconv-lite
// is, purely to remove the unresolved `require("adm-zip")` from the bundle.
// If a future mapshaper change ever reaches it, fail loud and clear instead
// of esbuild's opaque "Dynamic require of …".
class AdmZipBrowserStub {
  constructor() {
    throw new Error(
      'adm-zip is Node-only; the browser ZIP path uses fflate — ' +
        'this code path should be unreachable in a browser build',
    );
  }
}

export default AdmZipBrowserStub;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/types/adm-zip-shim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/adm-zip-shim.ts src/types/adm-zip-shim.test.ts
git commit -m "feat: add browser stub for adm-zip"
```

---

### Task 2: Alias `adm-zip` to the shim in the Rollup build

**Files:**
- Modify: `rollup.config.mjs` (the `alias({ entries: [...] })` call inside `commonPlugins()`)

- [ ] **Step 1: Add the alias entry**

In `rollup.config.mjs`, locate the existing alias block inside `commonPlugins()`:

```javascript
    alias({
      entries: [
        { find: 'iconv-lite', replacement: 'src/types/iconv-shim.ts' }
      ]
    }),
```

Replace it with:

```javascript
    alias({
      entries: [
        { find: 'iconv-lite', replacement: 'src/types/iconv-shim.ts' },
        { find: 'adm-zip', replacement: 'src/types/adm-zip-shim.ts' }
      ]
    }),
```

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build completes with no errors; `dist/emap.mjs`, `dist/emap.js`, `dist/mapshaper-vendor.js`, `dist/emap-worker.js` regenerated.

- [ ] **Step 3: Verify zero unresolved requires (manual gate, automated in Task 3)**

Run: `grep -oE "require\$?1?\(['\"][^'\"]+['\"]\)" dist/emap.mjs dist/emap.js dist/mapshaper-vendor.js dist/emap-worker.js`
Expected: no output (exit code 1, no matches).

- [ ] **Step 4: Commit**

```bash
git add rollup.config.mjs
git commit -m "fix: alias adm-zip to browser stub to remove last Node dynamic require"
```

---

### Task 3: Build self-containment regression test

**Files:**
- Create: `src/build/bundle-self-contained.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// src/build/bundle-self-contained.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIST = resolve(__dirname, '../../dist');
const BUNDLES = ['emap.mjs', 'emap.js', 'mapshaper-vendor.js', 'emap-worker.js'];
const REQUIRE_RE = /require\$?1?\(\s*['"][^'"]+['"]\s*\)/g;

const distPresent = BUNDLES.every((f) => existsSync(resolve(DIST, f)));
const describeIfBuilt = distPresent ? describe : describe.skip;

describeIfBuilt('shipped bundles are self-contained (no Node dynamic requires)', () => {
  it.each(BUNDLES)('%s contains zero unresolved require(...) calls', (file) => {
    const src = readFileSync(resolve(DIST, file), 'utf8');
    const matches = src.match(REQUIRE_RE) ?? [];
    expect(matches, `unexpected Node requires in dist/${file}: ${matches.join(', ')}`).toEqual([]);
  });

  it('TopologySource.setData parses GeoJSON without a Dynamic require error', async () => {
    const { TopologySource } = await import(resolve(DIST, 'emap.mjs'));
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { name: 'a' }, geometry: { type: 'Point', coordinates: [0, 0] } },
      ],
    });
    const src = new TopologySource('t');
    await expect(
      src.setData({ filename: 'x.geojson', content: new TextEncoder().encode(geojson) }),
    ).resolves.not.toThrow();
  });

  it('TopologySource.setData parses a .dbf-bearing shapefile ZIP without a Dynamic require error', async () => {
    const { TopologySource } = await import(resolve(DIST, 'emap.mjs'));
    const { zipSync, strToU8 } = await import('fflate');
    // Minimal valid-ish shapefile triple. The point of this test is the
    // iconv-lite/.dbf decode path: it must not throw "Dynamic require of …".
    // A mapshaper parse error is acceptable; a Dynamic-require crash is not.
    const zip = zipSync({
      'm.shp': new Uint8Array([0, 0, 39, 10]),
      'm.shx': new Uint8Array([0, 0, 39, 10]),
      'm.dbf': strToU8('dummy'),
    });
    const src = new TopologySource('t2');
    try {
      await src.setData({ filename: 'm.zip', content: zip });
    } catch (err) {
      expect(String(err)).not.toMatch(/Dynamic require of/);
    }
  });
});
```

- [ ] **Step 2: Run test against current artifacts**

Run: `npm run build && npx vitest run src/build/bundle-self-contained.test.ts`
Expected: all cases PASS (Task 2 already removed the last require; the `.dbf` case asserts only the absence of a Dynamic-require crash).

- [ ] **Step 3: Verify graceful skip without artifacts**

Run: `rm -rf dist && npx vitest run src/build/bundle-self-contained.test.ts`
Expected: suite SKIPPED (0 failures). Then restore: `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add src/build/bundle-self-contained.test.ts
git commit -m "test: guard browser bundle self-containment against regression"
```

---

### Task 4: Make the regression test a publish gate

**Files:**
- Modify: `package.json:46` (`prepublishOnly` script)

- [ ] **Step 1: Reorder `prepublishOnly` so the test runs against fresh artifacts**

Current:

```json
    "prepublishOnly": "npm run typecheck && npm run test:run && npm run build"
```

Replace with (build before test so `bundle-self-contained.test.ts` sees `dist/`):

```json
    "prepublishOnly": "npm run typecheck && npm run build && npm run test:run"
```

- [ ] **Step 2: Verify the gate end to end**

Run: `npm run prepublishOnly`
Expected: typecheck passes, build produces `dist/`, full test run passes including `bundle-self-contained.test.ts` (now non-skipped).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "build: run test suite after build in prepublishOnly so bundle gate sees dist"
```

---

### Task 5: Documentation — README + CHANGELOG

**Files:**
- Modify: `README.md` (add a bundler section)
- Modify: `CHANGELOG.md` (add a fix entry under the unreleased/next version)

- [ ] **Step 1: Add the README bundler section**

Add this section to `README.md` (place it near existing install/usage content; keep heading level consistent with neighbours):

```markdown
## Browser bundlers (Vite / webpack / esbuild / Bun)

`import "@zwishing/emap"` works out of the box. The published `dist/emap.mjs`
inlines a browser build of mapshaper with **zero** unresolved Node `require`
calls — you do **not** need a `resolve.alias`, a `Buffer` polyfill, or any
bundler configuration.

```ts
import { Emap, TopologySource } from "@zwishing/emap";
import "@zwishing/emap/style.css";
```

The Web Worker is only needed if you opt into off-thread ops via
`workerUrl`. When you do, deploy `dist/emap-worker.js` and
`dist/mapshaper-vendor.js` as static assets in the **same directory** and pass
`workerUrl: '/emap-worker.js'`.
```

- [ ] **Step 2: Add the CHANGELOG entry**

Add under the top (unreleased / next) section of `CHANGELOG.md`:

```markdown
### Fixed

- Removed the last Node-only dynamic `require("adm-zip")` from the shipped
  browser bundles. `import "@zwishing/emap"` is now fully self-contained in any
  browser bundler with no alias, `Buffer` polyfill, or bundler config. A CI
  guardrail (`bundle-self-contained.test.ts`) prevents regressions. Consumers
  that added a `mapshaper`→browser alias, a `Buffer` polyfill, or band-aid
  tests as a workaround can remove them.
```

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document zero-config browser bundler usage; changelog for adm-zip fix"
```

---

### Task 6: Final verification

- [ ] **Step 1: Clean build + full suite**

Run: `npm run typecheck && npm run build && npm run test:run`
Expected: typecheck clean, build clean, all tests pass including the four-bundle static scan and both `TopologySource.setData` behavioral cases.

- [ ] **Step 2: Manual acceptance grep (matches the spec's acceptance criterion)**

Run: `grep -oE "require\$?1?\(['\"][^'\"]+['\"]\)" dist/emap.mjs dist/emap.js dist/mapshaper-vendor.js dist/emap-worker.js; echo "exit=$?"`
Expected: no matches, `exit=1`.

- [ ] **Step 3: Confirm no public surface drift**

Run: `git diff --stat HEAD~6 -- dist/index.d.ts package.json`
Expected: `dist/index.d.ts` unchanged; `package.json` shows only the `prepublishOnly` script reorder (no `exports`/`browser` changes).

---

## Self-Review

**Spec coverage:**
- §1 Build-layer fix → Tasks 1, 2.
- §2 Regression guardrail (static + jsdom behavioral, skips without dist) → Task 3; publish gate → Task 4.
- §3 Trust & documentation (README, CHANGELOG) → Task 5.
- §4 Architecture boundary (no adapter/index/exports changes) → enforced by Task 6 Step 3.
- Acceptance criteria (grep empty; test passes & skips; no d.ts/exports diff; README+CHANGELOG) → Tasks 3, 5, 6.
- Deferred items: explicitly out of scope, no tasks — correct.

**Placeholder scan:** No TBD/TODO; all code blocks complete; commands have expected output.

**Type consistency:** `AdmZipBrowserStub` default export used consistently (Task 1 defines, no other task references its internals). `TopologySource.setData({filename, content})` signature matches the integration report and `src/source/topology-source.ts`. `BUNDLES` array consistent across Task 3 cases. `prepublishOnly` final form consistent between Tasks 4 and referenced in spec.

Note: the `.dbf` ZIP in Task 3 is intentionally minimal — the assertion is strictly "no Dynamic-require crash", not a successful parse, so a mapshaper-level parse rejection does not fail the test (handled by the try/catch asserting only on the error string).
