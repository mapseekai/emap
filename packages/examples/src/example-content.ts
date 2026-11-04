export type ExampleLocale = 'zh' | 'en';

export const exampleCategories = [
  [
    'data-layers',
    '数据加载',
    'Data loading',
    '加载本地和在线矢量、栅格数据及地图服务。',
    'Load local and online vector data, raster data, and map services.',
  ],
  [
    'coordinates',
    '坐标系',
    'Coordinate systems',
    '切换地图坐标系，转换数据投影。',
    'Switch map coordinate systems and reproject data.',
  ],
  [
    'style',
    '样式',
    'Styling',
    '用颜色、线型、图标和文字，把数据表达清楚。',
    'Express your data with colors, lines, icons, and labels.',
  ],
  [
    'attributes',
    '属性',
    'Attributes',
    '查看要素属性并按字段条件筛选数据。',
    'Inspect feature attributes and filter data by field values.',
  ],
  [
    'editing',
    '编辑',
    'Editing',
    '绘制和修改几何及属性，使用吸附、拓扑编辑与撤销重做。',
    'Draw and edit geometry and attributes with snapping, topology, and undo/redo.',
  ],
  [
    'analysis',
    '分析',
    'Analysis',
    '使用 Emap 和 DuckDB 进行几何处理与空间分析。',
    'Process geometry and analyze spatial data with Emap and DuckDB.',
  ],
  [
    'tools',
    '配套工具',
    'Tools',
    '浏览图层管理、交互、导出、性能、2.5D 和扩展示例。',
    'Explore layer management, interaction, export, performance, 2.5D, and extensions.',
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
