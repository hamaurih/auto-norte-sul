import {
  BarChart3,
  BadgeDollarSign,
  Bot,
  Building2,
  Briefcase,
  ClipboardCheck,
  FileText,
  FileUp,
  FolderTree,
  Image as ImageIcon,
  Images,
  Network,
  Package,
  PackageSearch,
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
    accent: "bg-blue-100 text-blue-700",
    shortcuts: [
      { to: "/admin/pdv", label: "PDV", description: "Frente de caixa", icon: ScanLine },
      { to: "/admin/pedidos", label: "Pedidos", description: "Acompanhar vendas", icon: ShoppingBag },
      { to: "/admin/expedicao", label: "Expedição", description: "Separação, conferência e envios", icon: Truck },
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
    accent: "bg-violet-100 text-violet-700",
    shortcuts: [
      { to: "/admin/produtos", label: "Produtos", description: "Listar e editar", icon: Package },
      { to: "/admin/produtos/novo", label: "Novo produto", description: "Cadastrar peça", icon: PlusCircle },
      { to: "/admin/categorias", label: "Categorias", description: "Árvore de categorias", icon: FolderTree },
      { to: "/admin/marcas", label: "Marcas", description: "Fabricantes", icon: Tag },
      { to: "/admin/revisao-codigos", label: "Revisão de códigos", description: "Corrigir códigos internos e de fabricante", icon: Tag, adminOnly: true },
      { to: "/admin/enriquecimento-produtos", label: "Enriquecer produtos", description: "Imagens e descrições com fonte e aprovação", icon: Images, adminOnly: true },
      { to: "/admin/catalogo-fabricantes", label: "Catálogo de fabricantes", description: "Fontes oficiais e regras de códigos", icon: Images, adminOnly: true },
    ],
  },
  {
    key: "estoque",
    title: "Gestão de Estoque",
    description: "Saldos por depósito, filiais e movimentações.",
    icon: Warehouse,
    accent: "bg-cyan-100 text-cyan-700",
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
    accent: "bg-amber-100 text-amber-700",
    shortcuts: [
      { to: "/admin/suprimentos", label: "Visão geral", description: "Indicadores de compras", icon: Truck },
      { to: "/admin/reposicao", label: "Reposição inteligente", description: "Sugestões por giro e fornecedor", icon: PackageSearch },
      { to: "/admin/inteligencia-comercial", label: "Inteligência comercial", description: "ABC, margem, preço, giro e capital", icon: BarChart3, adminOnly: true },
      { to: "/admin/fornecedores", label: "Fornecedores", description: "Cadastro e condições", icon: Truck },
      { to: "/admin/pedidos-compra", label: "Pedidos de compra", description: "Emissão e aprovação", icon: ShoppingCart },
      { to: "/admin/pedidos-compra/novo", label: "Novo pedido de compra", description: "Comprar do fornecedor", icon: PlusCircle },
      { to: "/admin/recebimentos", label: "Recebimentos", description: "Entrada de mercadoria", icon: PackageCheck },
      { to: "/admin/nfe-importacao", label: "Importar XML NF-e", description: "Conferência da nota de compra", icon: FileUp },
      { to: "/admin/historico-custos", label: "Financeiro do estoque", description: "Valorização e fechamentos", icon: ClipboardList },
      { to: "/admin/saneamento-custos", label: "Saneamento de custos", description: "Recuperar e aprovar custos reais", icon: BadgeDollarSign, adminOnly: true },
    ],
  },
  {
    key: "site",
    title: "Gestão do Site",
    description: "Vitrine, campanhas e descontos da loja.",
    icon: Store,
    accent: "bg-rose-100 text-rose-700",
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
    accent: "bg-emerald-100 text-emerald-700",
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
    accent: "bg-slate-100 text-slate-700",
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
  { to: "/admin/pdv", label: "Nova venda", description: "Abrir frente de caixa", icon: ScanLine },
  { to: "/admin/pedidos", label: "Pedidos", description: "Acompanhar vendas", icon: ShoppingBag },
  { to: "/admin/expedicao", label: "Expedição", description: "Separar e despachar", icon: Truck },
  { to: "/admin/pedidos-compra/novo", label: "Nova compra", description: "Comprar de fornecedor", icon: ShoppingCart },
  { to: "/admin/recebimentos", label: "Recebimentos", description: "Dar entrada em mercadoria", icon: PackageCheck },
  { to: "/admin/estoque", label: "Estoque", description: "Consultar e ajustar saldos", icon: Warehouse },
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
