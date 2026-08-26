export function BrandLogo({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="8" y="1.5" width="16" height="29" rx="3.8" fill="currentColor" opacity="0.12" />
      <rect
        x="9.4"
        y="4.4"
        width="13.2"
        height="20.4"
        rx="1.8"
        fill="var(--surface-elevated)"
        stroke="currentColor"
        strokeWidth="1.15"
      />
      <path
        d="M16 8.4c-2.15 0-3.9 1.62-3.9 3.7 0 2.85 3.9 7.2 3.9 7.2s3.9-4.35 3.9-7.2c0-2.08-1.75-3.7-3.9-3.7z"
        fill="var(--accent)"
      />
      <circle cx="16" cy="12" r="1.25" fill="#fff" />
      <circle cx="16" cy="27.4" r="1.15" fill="currentColor" opacity="0.38" />
    </svg>
  );
}
