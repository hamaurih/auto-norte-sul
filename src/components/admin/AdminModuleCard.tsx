import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { AdminModule } from "@/lib/admin-modules";

const PRIORITY = 3;

export function AdminModuleCard({ module }: { module: AdminModule }) {
  const [open, setOpen] = useState(false);
  const shortcuts = open ? module.shortcuts : module.shortcuts.slice(0, PRIORITY);
  const hidden = module.shortcuts.length - PRIORITY;
  const panelId = `module-${module.key}`;

  return (
    <section className="group/card flex flex-col overflow-hidden rounded-3xl border border-border/70 bg-white/90 shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-lg">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 border-b border-border/50 bg-gradient-to-r from-muted/55 to-transparent p-5">
        <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${module.accent} shadow-sm`}>
          <module.icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex items-start gap-2">
            <h3 className="font-display text-lg font-bold leading-tight">{module.title}</h3>
            <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {module.shortcuts.length}
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{module.description}</p>
        </div>
      </div>

      <ul id={panelId} className="flex flex-col gap-1.5 p-3">
        {shortcuts.map((shortcut) => (
          <li key={`${module.key}-${shortcut.to}-${shortcut.label}`}>
            <Link
              to={shortcut.to}
              className="group flex min-h-11 items-center gap-3 rounded-2xl px-3 py-2 text-sm transition-colors hover:bg-blue-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <shortcut.icon className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{shortcut.label}</span>
                {shortcut.description && <span className="block truncate text-xs text-muted-foreground">{shortcut.description}</span>}
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className="mx-3 mb-3 flex min-h-11 items-center justify-center gap-1.5 rounded-2xl border border-violet-200 bg-violet-50/60 px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? "Mostrar menos" : `Ver todos os recursos (+${hidden})`}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
