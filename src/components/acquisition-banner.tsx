// The acquisition announcement post; the banner links to it in a new tab.
const ANNOUNCEMENT_URL: string | null =
  'https://paragraph.com/@talent/talent-protocol-5-years-building-for-builders'

const MESSAGE = 'Talent Protocol was acquired by IPTS, with support from Protocol Labs →'

export function AcquisitionBanner() {
  const base =
    'block w-full border-b border-border bg-muted px-4 py-2 text-center text-sm text-muted-foreground'

  if (ANNOUNCEMENT_URL) {
    return (
      <a
        href={ANNOUNCEMENT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`${base} transition-colors hover:text-foreground`}
      >
        {MESSAGE}
      </a>
    )
  }

  return <div className={base}>{MESSAGE}</div>
}
