/** Wrap the package's top-level await for our self-contained classic Worker.
 * The implementation stays intact inside a lazy async factory. No extra assets.
 */
export function lazyLzwDecoder() {
  return {
    name: 'lazy-lzw-decoder',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/@developmentseed/lzw-tiff-decoder/index.mjs'))
        return null;
      const ast = this.parse(code);
      const exported = ast.body.filter((node) => node.type.startsWith('Export'));
      const declaration = exported[0];
      if (
        exported.length !== 1 || declaration.type !== 'ExportNamedDeclaration' ||
        declaration.source || declaration.declaration || declaration.specifiers.length !== 1 ||
        declaration.specifiers[0].exported.name !== 'decompress' ||
        ast.body.some((node) => node.type === 'ImportDeclaration')
      ) this.error('Unexpected lzw-tiff-decoder module shape; review the pinned dependency.');
      const local = declaration.specifiers[0].local.name;
      const body = code.slice(0, declaration.start) + code.slice(declaration.end);
      return {
        code: `let initialized;
export async function decompress(src, capacity) {
  const decode = await (initialized ??= (async () => {
    ${body}
    return ${local};
  })());
  return decode(src, capacity);
}`,
        map: null,
      };
    },
  };
}
