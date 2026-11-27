import { useId } from 'react';

/** 标志：一扇亮着灯的拱窗，窗上是压花玻璃的棱。 */
export function Logo({ size = 22, lit = true }: { size?: number; lit?: boolean }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}g`} cx="0.5" cy="0.62" r="0.72">
          <stop offset="0" stopColor={lit ? '#ffd792' : '#4b5a52'} />
          <stop offset="0.48" stopColor={lit ? '#e6a24c' : '#33403a'} />
          <stop offset="1" stopColor={lit ? '#7c431a' : '#1f2925'} />
        </radialGradient>
        <clipPath id={`${id}c`}>
          <path d="M9 43V22.5C9 13.4 15.7 6 24 6s15 7.4 15 16.5V43Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        <rect x="9" y="6" width="30" height="37" fill={`url(#${id}g)`} />
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <rect x={9 + i * 6} y="6" width="1.5" height="37" fill="#fff" opacity={lit ? 0.3 : 0.08} />
            <rect x={13.4 + i * 6} y="6" width="1.6" height="37" fill="#1a0d02" opacity={lit ? 0.34 : 0.3} />
          </g>
        ))}
      </g>
      <path d="M9 43V22.5C9 13.4 15.7 6 24 6s15 7.4 15 16.5V43" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M5.5 43.2h37" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  );
}
