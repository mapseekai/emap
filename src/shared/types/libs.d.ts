// parquet-wasm subpath builds — the package's exports map resolves these at
// runtime, but `moduleResolution: "node"` can't see subpath types. Consumed
// only by the formats test helper (esm build + manual wasm init).
declare module 'parquet-wasm/esm';
