import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Emap',
  tagline: 'Topology-oriented browser maps',
  url: 'https://mapseekai.github.io',
  baseUrl: '/mapseekai/emap/',
  favicon: '/mapseekai/emap/examples/emap.svg',
  organizationName: 'mapseekai',
  projectName: 'emap',
  onBrokenLinks: 'warn',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },
  i18n: {
    defaultLocale: 'zh-CN',
    locales: ['zh-CN', 'en'],
    localeConfigs: {
      'zh-CN': {
        label: '简体中文',
      },
      en: {
        label: 'English',
      },
    },
  },
  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    navbar: {
      title: 'Emap',
      logo: {
        alt: 'Emap logo',
        src: '/mapseekai/emap/examples/emap.svg',
        srcDark: '/mapseekai/emap/examples/emap.svg',
        width: 22,
        height: 22,
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: '文档',
        },
        {
          href: 'pathname:///examples/',
          label: '示例',
          position: 'left',
        },
        {
          href: 'pathname:///api/',
          label: 'API',
          position: 'left',
        },
        {
          type: 'localeDropdown',
          position: 'right',
        },
      ],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
