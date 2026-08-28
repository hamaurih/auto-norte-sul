export type SystemRole = "admin" | "gerente" | "vendedor" | "consulta";

export type PermissionAction = "can_view" | "can_create" | "can_update" | "can_delete";

export type PermissionModuleKey =
  | "dashboard"
  | "sales"
  | "crm"
  | "catalog"
  | "inventory"
  | "purchasing"
  | "marketing"
  | "integrations"
  | "ai"
  | "reports"
  | "fiscal"
  | "users"
  | "settings"
  | "audit";

export type ModulePermission = {
  module_key: PermissionModuleKey;
  can_view: boolean;
  can_create: boolean;
  can_update: boolean;
  can_delete: boolean;
};

export type PermissionMap = Record<PermissionModuleKey, ModulePermission>;

export const PERMISSION_MODULES: Array<{
  key: PermissionModuleKey;
  label: string;
  description: string;
  group: "operacao" | "catalogo" | "estoque" | "compras" | "marketing" | "integracoes" | "sistema";
}> = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "Indicadores gerais da operação",
    group: "operacao",
  },
  {
    key: "sales",
    label: "Vendas e pedidos",
    description: "Pedidos, orçamentos e atendimento de vendas",
    group: "operacao",
  },
  {
    key: "crm",
    label: "Clientes e B2B",
    description: "Clientes, cadastros B2B e carteira comercial",
    group: "operacao",
  },
  {
    key: "catalog",
    label: "Catálogo",
    description: "Produtos, categorias, marcas e aplicações",
    group: "catalogo",
  },
  {
    key: "inventory",
    label: "Estoque e filiais",
    description: "Estoque, filiais, depósitos e movimentações",
    group: "estoque",
  },
  {
    key: "purchasing",
    label: "Compras e suprimentos",
    description: "Fornecedores, compras e recebimento de mercadorias",
    group: "compras",
  },
  {
    key: "marketing",
    label: "Marketing",
    description: "Promoções, cupons e banners",
    group: "marketing",
  },
  {
    key: "integrations",
    label: "Integrações",
    description: "Bling, pagamentos e conexões externas",
    group: "integracoes",
  },
  {
    key: "ai",
    label: "IA A&S Business",
    description: "Recursos de inteligência artificial",
    group: "integracoes",
  },
  {
    key: "reports",
    label: "Relatórios",
    description: "Visões gerenciais e indicadores",
    group: "operacao",
  },
  {
    key: "fiscal",
    label: "Fiscal",
    description: "Homologação e rotinas fiscais",
    group: "sistema",
  },
  {
    key: "users",
    label: "Usuários e permissões",
    description: "Contas, papéis e acessos da equipe",
    group: "sistema",
  },
  {
    key: "settings",
    label: "Configurações",
    description: "Dados da empresa e ambiente",
    group: "sistema",
  },
  {
    key: "audit",
    label: "Auditoria e saneamento",
    description: "Auditoria, saneamento e manutenção",
    group: "sistema",
  },
];

const ALL_ACTIONS = {
  can_view: true,
  can_create: true,
  can_update: true,
  can_delete: true,
} as const;

const VIEW_ONLY = {
  can_view: true,
  can_create: false,
  can_update: false,
  can_delete: false,
} as const;

const SALES_DEFAULTS: PermissionModuleKey[] = ["dashboard", "sales", "crm", "catalog", "inventory"];

function blankPermission(module_key: PermissionModuleKey): ModulePermission {
  return { module_key, can_view: false, can_create: false, can_update: false, can_delete: false };
}

export function roleLabel(role: SystemRole): string {
  return {
    admin: "Administrador",
    gerente: "Gerente",
    vendedor: "Vendedor",
    consulta: "Consulta",
  }[role];
}

export const ROLE_OPTIONS: Array<{ value: SystemRole; label: string; description: string }> = [
  {
    value: "admin",
    label: "Administrador",
    description: "Acesso total ao sistema e à gestão de usuários",
  },
  {
    value: "gerente",
    label: "Gerente",
    description: "Acesso operacional amplo, sem administrar usuários",
  },
  {
    value: "vendedor",
    label: "Vendedor",
    description: "Acesso aos módulos comerciais selecionados",
  },
  {
    value: "consulta",
    label: "Consulta",
    description: "Somente visualização dos módulos selecionados",
  },
];

export function defaultPermissionsForRole(role: SystemRole): PermissionMap {
  const result = Object.fromEntries(
    PERMISSION_MODULES.map(({ key }) => [key, blankPermission(key)]),
  ) as PermissionMap;

  if (role === "admin") {
    for (const module of PERMISSION_MODULES)
      result[module.key] = { module_key: module.key, ...ALL_ACTIONS };
    return result;
  }

  if (role === "gerente") {
    for (const module of PERMISSION_MODULES) {
      result[module.key] = {
        module_key: module.key,
        can_view: true,
        can_create: module.key !== "users" && module.key !== "audit",
        can_update: module.key !== "users" && module.key !== "audit",
        can_delete: false,
      };
    }
    result.users = blankPermission("users");
    result.audit = { module_key: "audit", ...VIEW_ONLY };
    return result;
  }

  if (role === "vendedor") {
    for (const key of SALES_DEFAULTS) {
      result[key] = {
        module_key: key,
        can_view: true,
        can_create: key === "sales" || key === "crm",
        can_update: key === "sales" || key === "crm",
        can_delete: false,
      };
    }
    result.reports = { module_key: "reports", ...VIEW_ONLY };
    return result;
  }

  return result;
}

export function permissionMapFromRows(
  role: SystemRole,
  rows: Array<Partial<ModulePermission> & { module_key: PermissionModuleKey }>,
): PermissionMap {
  const result = defaultPermissionsForRole(role);
  for (const row of rows) {
    if (!result[row.module_key]) continue;
    result[row.module_key] = {
      module_key: row.module_key,
      can_view: Boolean(row.can_view),
      can_create: Boolean(row.can_create),
      can_update: Boolean(row.can_update),
      can_delete: Boolean(row.can_delete),
    };
  }
  return result;
}

export function permissionRowsFromMap(map: PermissionMap): ModulePermission[] {
  return PERMISSION_MODULES.map(({ key }) => map[key]);
}

export function canViewModule(
  permissions: PermissionMap | null | undefined,
  module: PermissionModuleKey,
): boolean {
  return Boolean(permissions?.[module]?.can_view);
}

export function hasPermission(
  permissions: PermissionMap | null | undefined,
  module: PermissionModuleKey,
  action: PermissionAction,
): boolean {
  return Boolean(permissions?.[module]?.[action]);
}
