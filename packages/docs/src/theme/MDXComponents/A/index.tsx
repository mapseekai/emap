import React, { type ReactNode } from 'react';
import { useLocation } from '@docusaurus/router';
import MDXA from '@theme-original/MDXComponents/A';
import type { Props } from '@theme/MDXComponents/A';

const STATIC_PAGE_BASE_PATH = '/mapseekai/emap';
const STATIC_PAGE_PREFIXES = [
  `${STATIC_PAGE_BASE_PATH}/api/`,
  `${STATIC_PAGE_BASE_PATH}/examples/`,
];

export default function StaticPageAwareMDXA(props: Props): ReactNode {
  const location = useLocation();
  let href = props.href;
  if (href?.startsWith(`${STATIC_PAGE_BASE_PATH}/examples/`)) {
    const target = new URL(href, 'https://docs.local');
    target.searchParams.set('returnTo', location.pathname + location.hash);
    href = target.pathname + target.search + target.hash;
  }
  const isStaticPage = href && STATIC_PAGE_PREFIXES.some((prefix) => href.startsWith(prefix));

  if (isStaticPage) return <a {...props} href={href} />;

  return <MDXA {...props} />;
}
