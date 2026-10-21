import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'intro',
    {
      type: 'category',
      label: '开始',
      items: ['getting-started/installation', 'getting-started/quick-start'],
    },
    {
      type: 'category',
      label: '地图',
      items: [
        'concepts/overview',
        'concepts/emap',
        'concepts/source-layer',
        'guides/camera',
        'recipes/fit-bounds',
        'concepts/coordinates-crs',
        'concepts/topology',
      ],
    },
    {
      type: 'category',
      label: '显示',
      items: ['guides/styling', 'guides/controls', 'recipes/status-control'],
    },
    {
      type: 'category',
      label: '交互',
      items: ['guides/events', 'guides/selection'],
    },
    {
      type: 'category',
      label: '编辑',
      items: ['guides/editing', 'recipes/undo-redo', 'recipes/error-handling'],
    },
    {
      type: 'category',
      label: '数据',
      items: [
        'data/formats',
        'recipes/file-upload',
        'data/attributes',
        'data/operations',
        'data/geotiff',
        'data/geopackage',
        'data/duckdb',
      ],
    },
    {
      type: 'category',
      label: '进阶',
      items: [
        'guides/worker',
        'guides/plugins',
        'recipes/performance',
        'concepts/runtime',
        'concepts/architecture',
      ],
    },
    {
      type: 'category',
      label: '参考',
      items: ['reference/events', 'reference/errors', 'reference/compatibility', 'reference/faq'],
    },
  ],
};

export default sidebars;
