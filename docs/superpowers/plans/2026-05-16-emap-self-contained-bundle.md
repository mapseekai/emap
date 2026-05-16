# Self-Contained Browser Bundle (#8) — Plan A Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` syntax.

**Goal:** Stop routing mapshaper through `@rollup/plugin-commonjs` in the `emap.mjs` build. Ship a sibling ESM mapshaper vendor (`dist/mapshaper-vendor.mjs`) and have `emap.mjs` import it as an external, so `import "@zwishing/emap"` is zero-config and runtime-correct in any browser bundler, structurally eliminating the commonjs-fragility class.

**Architecture:** New ESM vendor output (browser mapshaper + `export default`). The ESM build marks `mapshaper` external and uses Rollup `output.paths` to rewrite the specifier to `./mapshaper-vendor.mjs`. `ignoreDynamicRequires: true` stays everywhere (known runtime-good). Vestigial adm-zip shim/alias removed. Regression test revised: zero requires in `emap.*`, only documented-dead `require("adm-zip")` tolerated in `mapshaper-vendor.*`, plus a behavioral jsdom guard with a valid fixture.

**Tech Stack:** TypeScript 5, Rollup 4, Vitest 1 (jsdom), fflate.

**Branch:** `fix/self-contained-bundle` (already checked out). History so far: `ac3fd9a` adm-zip shim, `81152cc` alias, `56849cf`/`0b79c46` config experiments (ended at known-good `ignoreDynamicRequires: true`), `3cb6794` release-prep WIP (separate), `3bfa1e8` regression test (to be revised).

---

### Task A1: ESM vendor artifact

**Files:**
- Create: `src/vendor/mapshaper-vendor-esm.ts`
- Modify: `rollup.config.mjs` (add a 5th output)

- [ ] **Step 1: Create the ESM vendor entry**

```typescript
// src/vendor/mapshaper-vendor-esm.ts
// ESM sibling of mapshaper-vendor.ts. The IIFE vendor registers
// globalThis.mapshaper for script-tag/worker consumers; this one is a real
// ES module with a default export, imported by dist/emap.mjs (mapshaper is
// marked external there). `import '../shim'` first: idempotent, guarded; it
// also runs via src/index.ts before this module evaluates, kept here so the
// vendor is self-sufficient if imported standalone.
import '../shim';
import mapshaper from 'mapshaper';

export default mapshaper;
```

- [ ] **Step 2: Add the Rollup output** in `rollup.config.mjs`. Add this object to the exported array (after the IIFE vendor block, before the main IIFE block):

```javascript
  // ESM vendor — same browser mapshaper build as the IIFE vendor, but a real
  // ES module with `export default`. Imported by dist/emap.mjs (which marks
  // `mapshaper` external and rewrites the specifier to ./mapshaper-vendor.mjs).
  {
    input: 'src/vendor/mapshaper-vendor-esm.ts',
    external: ['maplibre-gl'],
    output: {
      file: 'dist/mapshaper-vendor.mjs',
      format: 'es',
      sourcemap: shouldWriteSourcemap,
    },
    plugins: commonPlugins(),
  },
```

- [ ] **Step 3: Build and verify the artifact exists and has a default export**

Run: `npm run build && node -e "import('./dist/mapshaper-vendor.mjs').then(m=>console.log('default keys:', Object.keys(m.default).slice(0,5)))"`
Expected: build OK; prints mapshaper API keys (e.g. `internal`, `runCommands`, …) — confirms `export default` works.

- [ ] **Step 4: Commit**

```bash
git add src/vendor/mapshaper-vendor-esm.ts rollup.config.mjs
git commit -m "feat: emit dist/mapshaper-vendor.mjs (ESM mapshaper vendor with default export)"
```

---

### Task A2: Externalize mapshaper in the ESM build

**Files:** Modify `rollup.config.mjs` — the `moduleOutput` (Browser ESM) config block only.

- [ ] **Step 1: Change the ESM block.** Locate the block with the comment `// Browser ESM bundle for Vite/Webpack/Bun consumers.` Replace its `external` and `output` so it reads:

