// Empty list: nothing to prerender at build (UIDs arrive from shares and
// easscan). Returning [] still opts the segment into on-demand static
// generation — first visit pays for a cheap shell, later crawler/prefetch
// hits are served from cache. Without this the route stays dynamic and
// every request spends Fluid CPU.
export function generateStaticParams() {
  return []
}

export default function VerifyUidLayout({ children }: { children: React.ReactNode }) {
  return children
}
