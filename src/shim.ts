import * as mproj from 'mproj';
import Flatbush from 'flatbush';
import KDBush from 'kdbush';

console.log('[Mapseek] Initializing environment shim...');

if (typeof window !== 'undefined') {
  (window as any).modules = (window as any).modules || {};
  (window as any).modules['mproj'] = mproj;
  (window as any).modules['flatbush'] = Flatbush;
  (window as any).modules['kdbush'] = KDBush;

  console.log('[Mapseek] Shimmed libraries:', Object.keys((window as any).modules));
} else {
  console.log('[Mapseek] Not in window environment, skipping shim.');
}
