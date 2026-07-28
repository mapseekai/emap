import React, { type ReactNode } from 'react';
import MDXA from '@theme-original/MDXComponents/A';
import type { Props } from '@theme/MDXComponents/A';

const STATIC_PAGE_PREFIXES = ['/emap/api/', '/emap/examples/'];

export default function StaticPageAwareMDXA(props: Props): ReactNode {
  const href = props.href;
  const isStaticPage = href && STATIC_PAGE_PREFIXES.some((prefix) => href.startsWith(prefix));

  return <MDXA {...props} href={isStaticPage ? `pathname://${href.slice('/emap'.length)}` : href} />;
}