```javascript
  // Browser ESM bundle for Vite/Webpack/Bun consumers. mapshaper is EXTERNAL
  // here and rewritten to the sibling ESM vendor — it must NOT go through
  // @rollup/plugin-commonjs (that path produced the Friction #8 fragility:
  // dead require("adm-zip") and a runtime-throwing iconv-lite helper).
  {
    input: 'src/index.ts',
    external: ['maplibre-gl', 'mapshaper'],
    output: {
      file: moduleOutput,
      format: 'es',
      sourcemap: shouldWriteSourcemap,
      paths: { mapshaper: './mapshaper-vendor.mjs' },
    },
    plugins: commonPlugins(),
  },
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: builds with no errors.

- [ ] **Step 3: Verify emap.mjs is mapshaper-free and imports the sibling**

Run: `grep -c "mapshaper-vendor.mjs" dist/emap.mjs; grep -oE "require\$?1?\(['\"][^'\"]+['\"]\)" dist/emap.mjs | sort -u; echo "requires-exit=$?"; grep -c "mapshaper.internal" dist/emap.mjs || echo "0 inlined mapshaper internals"`
Expected: `dist/emap.mjs` contains `from"./mapshaper-vendor.mjs"` (count ≥1); zero `require(...)` matches (exit 1); no inlined `mapshaper.internal` body (the only references are via the imported binding, not bundled source).

- [ ] **Step 4: Commit**

```bash
git add rollup.config.mjs
git commit -m "fix: externalize mapshaper in ESM build, rewrite to ./mapshaper-vendor.mjs (Plan A)"
```

---

### Task A3: Packaging — ship the sibling

**Files:** Modify `package.json` (`files`, `exports`).

- [ ] **Step 1: Add to `files`.** In the `files` array add the entry `"dist/mapshaper-vendor.mjs"` (place it next to `"dist/mapshaper-vendor.js"`).

- [ ] **Step 2: Add to `exports`.** In the `exports` map add, after the `"./dist/mapshaper-vendor.js"` line:

```json
    "./dist/mapshaper-vendor.mjs": "./dist/mapshaper-vendor.mjs",
```

- [ ] **Step 3: Validate JSON + packed contents**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))" && npm pack --dry-run 2>&1 | grep mapshaper-vendor`
Expected: no JSON error; pack listing includes both `dist/mapshaper-vendor.js` and `dist/mapshaper-vendor.mjs`.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "build: ship dist/mapshaper-vendor.mjs in package files + exports"
```

---

### Task A4: Remove vestigial adm-zip shim + alias

**Files:** Delete `src/types/adm-zip-shim.ts`, `src/types/adm-zip-shim.test.ts`; modify `rollup.config.mjs` (remove the adm-zip alias entry).

Rationale: under `ignoreDynamicRequires: true` + Plan A the adm-zip alias never fires (empirically proven) and the shim is unreferenced. Leaving them is misleading dead config.

- [ ] **Step 1: Remove the alias entry.** In `rollup.config.mjs` `commonPlugins()`, change the alias block back to a single entry:

```javascript
    alias({
      entries: [
        { find: 'iconv-lite', replacement: 'src/types/iconv-shim.ts' }
      ]
    }),
```

(Keep `iconv-lite` — it is load-bearing. Also remove the `nodeResolve({ ... alias: { 'adm-zip': ... } })` sub-key if still present, restoring `nodeResolve({ browser: true, preferBuiltins: false })`.)

- [ ] **Step 2: Delete the shim + its test**

```bash
git rm src/types/adm-zip-shim.ts src/types/adm-zip-shim.test.ts
```

- [ ] **Step 3: Build + confirm no behavioral change**

Run: `npm run build && grep -oE 'require\$?1?\(["'"'"'][^"'"'"']+["'"'"']\)' dist/mapshaper-vendor.mjs | sort -u`
Expected: build OK; the only match is `require("adm-zip")` (unchanged dead code — proving the shim/alias were no-ops).

- [ ] **Step 4: Commit**

```bash
git add rollup.config.mjs
git commit -m "refactor: drop vestigial adm-zip shim + alias (no-op under ignoreDynamicRequires:true + Plan A)"
```

---

### Task A5: Revise the regression test

**Files:** Modify `src/build/bundle-self-contained.test.ts` (created in `3bfa1e8`).

- [ ] **Step 1: Rewrite the test** to the following (jsdom env; zero-tolerance for `emap.*`; only documented-dead `adm-zip` allowed in `mapshaper-vendor.*`; behavioral guard with a VALID GeoJSON fixture; event-bridge wait since `setData` is sync). Use the Vitest-injected `__dirname` and `pathToFileURL` dynamic import (proven necessary in `3bfa1e8`).

```typescript
// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIST = resolve(__dirname, '../../dist');
const STRICT = ['emap.mjs', 'emap.js', 'emap-worker.js'];
const VENDOR = ['mapshaper-vendor.js', 'mapshaper-vendor.mjs'];
const ALL = [...STRICT, ...VENDOR];
const REQUIRE_RE = /require\$?1?\(\s*['"][^'"]+['"]\s*\)/g;

