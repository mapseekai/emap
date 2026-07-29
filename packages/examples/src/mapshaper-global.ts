type Mapshaper = typeof import('mapshaper').default;

function getLoadedMapshaper(): Mapshaper {
  const mapshaper = (globalThis as { mapshaper?: Mapshaper }).mapshaper;
  if (!mapshaper) {
    throw new Error('The mapshaper vendor bundle must load before optional emap modules are used');
  }
  return mapshaper;
}

const mapshaper = new Proxy({} as Mapshaper, {
  get(_target, property) {
    const loaded = getLoadedMapshaper();
    const value = Reflect.get(loaded, property, loaded) as unknown;
    return typeof value === 'function' ? value.bind(loaded) : value;
  },
});

export default mapshaper;
