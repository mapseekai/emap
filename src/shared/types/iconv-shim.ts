// Minimal shim for iconv-lite to prevent runtime errors in browser
export default {
  encodingExists: () => false,
  decode: (buf: any) => buf.toString(),
  encode: (str: string) => str,
};