const distPresent = ALL.every((f) => existsSync(resolve(DIST, f)));
const d = distPresent ? describe : describe.skip;

async function loadEmap() {
  return import(/* @vite-ignore */ pathToFileURL(resolve(DIST, 'emap.mjs')).href);
}

// setData is synchronous; success/failure surface via 'data'/'error' events
// (see src/source/topology-source.ts — mirrors the fromBytes static).
function waitForLoad(src: any, input: any): Promise<void> {
  return new Promise((res, rej) => {
    const ok = () => { cleanup(); res(); };
    const bad = (e: any) => { cleanup(); rej(e?.error ?? e); };
    const cleanup = () => { src.off('data', ok); src.off('error', bad); };
    src.on('data', ok); src.on('error', bad);
    src.setData(input);
  });
}

d('shipped bundles are self-contained', () => {
  it.each(STRICT)('%s has zero require(...) calls', (f) => {
    const m = readFileSync(resolve(DIST, f), 'utf8').match(REQUIRE_RE) ?? [];
    expect(m, `unexpected requires in dist/${f}: ${m.join(', ')}`).toEqual([]);
  });

  it.each(VENDOR)('%s has only the documented-dead require("adm-zip")', (f) => {
    const m = readFileSync(resolve(DIST, f), 'utf8').match(REQUIRE_RE) ?? [];
    const others = [...new Set(m)].filter((r) => r !== 'require("adm-zip")');
    expect(others, `unexpected non-adm-zip requires in dist/${f}: ${others.join(', ')}`).toEqual([]);
  });

  it('loads valid GeoJSON with no dynamic-require failure', async () => {
    const { TopologySource } = await loadEmap();
    const geojson =
      '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"id":1},' +
      '"geometry":{"type":"Polygon","coordinates":[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}}]}';
    const src = new TopologySource('t');
    await expect(
      waitForLoad(src, { filename: 't.geojson', content: new TextEncoder().encode(geojson) }),
    ).resolves.toBeUndefined();
  });

  it('a .dbf shapefile ZIP does not cause a dynamic-require crash', async () => {
    const { TopologySource } = await loadEmap();
    const { zipSync, strToU8 } = await import('fflate');
    const zip = zipSync({
      'm.shp': new Uint8Array([0, 0, 39, 10]),
      'm.shx': new Uint8Array([0, 0, 39, 10]),
      'm.dbf': strToU8('dummy'),
    });
    const src = new TopologySource('t2');
    try {
      await waitForLoad(src, { filename: 'm.zip', content: zip });
    } catch (err) {
      expect(String(err)).not.toMatch(/Dynamic require of|Could not dynamically require/);
    }
  });
});
```

- [ ] **Step 2: Build + run**

Run: `npm run build && npx vitest run src/build/bundle-self-contained.test.ts`
Expected: all cases PASS (3 strict static + 2 vendor static + 2 behavioral). If the GeoJSON case fails with `Unknown JSON format`, the fixture or the content type is wrong — fix the fixture (it must be valid GeoJSON mapshaper accepts) until it genuinely loads; do NOT weaken the assertion.

- [ ] **Step 3: Verify graceful skip**

Run: `mv dist /tmp/dist.bak && npx vitest run src/build/bundle-self-contained.test.ts; mv /tmp/dist.bak dist`
Expected: suite skipped, 0 failures; dist restored.

- [ ] **Step 4: Commit**

```bash
git add src/build/bundle-self-contained.test.ts
git commit -m "test: revise self-containment guard for Plan A (strict emap.*, dead-adm-zip vendor allowance, valid fixture)"
```

---

### Task A6: Publish gate + docs

**Files:** Modify `package.json` (`prepublishOnly`), `README.md`, `CHANGELOG.md`.

- [ ] **Step 1: Reorder `prepublishOnly`** so the bundle test sees fresh artifacts:

```json
    "prepublishOnly": "npm run typecheck && npm run build && npm run test:run"
