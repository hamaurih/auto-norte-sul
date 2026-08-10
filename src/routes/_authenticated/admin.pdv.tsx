import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import {
  Barcode,
  Minus,
  PackageSearch,
  Plus,
  ScanLine,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { listPdvCatalog } from "@/lib/pos.functions";
import { PdvCheckoutPanel } from "@/components/pdv/PdvCheckoutPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/admin/pdv")({
  head: () => ({ meta: [{ title: "PDV · Norte Sul" }] }),
  component: PdvPage,
});

type Product = {
  id: string;
  sku: string;
  internal_code: string | null;
  name: string;
  price_b2c: number;
  sale_price_b2c: number | null;
  stock: number;
};

type Warehouse = {
  id: string;
  branch_id: string;
  name: string;
  code: string;
};

type CartItem = Product & { quantity: number; unitPrice: number };

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function effectivePrice(product: Product) {
  return product.sale_price_b2c && product.sale_price_b2c > 0
    ? product.sale_price_b2c
    : product.price_b2c;
}

function PdvPage() {
  const searchRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const catalogFn = useServerFn(listPdvCatalog);
  const [search, setSearch] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);

  const productsQuery = useQuery({
    queryKey: ["pdv-products", warehouseId, search],
    enabled: Boolean(warehouseId),
    queryFn: () => catalogFn({ data: { warehouseId, search } }) as Promise<Product[]>,
  });

  const warehousesQuery = useQuery({
    queryKey: ["pdv-warehouses"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("warehouses")
        .select("id, branch_id, name, code")
        .eq("active", true)
        .order("is_default", { ascending: false })
        .order("name");

      if (error) throw error;
      return (data ?? []) as Warehouse[];
    },
  });

  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const results = useMemo(() => (productsQuery.data ?? []).slice(0, 12), [productsQuery.data]);

  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  function addProduct(product: Product) {
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (!existing) {
        return [...current, { ...product, quantity: 1, unitPrice: effectivePrice(product) }];
      }
      if (existing.quantity >= product.stock) return current;
      return current.map((item) =>
        item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
      );
    });
    setSearch("");
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function changeQuantity(productId: string, delta: number) {
    setCart((current) =>
      current
        .map((item) =>
          item.id === productId
            ? { ...item, quantity: Math.min(item.stock, Math.max(0, item.quantity + delta)) }
            : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <header className="flex flex-col gap-3 rounded-xl bg-secondary px-4 py-4 text-secondary-foreground shadow md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <ScanLine className="h-6 w-6 text-primary" />
            <h1 className="font-display text-3xl font-black uppercase">PDV Norte Sul</h1>
          </div>
          <p className="text-sm text-secondary-foreground/70">
            Venda rápida de balcão · núcleo em homologação
          </p>
        </div>
        <div className="md:ml-auto md:w-72">
          <Label htmlFor="warehouse" className="mb-1 block text-xs uppercase text-secondary-foreground/70">
            Depósito da venda
          </Label>
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger id="warehouse" className="bg-background text-foreground">
              <SelectValue placeholder="Selecione o depósito" />
            </SelectTrigger>
            <SelectContent>
              {(warehousesQuery.data ?? []).map((warehouse) => (
                <SelectItem key={warehouse.id} value={warehouse.id}>
                  {warehouse.name} ({warehouse.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-12rem)] gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
        <Card className="min-w-0">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 font-display text-xl uppercase">
              <Barcode className="h-5 w-5" />
              Localizar produto
            </CardTitle>
            <div className="relative">
              <PackageSearch className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
              <Input
                ref={searchRef}
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Leia o código ou busque por nome, SKU e código interno"
                className="h-12 pl-11 text-base"
                aria-label="Buscar produto"
              />
            </div>
          </CardHeader>
          <CardContent>
            {productsQuery.isPending && Boolean(warehouseId) ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-16 w-full" />
                ))}
              </div>
            ) : productsQuery.isError ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-5 text-sm">
                Não foi possível carregar os produtos. Verifique sua conexão e tente novamente.
              </div>
            ) : !normalizedSearch ? (
              <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed text-center">
                <ScanLine className="h-12 w-12 text-muted-foreground/50" />
                <p className="mt-3 font-semibold">Pronto para leitura</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  O leitor de código de barras funciona como teclado. Também é possível pesquisar pelo nome.
                </p>
              </div>
            ) : results.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center">
                <p className="font-semibold">Nenhum produto disponível encontrado</p>
                <p className="text-sm text-muted-foreground">
                  Confirme o código ou consulte o cadastro e o estoque do produto.
                </p>
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {results.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addProduct(product)}
                    className="flex min-h-20 items-center gap-3 rounded-lg border bg-card p-3 text-left transition hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{product.name}</p>
                      <p className="text-xs text-muted-foreground">
                        SKU {product.sku}{product.internal_code ? ` · ${product.internal_code}` : ""}
                      </p>
                      <Badge variant="outline" className="mt-1">
                        {product.stock} disponíveis
                      </Badge>
                    </div>
                    <span className="font-display text-xl font-bold text-primary">
                      {money.format(effectivePrice(product))}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-[34rem] flex-col xl:sticky xl:top-16 xl:max-h-[calc(100vh-5rem)]">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between font-display text-xl uppercase">
              <span className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" /> Venda atual
              </span>
              <Badge variant="secondary">{itemCount} itens</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {cart.length === 0 ? (
                <div className="flex h-full min-h-48 flex-col items-center justify-center text-center text-muted-foreground">
                  <ShoppingCart className="h-10 w-10 opacity-40" />
                  <p className="mt-2 text-sm">O carrinho está vazio.</p>
                </div>
              ) : (
                cart.map((item) => (
                  <div key={item.id} className="rounded-lg border p-3">
                    <div className="flex gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{item.sku}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remover ${item.name}`}
                        onClick={() => setCart((current) => current.filter((row) => row.id !== item.id))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center rounded-md border">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Diminuir quantidade"
                          onClick={() => changeQuantity(item.id, -1)}
                        >
                          <Minus />
                        </Button>
                        <span className="w-10 text-center font-semibold">{item.quantity}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Aumentar quantidade"
                          disabled={item.quantity >= item.stock}
                          onClick={() => changeQuantity(item.id, 1)}
                        >
                          <Plus />
                        </Button>
                      </div>
                      <span className="font-display text-lg font-bold">
                        {money.format(item.unitPrice * item.quantity)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <Separator className="my-4" />
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Subtotal</span>
                <span>{money.format(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between font-display text-2xl font-black">
                <span>Total</span>
                <span>{money.format(subtotal)}</span>
              </div>
            </div>
            <PdvCheckoutPanel
              warehouse={(warehousesQuery.data ?? []).find((warehouse) => warehouse.id === warehouseId) ?? null}
              items={cart}
              total={subtotal}
              onCompleted={() => {
                setCart([]);
                setSearch("");
                queryClient.invalidateQueries({ queryKey: ["pdv-products"] });
                requestAnimationFrame(() => searchRef.current?.focus());
              }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
