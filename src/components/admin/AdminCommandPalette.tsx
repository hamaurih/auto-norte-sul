import { useEffect } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { LayoutDashboard } from "lucide-react";
import { visibleModules } from "@/lib/admin-modules";
import type { PermissionMap } from "@/lib/permissions";

export function AdminCommandPalette({
  open,
  onOpenChange,
  isAdmin,
  permissions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
  permissions: PermissionMap;
}) {
  const modules = visibleModules(isAdmin, permissions);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange, open]);

  const goTo = (to: string) => {
    onOpenChange(false);
    window.location.assign(to);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Buscar tela, recurso ou ação..." aria-label="Buscar no painel" />
      <CommandList>
        <CommandEmpty>Nenhum recurso encontrado.</CommandEmpty>
        <CommandGroup heading="Visão geral">
          <CommandItem value="dashboard central administrativa visão geral" onSelect={() => goTo("/admin")}>
            <LayoutDashboard aria-hidden="true" />
            <span>Central Administrativa</span>
            <CommandShortcut>Início</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        {modules.map((module) => (
          <CommandGroup key={module.key} heading={module.title}>
            {module.shortcuts.map((shortcut) => (
              <CommandItem
                key={`${module.key}-${shortcut.to}-${shortcut.label}`}
                value={`${module.title} ${shortcut.label} ${shortcut.description ?? ""}`}
                onSelect={() => goTo(shortcut.to)}
              >
                <shortcut.icon aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block font-medium">{shortcut.label}</span>
                  {shortcut.description && (
                    <span className="block truncate text-xs text-muted-foreground">{shortcut.description}</span>
                  )}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