```

- [ ] **Step 2: README bundler section.** Add to `README.md` (near install/usage):

```markdown
## Browser bundlers (Vite / webpack / esbuild / Bun)

`import "@zwishing/emap"` works out of the box — no `resolve.alias`, no
`Buffer` polyfill, no bundler config. mapshaper is shipped as a sibling ES
module (`dist/mapshaper-vendor.mjs`) that `dist/emap.mjs` imports by relative
path; your bundler resolves it automatically from
`node_modules/@zwishing/emap/dist/`.

```ts
import { Emap, TopologySource } from "@zwishing/emap";
import "@zwishing/emap/style.css";
```

The Web Worker is only needed if you opt into off-thread ops via `workerUrl`;
deploy `dist/emap-worker.js` and `dist/mapshaper-vendor.js` as same-directory
static assets then.
```

- [ ] **Step 3: CHANGELOG entry.** Add under the top section of `CHANGELOG.md`:

```markdown
### Fixed

- `import "@zwishing/emap"` is now self-contained in any browser bundler.
  mapshaper is no longer routed through CommonJS in the ESM build (which could
  emit a dead `require("adm-zip")` and a runtime-throwing `iconv-lite` helper);
  it ships as a sibling ES module `dist/mapshaper-vendor.mjs`. Consumers can
  remove any `mapshaper`→browser alias, `Buffer` polyfill, or band-aid tests.
```

- [ ] **Step 4: Verify gate**

Run: `npm run prepublishOnly`
Expected: typecheck → build → full test run, all green (bundle test non-skipped).

- [ ] **Step 5: Commit**

```bash
git add package.json README.md CHANGELOG.md
git commit -m "build: prepublish gate ordering + document zero-config bundler usage"
```

---

### Task A7: Final verification

- [ ] **Step 1: Clean build + full suite**

Run: `npm run typecheck && npm run build && npm run test:run`
Expected: all green.

- [ ] **Step 2: Acceptance greps**

Run:
```bash
grep -c 'from"./mapshaper-vendor.mjs"\|from "./mapshaper-vendor.mjs"' dist/emap.mjs
grep -oE 'require\$?1?\(["'"'"'][^"'"'"']+["'"'"']\)' dist/emap.mjs dist/emap.js dist/emap-worker.js; echo "strict-exit=$?"
```
Expected: emap.mjs imports the sibling (count ≥1); strict bundles have zero requires (exit 1).

- [ ] **Step 3: No public surface drift**

Run: `git diff 3cb6794 -- dist/index.d.ts; node -e "const e=require('./package.json').exports; if(e['.'].import!=='./dist/emap.mjs')process.exit(1)"`
Expected: no `dist/index.d.ts` diff; `.` export still `./dist/emap.mjs`.

---

## Self-Review

**Spec coverage:** §1 ESM vendor → A1. §2 externalize+paths → A2. §3 packaging → A3. §4 remove vestigial adm-zip → A4. §5 revised guardrail → A5. §6 prepublish+docs → A6. Acceptance criteria → A2/A5/A7.

**Placeholder scan:** none — every step has concrete code/commands and expected output.

**Type consistency:** `mapshaper-vendor-esm.ts` default export consumed by A2's `paths` rewrite; `STRICT`/`VENDOR`/`ALL` arrays consistent within A5; `prepublishOnly` final string identical in A6 and spec.

**Risk note:** Rollup `output.paths` rewrites the external `mapshaper` specifier to `./mapshaper-vendor.mjs` for ALL imports of `mapshaper` in `src/index.ts`, `src/adapter/mapshaper-adapter.ts`, `src/map/feature-query.ts`. The IIFE/worker builds still use `external:['mapshaper'] + globals` (unchanged). `import '../shim'` runs in both index.ts (bundled in emap.mjs) and the ESM vendor — shim is idempotent (guarded), benign double-eval. If A2 Step 3 shows mapshaper still inlined, the `external` array is the lever to check first.
