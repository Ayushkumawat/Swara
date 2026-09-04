import Link from "next/link";
import { AmbientGlows } from "@/components/motion/primitives";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AmbientGlows variant="marketing" />
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-5 py-12">
        <Link href="/" className="mb-8 flex items-center gap-2.5">
          <span className="grad-brand flex size-9 items-center justify-center rounded-[10px] font-[family-name:var(--font-display)] text-base font-bold text-void">
            S
          </span>
          <span className="font-[family-name:var(--font-display)] text-lg font-semibold text-t1">
            Swara
          </span>
        </Link>
        {children}
      </div>
    </>
  );
}
