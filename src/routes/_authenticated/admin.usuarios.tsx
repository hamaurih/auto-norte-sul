import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Edit3, Eye, EyeOff, KeyRound, RefreshCw, ShieldCheck, UserCheck, UserPlus, Users, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { activeTenant, fetchAccessContext } from "@/lib/access";
import { useSession } from "@/lib/session";
import {
  defaultPermissionsForRole,
  hasPermission,
  permissionRowsFromMap,
  roleLabel,
  ROLE_OPTIONS,
  PERMISSION_MODULES,
} from "@/lib/permissions";
import type {
  ModulePermission,
  PermissionAction,
  PermissionMap,
  PermissionModuleKey,
  SystemRole,
} from "@/lib/permissions";
import {
  listTenantUsers,
  inviteTenantUser,
  updateTenantUserAccess,
} from "@/lib/user-management.functions";
import type { ManagedUser } from "@/lib/user-management.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  head: () => ({ meta: [{ title: "Usuários e permissões · Norte Sul" }] }),
  beforeLoad: async () => {
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) throw redirect({ to: "/auth" });

    const context = await fetchAccessContext();
    const tenant = activeTenant(context);
    const tenantAdmin = Boolean(tenant && ["owner", "admin"].includes(tenant.role));
    const legacyAdmin = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userRes.user.id)
      .then(({ data }) => (data ?? []).some((item) => item.role === "admin"));
    if (!tenantAdmin && !legacyAdmin) throw redirect({ to: "/admin" });
  },
  component: UsersPage,
});

type FormState = {
  full_name: string;
  email: string;
  phone: string;
  role: SystemRole;
  permissions: PermissionMap;
  temporary_password: string;
};

const emptyForm = (): FormState => ({
  full_name: "",
  email: "",
  phone: "",
  role: "vendedor",
  permissions: defaultPermissionsForRole("vendedor"),
  temporary_password: "",
});

const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";

function generateTemporaryPassword(): string {
  const values = new Uint32Array(14);
  globalThis.crypto.getRandomValues(values);
  return Array.from(values, (value) => TEMP_PASSWORD_ALPHABET[value % TEMP_PASSWORD_ALPHABET.length]).join("");
}

