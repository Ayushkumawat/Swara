import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { AmbientGlows } from "@/components/motion/primitives";
import { ButtonLink } from "@/components/ui/button";
import { currentUser } from "@/lib/server/auth";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  // Someone who already has an account should never be shown "Start free".
  const user = await currentUser();
  const signedIn = user != null;

  return (
    <>
      <AmbientGlows variant="marketing" />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="sticky top-0 z-50 border-b border-hairline bg-void/60 backdrop-blur-[24px]">
          <div className="mx-auto flex max-w-[1180px] items-center gap-6 px-5 py-3.5">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="grad-brand flex size-8 items-center justify-center rounded-[9px] font-[family-name:var(--font-display)] text-[15px] font-bold text-void">
                S
              </span>
              <span className="font-[family-name:var(--font-display)] text-base font-semibold text-t1">
                Swara
              </span>
            </Link>

            <nav className="ml-4 hidden items-center gap-6 md:flex">
              <Link href="/#listen" className="text-[13px] text-t2 transition-colors hover:text-t1">
                Listen
              </Link>
              <Link href="/#how" className="text-[13px] text-t2 transition-colors hover:text-t1">
                How it works
              </Link>
              <Link href="/#use-cases" className="text-[13px] text-t2 transition-colors hover:text-t1">
                Use cases
              </Link>
              <Link href="/pricing" className="text-[13px] text-t2 transition-colors hover:text-t1">
                Pricing
              </Link>
              <Link href="/#compliance" className="text-[13px] text-t2 transition-colors hover:text-t1">
                Compliance
              </Link>
            </nav>

            <div className="ml-auto flex items-center gap-2.5">
              {signedIn ? (
                <ButtonLink href="/overview" variant="primary" size="sm">
                  <LayoutDashboard className="size-3.5" />
                  Go to Dashboard
                </ButtonLink>
              ) : (
                <>
                  <ButtonLink href="/login" variant="subtle" size="sm">
                    Sign in
                  </ButtonLink>
                  <ButtonLink href="/signup" variant="primary" size="sm">
                    Start free
                  </ButtonLink>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-hairline">
          <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-6 gap-y-3 px-5 py-8 text-[12px] text-t3">
            <span>© {new Date().getFullYear()} Robosapien LLP</span>
            <span className="hidden sm:block">·</span>
            <span>Built in India, for Indian businesses</span>
            <div className="ml-auto flex gap-5">
              <Link href="/pricing" className="transition-colors hover:text-t1">
                Pricing
              </Link>
              {signedIn ? (
                <Link href="/overview" className="transition-colors hover:text-t1">
                  Dashboard
                </Link>
              ) : (
                <Link href="/login" className="transition-colors hover:text-t1">
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
