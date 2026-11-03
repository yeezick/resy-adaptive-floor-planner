import type { MouseEvent, ReactNode } from "react";
import { navigate, usePath } from "./lib/router";

export function Link({ href, children }: { href: string; children: ReactNode }) {
  const path = usePath();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
  };
  return (
    <a href={href} onClick={onClick} aria-current={path === href ? "page" : undefined}>
      {children}
    </a>
  );
}