function UsersPage() {
  const { permissions } = useSession();
  const queryClient = useQueryClient();
  const listUsers = useServerFn(listTenantUsers);
  const inviteUser = useServerFn(inviteTenantUser);
  const updateUser = useServerFn(updateTenantUserAccess);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showTemporaryPassword, setShowTemporaryPassword] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null);

  const usersQuery = useQuery({
    queryKey: ["tenant-users"],
    queryFn: () => listUsers(),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const permissions = permissionRowsFromMap(form.permissions);
      if (editing) {
        return updateUser({
          data: {
            membership_id: editing.membership_id,
            full_name: form.full_name,
            phone: form.phone,
            role: form.role,
            permissions,
          },
        });
      }
      return inviteUser({
        data: {
          full_name: form.full_name,
          email: form.email,
          phone: form.phone,
          role: form.role,
          permissions,
          temporary_password: form.temporary_password,
        },
      });
    },
    onSuccess: (result) => {
      const response = result as {
        created_account?: boolean;
        temporary_password?: string | null;
        reactivated?: boolean;
      };
      if (!editing && response.created_account && response.temporary_password) {
        setCreatedCredentials({
          email: form.email.trim().toLowerCase(),
          password: response.temporary_password,
        });
      } else {
        toast.success(
          editing
            ? "Permissões atualizadas."
            : response.reactivated
              ? "Usuário reativado. A senha existente não foi alterada."
              : "Usuário vinculado ao ambiente.",
        );
      }
      setDialogOpen(false);
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["tenant-users"] });
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível salvar o usuário."),
  });

  const statusMutation = useMutation({
    mutationFn: (user: ManagedUser) =>
      updateUser({
        data: { membership_id: user.membership_id, active: !user.active },
      }),
    onSuccess: () => {
      toast.success("Status do usuário atualizado.");
      queryClient.invalidateQueries({ queryKey: ["tenant-users"] });
    },
    onError: (error: Error) => toast.error(error.message || "Não foi possível atualizar o status."),
  });

  function openCreate() {
    setEditing(null);
    setShowTemporaryPassword(false);
    setForm({ ...emptyForm(), temporary_password: generateTemporaryPassword() });
    setDialogOpen(true);
  }

  function openEdit(user: ManagedUser) {
    const permissions = Object.fromEntries(
      user.permissions.map((item) => [item.module_key, item]),
    ) as PermissionMap;
    setEditing(user);
    setForm({
      full_name: user.full_name,
      email: user.email,
      phone: user.phone ?? "",
      role: user.role,
      permissions,
      temporary_password: "",
    });
    setShowTemporaryPassword(false);
    setDialogOpen(true);
  }

  function setRole(role: SystemRole) {
    setForm((current) => ({ ...current, role, permissions: defaultPermissionsForRole(role) }));
  }

  function setPermission(module: PermissionModuleKey, action: PermissionAction, checked: boolean) {
    setForm((current) => {
      const currentPermission = current.permissions[module];
      const next: ModulePermission = { ...currentPermission, [action]: checked };
      if (action === "can_view" && !checked) {
        next.can_create = false;
        next.can_update = false;
        next.can_delete = false;
      }
      if (action !== "can_view" && checked) next.can_view = true;
      return { ...current, permissions: { ...current.permissions, [module]: next } };
    });
  }

  const users = (usersQuery.data ?? []) as ManagedUser[];
  const activeCount = users.filter((user) => user.active).length;
  const inactiveCount = users.filter((user) => !user.active).length;
  const canCreateUsers = hasPermission(permissions, "users", "can_create");
  const canUpdateUsers = hasPermission(permissions, "users", "can_update");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
            <span className="text-xs font-bold uppercase tracking-[0.18em]">
              Controle de acesso
            </span>
          </div>
          <h1 className="mt-1 font-display text-3xl font-bold uppercase">Usuários e permissões</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Crie contas da equipe com uma senha provisória e escolha exatamente quais módulos cada
            pessoa pode consultar ou alterar neste ambiente. Nenhum e-mail será enviado.
          </p>
        </div>
        <Button onClick={openCreate} disabled={!canCreateUsers}>
          <UserPlus className="h-4 w-4" /> Criar usuário
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={Users} label="Usuários" value={users.length} />
        <SummaryCard icon={Check} label="Acessos ativos" value={activeCount} />
        <SummaryCard icon={UserCheck} label="Acessos inativos" value={inactiveCount} />
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-display text-lg font-bold uppercase">Equipe deste ambiente</h2>
          <p className="text-xs text-muted-foreground">
            O acesso é separado entre conta real e conta de teste.
          </p>
        </div>

        {usersQuery.isLoading ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            Carregando usuários…
          </div>
        ) : usersQuery.error ? (
          <div className="px-4 py-12 text-center text-sm text-destructive">
            {(usersQuery.error as Error).message || "Não foi possível carregar os usuários."}
          </div>
        ) : users.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            Nenhum usuário interno foi vinculado a este ambiente.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Usuário</th>
                  <th className="px-4 py-3">Papel</th>
                  <th className="px-4 py-3">Módulos visíveis</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.membership_id} className="border-t border-border/70">
                    <td className="px-4 py-3">
                      <div className="font-semibold">{user.full_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {user.email || "E-mail não informado"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={user.role === "admin" ? "default" : "outline"}>
                        {roleLabel(user.role)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {user.permissions.filter((permission) => permission.can_view).length} de{" "}
                      {PERMISSION_MODULES.length} módulos
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={user.active}
                          onCheckedChange={() => statusMutation.mutate(user)}
                          disabled={statusMutation.isPending || !canUpdateUsers}
                          aria-label={`${user.active ? "Desativar" : "Ativar"} ${user.full_name}`}
                        />
                        <span
                          className={
                            user.active
                              ? "text-xs font-semibold text-emerald-600"
                              : "text-xs text-muted-foreground"
                          }
                        >
                          {user.active ? "Ativo" : "Inativo"}
                        </span>
                      </div>
                      {user.must_change_password && user.active && (
                        <div className="mt-1 text-[10px] text-amber-600">Troca de senha obrigatória no primeiro acesso</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(user)}
                        disabled={!canUpdateUsers}
                      >
                        <Edit3 className="h-3.5 w-3.5" /> Editar acesso
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar acesso" : "Criar usuário do sistema"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Altere o papel e os módulos disponíveis para esta pessoa. As mudanças valem somente para o ambiente atual."
                : "Defina uma senha provisória abaixo. Nenhum e-mail será enviado; entregue a senha por um canal seguro."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Nome completo" className="md:col-span-1">
              <Input
                value={form.full_name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, full_name: event.target.value }))
                }
                placeholder="Ex.: João da Silva"
              />
            </Field>
            <Field label="E-mail" className="md:col-span-1">
              <Input
                type="email"
                value={form.email}
                disabled={Boolean(editing)}
                onChange={(event) =>
                  setForm((current) => ({ ...current, email: event.target.value }))
                }
                placeholder="usuario@empresa.com"
              />
            </Field>
            <Field label="Telefone" className="md:col-span-1">
              <Input
                value={form.phone}
                onChange={(event) =>
                  setForm((current) => ({ ...current, phone: event.target.value }))
                }
                placeholder="(83) 99999-9999"
              />
            </Field>
          </div>

          {!editing && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/70 p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
                <KeyRound className="h-4 w-4" /> Senha provisória do primeiro acesso
              </div>
              <p className="mt-1 text-xs text-amber-800">
                A pessoa usará esta senha para entrar e será obrigada a criar uma nova senha. O sistema não enviará e-mail.
              </p>
              <div className="mt-3 flex gap-2">
                <Input
                  type={showTemporaryPassword ? "text" : "password"}
                  value={form.temporary_password}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, temporary_password: event.target.value }))
                  }
                  autoComplete="new-password"
                  aria-label="Senha provisória"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setShowTemporaryPassword((current) => !current)}
                  aria-label={showTemporaryPassword ? "Ocultar senha provisória" : "Mostrar senha provisória"}
                >
                  {showTemporaryPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setForm((current) => ({ ...current, temporary_password: generateTemporaryPassword() }))
                  }
                >
                  <RefreshCw className="h-4 w-4" /> Gerar
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Papel do usuário
            </label>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {ROLE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setRole(option.value)}
                  className={`rounded-lg border p-3 text-left transition ${form.role === option.value ? "border-primary bg-primary/10 ring-1 ring-primary" : "border-border bg-card hover:border-primary/50"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold">{option.label}</span>
                    {form.role === option.value && <Check className="h-4 w-4 text-primary" />}
                  </div>
                  <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                    {option.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 flex flex-col justify-between gap-1 sm:flex-row sm:items-end">
              <div>
                <h3 className="font-display text-lg font-bold uppercase">Permissões por módulo</h3>
                <p className="text-xs text-muted-foreground">
                  Marcar uma ação automaticamente libera a visualização do módulo.
                </p>
              </div>
              {form.role === "admin" && <Badge>Administrador: acesso total</Badge>}
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Módulo</th>
                    <th className="w-20 px-3 py-2 text-center">Ver</th>
                    <th className="w-20 px-3 py-2 text-center">Criar</th>
                    <th className="w-20 px-3 py-2 text-center">Editar</th>
                    <th className="w-20 px-3 py-2 text-center">Excluir</th>
                  </tr>
                </thead>
                <tbody>
                  {PERMISSION_MODULES.map((module) => {
                    const permission = form.permissions[module.key];
                    return (
                      <tr key={module.key} className="border-t border-border/70">
                        <td className="px-3 py-2">
                          <div className="font-semibold">{module.label}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {module.description}
                          </div>
                        </td>
                        {(
                          [
                            "can_view",
                            "can_create",
                            "can_update",
                            "can_delete",
                          ] as PermissionAction[]
                        ).map((action) => (
                          <td key={action} className="px-3 py-2 text-center">
                            <Checkbox
                              checked={permission[action]}
                              onCheckedChange={(checked) =>
                                setPermission(module.key, action, checked === true)
                              }
                              aria-label={`${action} em ${module.label}`}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saveMutation.isPending}
            >
              <X className="h-4 w-4" /> Cancelar
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={
                saveMutation.isPending ||
                form.full_name.trim().length < 2 ||
                (!editing && !form.email.includes("@")) ||
                (editing ? !canUpdateUsers : !canCreateUsers)
              }
            >
              {saveMutation.isPending
                ? "Salvando…"
                : editing
                  ? "Salvar permissões"
                  : "Criar usuário"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(createdCredentials)} onOpenChange={(open) => !open && setCreatedCredentials(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Usuário criado com sucesso</DialogTitle>
            <DialogDescription>
              Entregue estes dados por um canal seguro. A senha será trocada obrigatoriamente no primeiro acesso.
            </DialogDescription>
          </DialogHeader>
          {createdCredentials && (
            <div className="space-y-3">
              <div>
                <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">E-mail</span>
                <Input readOnly value={createdCredentials.email} />
              </div>
              <div>
                <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">Senha provisória</span>
                <Input readOnly value={createdCredentials.password} className="font-mono" />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(`E-mail: ${createdCredentials.email}\nSenha provisória: ${createdCredentials.password}`)
                      .then(() => toast.success("Dados copiados."))
                      .catch(() => toast.error("Não foi possível copiar os dados."));
                  }}
                >
                  <Copy className="h-4 w-4" /> Copiar dados
                </Button>
                <Button onClick={() => setCreatedCredentials(null)}>Concluído</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={className}>
      <span className="mb-1 block text-xs font-semibold uppercase text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</div>
        <div className="font-display text-2xl font-bold">{value}</div>
      </div>
    </div>
  );
}
