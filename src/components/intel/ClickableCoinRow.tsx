"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

export function ClickableCoinRow({
  href,
  label,
  className = "",
  children,
}: {
  href: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();

  function activate(event: MouseEvent<HTMLTableRowElement>) {
    if (event.target instanceof Element && event.target.closest("a, button")) return;
    router.push(href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.target instanceof Element && event.target.closest("a, button")) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      router.push(href);
    }
  }

  return (
    <tr
      role="link"
      tabIndex={0}
      aria-label={`Open ${label} market details`}
      onClick={activate}
      onKeyDown={onKeyDown}
      className={`clickable-coin-row ${className}`}
    >
      {children}
    </tr>
  );
}
