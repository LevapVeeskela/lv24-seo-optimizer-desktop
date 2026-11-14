export function BrandMark({ className = "brand-mark" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5 26h22"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <rect x="7" y="16" width="4" height="7" rx="1" fill="currentColor" />
      <rect x="14" y="11" width="4" height="12" rx="1" fill="currentColor" />
      <rect x="21" y="6" width="4" height="17" rx="1" fill="currentColor" />
      <circle
        cx="24.5"
        cy="20.5"
        r="3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M27 23l3 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
