import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Getting started',
      items: ['getting-started/installation'],
    },
    {
      type: 'category',
      label: 'Concepts',
      items: [
        'concepts/overview',
        'concepts/emap',
        'concepts/source-layer',
        'concepts/topology',
        'concepts/coordinates-crs',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/styling',
        'guides/events',
        'guides/selection',
        'guides/editing',
        'guides/camera',
        'guides/controls',
        'guides/worker',
      ],
    },
    {
      type: 'category',
      label: 'Data',
      items: ['data/formats', 'data/attributes', 'data/operations', 'data/duckdb'],
    },
    {
      type: 'category',
      label: 'Recipes',
      items: [
        'recipes/file-upload',
        'recipes/status-control',
        'recipes/undo-redo',
        'recipes/fit-bounds',
        'recipes/performance',
        'recipes/error-handling',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/events',
        'reference/errors',
        'reference/compatibility',
        'reference/faq',
      ],
    },
  ],
};

export default sidebars;
