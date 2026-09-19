/** Deterministic TIFF early-change LZW encoder for test fixtures. */
export function encodeTiffLzw(input: Uint8Array): Uint8Array {
  const dictionary = new Map<string, number>();
  for (let i = 0; i < 256; i++) dictionary.set(String(i), i);
  let nextCode = 258,
    bits = 9,
    currentByte = 0,
    bitCount = 0;
  const output: number[] = [];
  const write = (code: number) => {
    for (let shift = bits - 1; shift >= 0; shift--) {
      currentByte = (currentByte << 1) | ((code >> shift) & 1);
      if (++bitCount === 8) {
        output.push(currentByte);
        currentByte = 0;
        bitCount = 0;
      }
    }
  };
  write(256);
  if (input.length) {
    let sequence = String(input[0]);
    for (let i = 1; i < input.length; i++) {
      const next = `${sequence},${input[i]}`;
      if (dictionary.has(next)) sequence = next;
      else {
        write(dictionary.get(sequence)!);
        if (nextCode <= 4095) {
          dictionary.set(next, nextCode++);
          if (bits < 12 && nextCode >= 1 << bits) bits++;
        }
        sequence = String(input[i]);
      }
    }
    write(dictionary.get(sequence)!);
  }
  write(257);
  if (bitCount) output.push(currentByte << (8 - bitCount));
  return Uint8Array.from(output);
}
