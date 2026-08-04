import Image from "next/image";
import { ThemeToggle } from "./ThemeToggle";
import packageJson from "../package.json";

export const APP_HEADER_HEIGHT = "2.75rem";

export function AppHeader() {
  return (
    <header
      className="sticky top-0 z-50 flex h-11 shrink-0 items-center gap-2 border-b bg-background px-4 print:hidden"
      style={{ height: APP_HEADER_HEIGHT }}
    >
      <Image src="/icons/logo-64.png" alt="" width={24} height={24} className="size-6 shrink-0 rounded-md" />
      <span className="text-sm font-semibold tracking-tight">부하3호</span>
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
        v{packageJson.version}
      </span>
      <ThemeToggle className="ml-auto" />
    </header>
  );
}
