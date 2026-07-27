import { Application, ReflectionKind } from 'typedoc';

const INTERNAL_MAP_HOST_SOURCE = 'src/map/map.ts';
const INTERNAL_HOST_SURFACE_NAMES = [
  '_activeTransaction',
  '_allowExpressionEvaluation',
  '_clearSpatialIndexesForSources',
  '_fireHistoryChange',
  '_fireSelectionChange',
  '_history',
  '_invalidateShapeCachesForSources',
  '_removed',
  '_resolveLayer',
  '_scheduleRender',
  '_selection',
  '_sources',
  '_validators',
  '_workerMode',
  '_workerPool',
  '_workerRouting',
  '_workerThreshold',
];
const INTERNAL_HOST_SURFACE_PATTERN = new RegExp(
  INTERNAL_HOST_SURFACE_NAMES.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g',
);

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

function scrubInternalHostSurfaceText(parts) {
  for (const part of parts ?? []) {
    if (typeof part.text === 'string') {
      part.text = part.text.replace(INTERNAL_HOST_SURFACE_PATTERN, 'internal host member');
    }
  }
}

function scrubInternalHostSurfaceComments(reflection) {
  scrubInternalHostSurfaceText(reflection.comment?.summary);
  for (const tag of reflection.comment?.blockTags ?? []) {
    scrubInternalHostSurfaceText(tag.content);
  }

  for (const signature of reflection.signatures ?? []) {
    scrubInternalHostSurfaceComments(signature);
  }
  for (const child of reflection.children ?? []) {
    scrubInternalHostSurfaceComments(child);
  }
}

function filterCachedGroups(reflection, removals) {
  for (const group of reflection.groups ?? []) {
    group.children = group.children.filter((child) => !removals.has(child));
  }
  reflection.groups = reflection.groups?.filter((group) => group.children.length > 0);

  for (const category of reflection.categories ?? []) {
    category.children = category.children.filter((child) => !removals.has(child));
  }
  reflection.categories = reflection.categories?.filter((category) => category.children.length > 0);
}

export function load(app) {
  app.on(Application.EVENT_VALIDATE_PROJECT, (project) => {
    const removals = [];
    collectInternalMapHostSurfaces(project, removals);
    const parents = new Set(removals.map((reflection) => reflection.parent).filter(Boolean));
    const removalSet = new Set(removals);

    for (const reflection of removals) {
      project.removeReflection(reflection);
    }

    for (const reflection of [project, ...parents]) {
      filterCachedGroups(reflection, removalSet);
    }

    scrubInternalHostSurfaceComments(project);
  });
}
