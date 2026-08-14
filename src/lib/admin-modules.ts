import {
  Bot,
  Building2,
  Briefcase,
  ClipboardCheck,
  FileText,
  FolderTree,
  Image as ImageIcon,
  Network,
  Package,
  Percent,
  RefreshCcw,
  PackageCheck,
  ShoppingCart,
  Truck,
  ScanLine,
  Settings,
  ShieldAlert,
  ShoppingBag,
  Store,
  Tag,
  Ticket,
  UserCog,
  Users,
  Warehouse,
  PlusCircle,
  type LucideIcon,
  ClipboardList,
} from "lucide-react";

export type AdminShortcut = {
  /** Existing route path — audited against src/routes/_authenticated/*. */
  to: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /** External-to-admin link (storefront). */
  external?: boolean;
};

export type AdminModule = {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Tailwind classes for the discreet accent used by the module icon. */
  accent: string;
  shortcuts: AdminShortcut[];
  adminOnly?: boolean;
};

export const adminModules: AdminModule[] = [
  {
    key: "comercial",
    title: "Gestão Comercial",
    description: "Venda no balcão, orçamentos, pedidos e carteira de clientes.",
    icon: ShoppingBag,
    accent: "bg-primary/10 text-primary",
    shortcuts: [
      { to: "/admin/pdv", label: "PDV", description: "Frente de caixa", icon: ScanLine },
      { to: "/admin/pedidos", label: "Pedidos", description: "Acompanhar vendas", icon: ShoppingBag },
      { to: "/admin/orcamentos", label: "Orçamentos", description: "Propostas comerciais", icon: FileText },
      { to: "/admin/clientes", label: "Clientes", description: "Base de clientes", icon: Users },
      { to: "/admin/cadastros-b2b", label: "Cadastros B2B", description: "Aprovações de revenda", icon: Briefcase },
      { to: "/admin/vendedores", label: "Vendedores", description: "Equipe de vendas", icon: UserCog, adminOnly: true },
    ],
  },
  {
    key: "produtos",
    title: "Gestão de Produtos",
    description: "Catálogo, taxonomia e cadastro de peças.",
    icon: Package,
    accent: "bg-foreground/10 text-foreground",
    shortcuts: [
      { to: "/admin/produtos", label: "Produtos", description: "Listar e editar", icon: Package },
      { to: "/admin/produtos/novo", label: "Novo produto", description: "Cadastrar peça", icon: PlusCircle },
      { to: "/admin/categorias", label: "Categorias", description: "Árvore de categorias", icon: FolderTree },
      { to: "/admin/marcas", label: "Marcas", description: "Fabricantes", icon: Tag },
      { to: "/admin/revisao-codigos", label: "Revisão de códigos", description: "Corrigir códigos internos e de fabricante", icon: Tag, adminOnly: true },
    ],
  },
  {
    key: "estoque",
    title: "Gestão de Estoque",
    description: "Saldos por depósito, filiais e movimentações.",
    icon: Warehouse,
    accent: "bg-hot/15 text-hot",
    shortcuts: [
      { to: "/admin/estoque", label: "Estoque", description: "Saldos e ajustes", icon: Warehouse },
      { to: "/admin/filiais", label: "Filiais e Depósitos", description: "Estrutura física", icon: Building2 },
    ],
  },
  {
    key: "suprimentos",
    title: "Suprimentos e Compras",
    description: "Fornecedores, pedidos de compra e recebimento de mercadorias.",
    icon: Truck,
    accent: "bg-primary/10 text-primary",
    shortcuts: [
      { to: "/admin/suprimentos", label: "Visão geral", description: "Indicadores de compras", icon: Truck },
      { to: "/admin/fornecedores", label: "Fornecedores", description: "Cadastro e condições", icon: Truck },
      { to: "/admin/pedidos-compra", label: "Pedidos de compra", description: "Emissão e aprovação", icon: ShoppingCart },
      { to: "/admin/pedidos-compra/novo", label: "Novo pedido de compra", description: "Comprar do fornecedor", icon: PlusCircle },
      { to: "/admin/recebimentos", label: "Recebimentos", description: "Entrada de mercadoria", icon: PackageCheck },
      { to: "/admin/nfe-importacao", label: "Importar XML NF-e", description: "Conferência da nota de compra", icon: FileUp },
      { to: "/admin/historico-custos", label: "Histórico de custo", description: "Custo médio e último custo", icon: ClipboardList },
    ],
  },
  {
    key: "site",
    title: "Gestão do Site",
    description: "Vitrine, campanhas e descontos da loja.",
    icon: Store,
    accent: "bg-primary/10 text-primary",
    shortcuts: [
      { to: "/admin/banners", label: "Banners", description: "Vitrine da home", icon: ImageIcon },
      { to: "/admin/promocoes", label: "Promoções", description: "Campanhas de preço", icon: Percent },
      { to: "/admin/cupons", label: "Cupons", description: "Descontos por código", icon: Ticket },
      { to: "/", label: "Ver loja", description: "Abrir vitrine pública", icon: Store, external: true },
    ],
  },
  {
    key: "integracoes",
    title: "Integrações e Automação",
    description: "Ecossistema conectado, Bling e assistente de IA.",
    icon: Network,
    accent: "bg-foreground/10 text-foreground",
    adminOnly: true,
    shortcuts: [
      { to: "/admin/ecossistema", label: "Ecossistema", description: "Conexões ativas", icon: Network, adminOnly: true },
      { to: "/admin/ecossistema/bling", label: "Bling", description: "ERP e sincronização", icon: RefreshCcw, adminOnly: true },
      { to: "/admin/ia-aes-business", label: "IA A&S Business", description: "Assistente interno", icon: Bot, adminOnly: true },
    ],
  },
  {
    key: "sistema",
    title: "Administração e Segurança",
    description: "Configurações, saneamento de dados e auditoria.",
    icon: ShieldAlert,
    accent: "bg-destructive/10 text-destructive",
    adminOnly: true,
    shortcuts: [
      { to: "/admin/configuracoes", label: "Configurações", description: "Dados da empresa", icon: Settings, adminOnly: true },
      { to: "/admin/saneamento", label: "Saneamento", description: "Qualidade do catálogo", icon: ShieldAlert, adminOnly: true },
      { to: "/admin/saneamento/aliases", label: "Aliases", description: "Sinônimos de busca", icon: Tag, adminOnly: true },
      { to: "/admin/auditoria", label: "Auditoria", description: "Trilha de eventos", icon: ClipboardCheck, adminOnly: true },
      { to: "/admin/homologacao", label: "Homologação", description: "Checklist de release", icon: ClipboardCheck, adminOnly: true },
    ],
  },
];

export const adminQuickActions: AdminShortcut[] = [
  { to: "/admin/pdv", label: "Nova venda", icon: ScanLine },
  { to: "/admin/produtos/novo", label: "Novo produto", icon: PlusCircle },
  { to: "/admin/orcamentos", label: "Novo orçamento", icon: FileText },
  { to: "/admin/estoque", label: "Gerenciar estoque", icon: Warehouse },
  { to: "/admin/pedidos-compra/novo", label: "Novo pedido de compra", icon: ShoppingCart },
  { to: "/admin/promocoes", label: "Criar promoção", icon: Percent },
  { to: "/admin/banners", label: "Gerenciar banners", icon: ImageIcon },
];

export function visibleModules(isAdmin: boolean): AdminModule[] {
  return adminModules
    .filter((module) => !module.adminOnly || isAdmin)
    .map((module) => ({
      ...module,
      shortcuts: module.shortcuts.filter((shortcut) => !shortcut.adminOnly || isAdmin),
    }))
    .filter((module) => module.shortcuts.length > 0);
}
