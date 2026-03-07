import * as mproj from 'mproj';
import Flatbush from 'flatbush';
import KDBush from 'kdbush';

if (typeof window !== 'undefined') {
  const win = window as unknown as Record<string, unknown>;
  win.modules = win.modules || {};
  const modules = win.modules as Record<string, unknown>;
  modules['mproj'] = mproj;
  modules['flatbush'] = Flatbush;
  modules['kdbush'] = KDBush;
}
