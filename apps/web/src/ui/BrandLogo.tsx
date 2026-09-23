export function BrandLogo({
  size = 28,
  world = "default",
  accent
}: {
  size?: number;
  world?: string;
  accent?: string;
}) {
  return (
    <svg
      className="brand-logo"
      data-world={world}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      style={accent ? { color: accent } : undefined}
    >
      {/* Three offset planes read as map layers at 24 px; the centre pin makes the purpose
          obvious without the old phone-like rectangle. */}
      <path d="M5.4 8.2 16 4.4l10.6 3.8L16 12 5.4 8.2Z" fill="currentColor" opacity="0.16" />
      <path
        d="m5.4 13.2 10.6 3.8 10.6-3.8v4.5L16 21.5 5.4 17.7v-4.5Z"
        fill="currentColor"
        opacity="0.3"
      />
      <path
        d="m5.4 18.4 10.6 3.8 10.6-3.8v4.4L16 28.6 5.4 22.8v-4.4Z"
        fill="currentColor"
        opacity="0.5"
      />
      <path
        d="M16 7.2c-2.45 0-4.45 1.86-4.45 4.18 0 3.2 4.45 7.64 4.45 7.64s4.45-4.44 4.45-7.64C20.45 9.06 18.45 7.2 16 7.2Z"
        fill="var(--accent)"
      />
      <circle cx="16" cy="11.5" r="1.45" fill="var(--accent-contrast)" />
      {world === "global" ? (
        <g fill="none" stroke="currentColor" strokeWidth="1.25">
          <circle cx="23" cy="8" r="6" fill="var(--surface, white)" />
          <ellipse cx="23" cy="8" rx="2.5" ry="6" />
          <path d="M17 8h12" />
        </g>
      ) : null}
      {world === "aavegotchi" ? (
        <path
          d="m9 5.2 2.1-1.6 1.5 1 3.4-1.7 3.4 1.7 1.5-1L23 5.2l-1.2 2.2H10.2L9 5.2Z"
          fill="var(--accent)"
          opacity=".82"
        />
      ) : null}
    </svg>
  );
}
