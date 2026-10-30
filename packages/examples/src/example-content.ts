export type ExampleLocale = 'zh' | 'en';

export const exampleCategories = [
  [
    'getting-started',
    '入门',
    'Getting started',
    '从第一张地图开始，学习加载数据和调整视图。',
    'Start with your first map, load data, and adjust the view.',
  ],
  [
    'data-layers',
    '数据与图层',
    'Data & layers',
    '接入矢量、栅格与在线服务，组织图层并导出结果。',
    'Load vectors, rasters, and services. Organize layers and export results.',
  ],
  [
    'style',
    '样式',
    'Styling',
    '用颜色、线型、图标和文字，把数据表达清楚。',
    'Express your data with colors, lines, icons, and labels.',
  ],
  [
    'interaction',
    '交互',
    'Interaction',
    '响应地图事件，查询、选择并突出显示要素。',
    'Respond to events, query features, and highlight selections.',
  ],
  [
    'editing',
    '编辑',
    'Editing',
    '绘制和修改原始几何，体验捕捉、拓扑编辑与撤销重做。',
    'Draw and edit geometry with snapping, topology, and undo/redo.',
  ],
  [
    'analysis',
    '几何分析',
    'Geometry analysis',
    '逐步体验缓冲、裁剪、叠加与几何处理。',
    'Explore buffers, clipping, overlays, and geometry processing.',
  ],
  [
    'duckdb',
    'DuckDB',
    'DuckDB',
    '在浏览器中查询属性、处理几何并执行空间分析。',
    'Query attributes, process geometry, and run spatial analysis in the browser.',
  ],
  [
    'rendering',
    '渲染与性能',
    'Rendering & performance',
    '探索 GPU 渲染、大数据、影像和透视视图。',
    'Explore GPU rendering, large datasets, imagery, and perspective views.',
  ],
  [
    'extension',
    '扩展',
    'Extensions',
    '通过插件、控件和能力注册扩展地图。',
    'Extend maps with plugins, controls, and registered capabilities.',
  ],
] as const;

export function categoryLabel(category: string, locale: ExampleLocale = 'zh'): string {
  const item = exampleCategories.find(([id]) => id === category);
  return item?.[locale === 'zh' ? 1 : 2] ?? category;
}

export function categoryDescription(category: string, locale: ExampleLocale): string {
  const item = exampleCategories.find(([id]) => id === category);
  return item?.[locale === 'zh' ? 3 : 4] ?? '';
}

export const featuredExamples = [
  'getting-started/vector-file',
  'getting-started/lines',
  'luma-25d',
];
