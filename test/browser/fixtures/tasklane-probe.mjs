import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Test-only decoder for the pinned tasklane wire protocol. No production instrumentation.
const entry = fileURLToPath(new URL('./packet.js', import.meta.resolve('@mapseekai/tasklane')));
const decoder = buildSync({entryPoints:[entry],bundle:true,format:'iife',globalName:'EmapTasklaneProbe',write:false}).outputFiles[0].text;
export async function installTasklaneProbe(page) {
  await page.addInitScript({content:decoder+'\nglobalThis.EmapTasklaneProbe = EmapTasklaneProbe;'});
}
