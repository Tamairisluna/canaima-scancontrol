export type TechnicalIconKind =
  | "scan"
  | "evaluation"
  | "register"
  | "inventory"
  | "users"
  | "size"
  | "price"
  | "tag"
  | "unlabeled"
  | "success"
  | "alert"
  | "employee"
  | "manager"
  | "supervisor"
  | "pending"
  | "package"
  | "store"
  | "transfer";

export function TechnicalIcon({
  kind,
  size = 24,
  className = "",
}: {
  kind: TechnicalIconKind;
  size?: number;
  className?: string;
}) {
  const geometry = (() => {
    switch (kind) {
      case "scan":
        return <><path d="M3 8V4h5M16 4h5v4M21 16v4h-5M8 20H3v-4"/><path d="M7 9v6M10 8v8M13 9v6M17 8v8"/></>;
      case "evaluation":
        return <><path d="M7 4H5v17h14V4h-2"/><path d="M9 2h6v4H9Z"/><path d="m8 12 2 2 4-4M8 18h7"/></>;
      case "register":
        return <><path d="M4 5h16v15H4Z"/><path d="M8 3v4M16 3v4M4 9h16"/><path d="M8 12h3v3H8ZM14 12h3M14 15h3"/></>;
      case "inventory":
        return <><path d="M3 20V8l9-5 9 5v12H3Z"/><path d="M3 10h18M8 10v10M16 10v10M8 15h8"/></>;
      case "users":
        return <><circle cx="9" cy="8" r="3"/><path d="M3 20v-2c0-3 2-5 6-5s6 2 6 5v2M17 6h4M19 4v4M17 13h4M17 17h4"/></>;
      case "size":
        return <><path d="M4 6h16M6 4 4 6l2 2M18 4l2 2-2 2"/><path d="M5 12h14v7H5ZM8 12v3M11 12v2M14 12v3M17 12v2"/></>;
      case "price":
        return <><path d="m3 12 9-9h8v8l-9 9-8-8Z"/><circle cx="16.5" cy="6.5" r="1"/><path d="M12.5 9.5h-2a1.5 1.5 0 0 0 0 3h1a1.5 1.5 0 0 1 0 3h-2M11 8v9"/></>;
      case "tag":
        return <><path d="m3 10 7-7h7v7l-7 7-7-7Z"/><circle cx="13.5" cy="6.5" r="1"/><path d="m8 20 2 1 10-10V6l-1-1"/></>;
      case "unlabeled":
        return <><path d="m3 12 9-9h8v8l-9 9-8-8Z"/><circle cx="16.5" cy="6.5" r="1"/><path d="M5 4 20 19"/></>;
      case "success":
        return <><path d="M4 4h16v16H4Z"/><path d="m8 12 3 3 6-7"/></>;
      case "alert":
        return <><path d="M12 3 2.8 20h18.4L12 3Z"/><path d="M12 9v5M12 17v.1"/></>;
      case "employee":
        return <><path d="M4 5h16v14H4Z"/><circle cx="9" cy="11" r="2.5"/><path d="M6 17c.5-2 1.5-3 3-3s2.5 1 3 3M14 9h3M14 13h3"/></>;
      case "manager":
        return <><path d="M4 20V8h16v12M8 8V4h8v4M8 12h2M14 12h2M8 16h2M14 16h2M3 20h18"/></>;
      case "supervisor":
        return <><path d="M12 3 5 6v5c0 4.5 2.5 7.5 7 10 4.5-2.5 7-5.5 7-10V6l-7-3Z"/><path d="M12 8v7M8.5 11.5h7"/></>;
      case "pending":
        return <><path d="M4 4h16v16H4Z"/><circle cx="12" cy="12" r="5"/><path d="M12 9v3l2 1"/></>;
      case "package":
        return <><path d="m4 7 8-4 8 4v10l-8 4-8-4V7Z"/><path d="m4 7 8 4 8-4M12 11v10M8 5l8 4"/></>;
      case "store":
        return <><path d="M3 20V9h18v11M6 9V5h5v4M14 9V3h4v6M7 13h3M14 13h3M7 17h3M14 17h3M2 20h20"/></>;
      case "transfer":
        return <><path d="M4 8h14M15 5l3 3-3 3M20 16H6M9 13l-3 3 3 3"/></>;
    }
  })();

  return (
    <svg
      aria-hidden="true"
      className={`technical-icon technical-icon-${kind} ${className}`.trim()}
      fill="none"
      focusable="false"
      height={size}
      stroke="currentColor"
      strokeLinecap="square"
      strokeLinejoin="miter"
      strokeWidth="1.65"
      viewBox="0 0 24 24"
      width={size}
    >
      {geometry}
    </svg>
  );
}
