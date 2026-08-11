import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import type { AdminModule } from "@/lib/admin-modules";

const PRIORITY = 3;

export function AdminModuleCard({ module }: { module: AdminModule }) {
  const [open, setOpen] = useState(false);
  const shortcuts = open ? module.shortcuts : module.shortcuts.slice(0, PRIORITY);
  const hidden = module.shortcuts.length - PRIORITY;
  const panelId = `module-${module.key}`;

  return (
    <section className="flex flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-md ${module.accent}`}>
          <module.icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg font-bold leading-tight">{module.title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{module.description}</p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {module.shortcuts.length} {module.shortcuts.length === 1 ? "recurso" : "recursos"}
          </p>
        </div>
      </div>

      <ul id={panelId} className="mt-3 flex flex-col gap-1.5">
        {shortcuts.map((shortcut) => (
          <li key={`${module.key}-${shortcut.to}-${shortcut.label}`}>
            <Link
              to={shortcut.to}
              className="flex min-h-11 items-center gap-3 rounded-md border border-transparent bg-muted/40 px-3 py-2 text-sm transition-colors hover:border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <shortcut.icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{shortcut.label}</span>
                {shortcut.description && (
                  <span className="block truncate text-xs text-muted-foreground">{shortcut.description}</span>
                )}
              </span>
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
          className="mt-3 flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? "Recolher opções" : `Ver todas as opções (+${hidden})`}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
