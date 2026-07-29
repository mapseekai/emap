import React, { type ReactNode } from 'react';
import MDXA from '@theme-original/MDXComponents/A';
import type { Props } from '@theme/MDXComponents/A';

const STATIC_PAGE_BASE_PATH = '/mapseekai/emap';
const STATIC_PAGE_PREFIXES = [
  `${STATIC_PAGE_BASE_PATH}/api/`,
  `${STATIC_PAGE_BASE_PATH}/examples/`,
];

export default function StaticPageAwareMDXA(props: Props): ReactNode {
  const href = props.href;
  const isStaticPage = href && STATIC_PAGE_PREFIXES.some((prefix) => href.startsWith(prefix));

  if (isStaticPage) return <a {...props} />;

  return <MDXA {...props} />;
}
