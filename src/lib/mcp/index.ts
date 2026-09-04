import { defineMcp, auth } from "@lovable.dev/mcp-js";

const SUPABASE_URL = "https://pzwjbitjersngordgcsh.supabase.co";

import searchProductsTool from "./tools/search-products";
import getProductTool from "./tools/get-product";
import checkStockTool from "./tools/check-stock";
import findByVehicleTool from "./tools/find-by-vehicle";
import listCategoriesTool from "./tools/list-categories";
import listBrandsTool from "./tools/list-brands";

export default defineMcp({
  name: "aes-store-mcp",
  title: "A&S Store MCP",
  version: "0.3.0",
  auth: auth.oauth.issuer({
    issuer: `${SUPABASE_URL}/auth/v1`,
    jwksUri: `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
    acceptedAudiences: ["authenticated"],
  }),
  instructions: [
    "Ferramentas do e-commerce Norte Sul Acessórios para atendimento via WhatsApp.",
    "Fluxo típico: (1) identifique o que o cliente precisa; se ele descrever um veículo use `find_by_vehicle`; se citar nome/SKU use `search_products`.",
    "(2) Confirme disponibilidade e preço atualizado com `check_stock` antes de fechar cotação.",
    "(3) Use `get_product` para detalhes completos (descrição, imagem, aplicações) quando o cliente pedir mais informação.",
    "(4) Use `list_categories` / `list_brands` para navegação/filtros.",
    "Preços retornados são B2C. Estoque zerado significa produto indisponível.",
  ].join(" "),
  tools: [
    searchProductsTool,
    getProductTool,
    checkStockTool,
    findByVehicleTool,
    listCategoriesTool,
    listBrandsTool,
  ],
});
