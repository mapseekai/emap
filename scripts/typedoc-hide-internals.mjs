import { Application, ReflectionKind } from 'typedoc';

const INTERNAL_MAP_HOST_SOURCE = 'src/map/map.ts';

function isInternalMapHostSurface(reflection) {
  if (typeof reflection.name !== 'string') return false;
  if (!reflection.name.startsWith('_')) return false;
  if (!reflection.kindOf(ReflectionKind.Property | ReflectionKind.Method)) return false;
  return reflection.sources?.some((source) => source.fileName === INTERNAL_MAP_HOST_SOURCE) === true;
}

function collectInternalMapHostSurfaces(reflection, removals) {
  if (isInternalMapHostSurface(reflection)) {
    removals.push(reflection);
    return;
  }

  for (const child of reflection.children ?? []) {
    collectInternalMapHostSurfaces(child, removals);
  }
}

export function load(app) {
  app.on(Application.EVENT_VALIDATE_PROJECT, (project) => {
    const removals = [];
    collectInternalMapHostSurfaces(project, removals);

    for (const reflection of removals) {
      project.removeReflection(reflection);
    }
  });
}
