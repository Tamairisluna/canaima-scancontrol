export type LargeModuleIconKind = "scan" | "product" | "inventory";

export function LargeModuleIcon({
  kind,
  size = 32,
}: {
  kind: LargeModuleIconKind;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className={`large-module-icon large-module-icon-${kind}`}
      fill="none"
      focusable="false"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.35"
      viewBox="0 0 24 24"
      width={size}
    >
      {kind === "scan" ? (
        <>
          <path d="M8 4H4v4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
          <path d="M8 9v6M12 8v8M16 9v6" />
        </>
      ) : kind === "product" ? (
        <>
          <path d="m5 7.5 7-3.5 7 3.5v9L12 20l-7-3.5v-9Z" />
          <path d="m5 7.5 7 3.5 7-3.5M12 11v9M8.5 5.8l7 3.5" />
        </>
      ) : (
        <>
          <path d="M4 20V8l8-4 8 4v12H4Z" />
          <path d="M4 10h16M8 10v10M16 10v10M8 15h8" />
        </>
      )}
    </svg>
  );
}
