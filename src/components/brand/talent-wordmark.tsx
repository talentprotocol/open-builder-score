import { TALENT_WORDMARK_PATHS, TALENT_WORDMARK_VIEWBOX } from './talent-wordmark-paths'

export function TalentWordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox={TALENT_WORDMARK_VIEWBOX}
      preserveAspectRatio="xMidYMid meet"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="talent"
    >
      {TALENT_WORDMARK_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
