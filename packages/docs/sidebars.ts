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
      items: ['concepts/overview'],
    },
  ],
};

export default sidebars;
