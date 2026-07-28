import type { ReactNode } from "react";
import { Construction } from "lucide-react";

export function ComingSoon({ title, phase, children }: { title: string; phase: string; children?: ReactNode }) {
  return (
    <div>
      <h1 className="mb-4 font-display text-2xl font-bold uppercase">{title}</h1>
      <div className="rounded-lg border border-dashed border-primary bg-primary/5 p-8 text-center">
        <Construction className="mx-auto h-10 w-10 text-primary" />
        <p className="mt-3 font-display text-lg font-bold uppercase">Em construção · {phase}</p>
        {children && <div className="mt-3 text-sm text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}
