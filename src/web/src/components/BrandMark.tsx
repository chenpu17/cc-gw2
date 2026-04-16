import { useId } from 'react'
import { cn } from '@/lib/utils'

export function BrandMark({
  className,
  title,
}: {
  className?: string
  title?: string
}) {
  const gradientId = useId()
  const glowId = useId()
  const decorative = !title

  return (
    <svg
      viewBox="0 0 64 64"
      className={cn('shrink-0', className)}
      role={decorative ? 'presentation' : 'img'}
      aria-hidden={decorative}
    >
      {!decorative ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={gradientId} x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1E1B4B" />
          <stop offset="0.48" stopColor="#4F46E5" />
          <stop offset="1" stopColor="#22C7F2" />
        </linearGradient>
        <radialGradient id={glowId} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(46 14) rotate(135) scale(30)">
          <stop stopColor="#FFFFFF" stopOpacity="0.4" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect x="4" y="4" width="56" height="56" rx="18" fill={`url(#${gradientId})`} />
      <rect x="4.5" y="4.5" width="55" height="55" rx="17.5" stroke="rgba(255,255,255,0.14)" />
      <circle cx="46" cy="14" r="22" fill={`url(#${glowId})`} />

      <g fill="none" stroke="#F8FAFC" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4">
        <path d="M20 20H26C29.314 20 32 22.686 32 26V38C32 41.314 34.686 44 38 44H44" />
        <path d="M44 20H38C34.686 20 32 22.686 32 26V38C32 41.314 29.314 44 26 44H20" />
      </g>

      <g fill="#FFFFFF">
        <circle cx="20" cy="20" r="4" />
        <circle cx="44" cy="20" r="4" />
        <circle cx="20" cy="44" r="4" />
        <circle cx="44" cy="44" r="4" />
        <circle cx="32" cy="32" r="3.5" fillOpacity="0.92" />
      </g>
    </svg>
  )
}
