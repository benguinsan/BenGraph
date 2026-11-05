import { ThemeControl } from "@/components/theme-control";

// Same bar height and border as the signed-in shell, so signing in doesn't feel
// like a different product.
export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-9 shrink-0 items-center border-b border-line px-3">
        <span className="font-semibold tracking-tight">Cartograph</span>
        <div className="ml-auto">
          <ThemeControl />
        </div>
      </header>
      <main className="flex flex-1 justify-center px-4 pt-[12vh]">{children}</main>
    </div>
  );
}
