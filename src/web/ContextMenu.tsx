import { useEffect } from "react";
import { dotlanLabel, dotlanUrl, type DotlanTarget } from "./dotlan.ts";

export type MenuState = { readonly x: number; readonly y: number; readonly target: DotlanTarget };

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("click", onClose);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onClose);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="context-menu"
      role="menu"
      style={{
        left: Math.min(menu.x, window.innerWidth - 240),
        top: Math.min(menu.y, window.innerHeight - 48),
      }}
    >
      <a
        role="menuitem"
        href={dotlanUrl(menu.target)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClose}
      >
        Open {dotlanLabel(menu.target)} on Dotlan ↗
      </a>
    </div>
  );
}
