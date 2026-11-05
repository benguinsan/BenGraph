import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { ThemeControl } from "@/components/theme-control";

// The frame every signed-in page renders inside. Later phases fill <main>; they
// don't rearrange this bar.
export default function ShellLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-3">
        <span className="font-semibold tracking-tight">Cartograph</span>
        <OrganizationSwitcher />
        <div className="ml-auto flex items-center gap-2">
          <ThemeControl />
          {/* Holds the avatar's space while Clerk loads, so the bar doesn't shift. */}
          <UserButton fallback={<span className="size-7" />} />
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
