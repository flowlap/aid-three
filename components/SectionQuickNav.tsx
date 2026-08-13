"use client";

import { cn } from "@/lib/utils";

/**
 * Two sticky bars stack above every pipeline page's content: the global
 * AppHeader.tsx (44px) and AppShell.tsx's own step-nav header (~118px at the
 * viewport widths this nav is shown at, xl+) — a combined ~162px that a
 * plain `scrollIntoView({block: "start"})` would tuck a target's top edge
 * behind. Callers must add this exact class to every element these links
 * point to (both the `id` target and, for consistency, this nav's own `top`
 * below), or a jump lands with the section's heading hidden under the
 * header. `scroll-mt-44` = 176px, ~14px of breathing room past the 162px.
 */
export const SECTION_QUICK_NAV_SCROLL_MARGIN_CLASS = "scroll-mt-44";

/**
 * A small fixed-position vertical link list that jumps to page sections by id
 * (smooth scroll). AppShell centers every pipeline page at max-w-[1000px]
 * with no side column, so this floats in the left gutter instead of taking
 * up layout space — only shown once the viewport is wide enough (xl+) to
 * have that gutter available. Kept deliberately simple (no active-section
 * highlighting) since callers only ever pass a couple of static targets;
 * see PreviewViewer.tsx for the richer IntersectionObserver-driven version
 * used for scene-by-scene navigation.
 */
export function SectionQuickNav({ links }: { links: { id: string; label: string }[] }) {
  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav
      aria-label="섹션 바로가기"
      className="fixed top-44 left-2 z-10 hidden w-32 flex-col gap-1 xl:flex"
    >
      {links.map((link) => (
        <a
          key={link.id}
          href={`#${link.id}`}
          onClick={(e) => {
            e.preventDefault();
            scrollToSection(link.id);
          }}
          className={cn(
            "truncate rounded-lg border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground",
            "shadow-sm transition-colors hover:border-foreground/30 hover:text-foreground"
          )}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}
