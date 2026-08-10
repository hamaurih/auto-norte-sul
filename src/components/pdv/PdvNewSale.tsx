import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Barcode, ImageOff, Minus, PackageSearch, Plus, ScanLine, ShoppingCart, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { findPdvProductsByCode, listPdvCatalog, type PdvCatalogProduct } from "@/lib/pos.functions";
import { PdvCheckoutPanel } from "@/components/pdv/PdvCheckoutPanel";
import { PdvProductConfirm, effectivePdvPrice } from "@/components/pdv/PdvProductConfirm";
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

type Product = PdvCatalogProduct;
type Warehouse = { id: string; branch_id: string; name: string; code: string };
type CartItem = Product & { quantity: number; unitPrice: number };

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function ProductThumb({ product }: { product: Product }) {
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
      {product.image_url ? (
        <img
          src={product.image_url}
          alt={`Foto do produto ${product.name}`}
          className="h-full w-full object-contain"
          loading="lazy"
        />
      ) : (
        <ImageOff className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      )}
    </div>
  );
}

export function PdvNewSale() {
  const searchRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const catalogFn = useServerFn(listPdvCatalog);
  const findByCodeFn = useServerFn(findPdvProductsByCode);
  const [search, setSearch] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [confirming, setConfirming] = useState<Product | null>(null);
  const [ambiguous, setAmbiguous] = useState<Product[]>([]);
  const [status, setStatus] = useState("");
  const [lookingUp, setLookingUp] = useState(false);

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

  function resetToScanner() {
    setConfirming(null);
    setAmbiguous([]);
    setSearch("");
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function inCartQuantity(productId: string) {
    return cart.find((item) => item.id === productId)?.quantity ?? 0;
  }

  function openConfirm(product: Product) {
    setAmbiguous([]);
    setConfirming(product);
    setStatus(`Conferindo ${product.name}. Enter confirma, Escape cancela.`);
  }

  async function handleCodeSubmit() {
    const code = search.trim();
    if (!warehouseId || !code) return;
    setLookingUp(true);
    try {
      const matches = (await findByCodeFn({ data: { warehouseId, code } })) as Product[];
      if (matches.length === 0) {
        setStatus(`Nenhum produto com o código ${code}. Tente SKU, código interno, código do fabricante ou busque pelo nome.`);
        return;
      }
      if (matches.length > 1) {
        setConfirming(null);
        setAmbiguous(matches);
        setStatus(`${matches.length} produtos com o código ${code}. Selecione o correto.`);
        return;
      }
      openConfirm(matches[0]);
    } catch (error) {
      setStatus(error instanceof Error ? `Falha na consulta: ${error.message}` : "Falha ao consultar o código.");
    } finally {
      setLookingUp(false);
    }
  }

  function addProduct(product: Product, quantity: number) {
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (!existing) {
        return [
          ...current,
          {
            ...product,
            quantity: Math.min(product.stock, quantity),
            unitPrice: effectivePdvPrice(product),
          },
        ];
      }
      return current.map((item) =>
        item.id === product.id
          ? { ...item, quantity: Math.min(product.stock, item.quantity + quantity) }
          : item,
      );
    });
    setStatus(`${quantity}x ${product.name} adicionado à venda.`);
    resetToScanner();
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
    <div className="space-y-4">
      <div className="md:w-72">
        <Label htmlFor="warehouse" className="mb-1 block text-xs uppercase text-muted-foreground">
          Depósito da venda
        </Label>
        <Select value={warehouseId} onValueChange={setWarehouseId}>
          <SelectTrigger id="warehouse">
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

      <div className="grid min-h-[calc(100vh-16rem)] gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
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
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleCodeSubmit();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    resetToScanner();
                  }
                }}
                placeholder="Localizar por SKU, código interno, código do fabricante ou nome"
                className="h-12 pl-11 text-base"
                aria-label="Localizar produto por SKU, código interno, código do fabricante ou nome"
                aria-describedby="pdv-scanner-status"
              />
            </div>
            <p id="pdv-scanner-status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
              {lookingUp ? "Consultando código…" : status}
            </p>
          </CardHeader>
          <CardContent>
            {confirming ? (
              <PdvProductConfirm
                product={confirming}
                inCartQuantity={inCartQuantity(confirming.id)}
                onConfirm={(quantity) => addProduct(confirming, quantity)}
                onCancel={() => {
                  setStatus("Conferência cancelada.");
                  resetToScanner();
                }}
              />
            ) : ambiguous.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold">
                  Código com mais de um produto — selecione qual conferir:
                </p>
                <div className="grid gap-2 md:grid-cols-2">
                  {ambiguous.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => openConfirm(product)}
                      className="flex min-h-20 items-center gap-3 rounded-lg border bg-card p-3 text-left transition hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ProductThumb product={product} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{product.name}</p>
                        <p className="text-xs text-muted-foreground">
                          SKU {product.sku}
                          {product.internal_code ? ` · Int. ${product.internal_code}` : ""}
                          {product.manufacturer_code ? ` · Fab. ${product.manufacturer_code}` : ""}
                        </p>
                        <Badge variant="outline" className="mt-1">
                          {product.stock} disponíveis
                        </Badge>
                      </div>
                      <span className="font-display text-lg font-bold text-primary">
                        {money.format(effectivePdvPrice(product))}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : productsQuery.isPending && Boolean(warehouseId) && normalizedSearch ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-16 w-full" />
                ))}
              </div>
            ) : productsQuery.isError ? (
              <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-5 text-sm">
                <p className="font-semibold text-destructive">
                  Não foi possível consultar os produtos.
                </p>
                <p className="text-muted-foreground">
                  {productsQuery.error instanceof Error
                    ? productsQuery.error.message
                    : "Erro desconhecido na consulta."}
                </p>
                <Button type="button" variant="outline" onClick={() => void productsQuery.refetch()}>
                  Tentar novamente
                </Button>
              </div>
            ) : !normalizedSearch ? (
              <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed text-center">
                <ScanLine className="h-12 w-12 text-muted-foreground/50" />
                <p className="mt-3 font-semibold">Pronto para leitura</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Digite ou leia o SKU, código interno ou código do fabricante e pressione Enter: o
                  produto aparece aqui para conferência antes de entrar na venda.
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
                    onClick={() => openConfirm(product)}
                    className="flex min-h-20 items-center gap-3 rounded-lg border bg-card p-3 text-left transition hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ProductThumb product={product} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{product.name}</p>
                      <p className="text-xs text-muted-foreground">
                        SKU {product.sku}
                        {product.internal_code ? ` · Int. ${product.internal_code}` : ""}
                        {product.manufacturer_code ? ` · Fab. ${product.manufacturer_code}` : ""}
                      </p>
                      <Badge variant="outline" className="mt-1">
                        {product.stock} disponíveis
                      </Badge>
                    </div>
                    <span className="font-display text-xl font-bold text-primary">
                      {money.format(effectivePdvPrice(product))}
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
                        onClick={() =>
                          setCart((current) => current.filter((row) => row.id !== item.id))
                        }
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
              warehouse={
                (warehousesQuery.data ?? []).find((warehouse) => warehouse.id === warehouseId) ??
                null
              }
              items={cart}
              total={subtotal}
              onCompleted={() => {
                setCart([]);
                setStatus("Venda finalizada. Pronto para a próxima leitura.");
                resetToScanner();
                queryClient.invalidateQueries({ queryKey: ["pdv-products"] });
                queryClient.invalidateQueries({ queryKey: ["pdv-sales"] });
                queryClient.invalidateQueries({ queryKey: ["pdv-cash-report"] });
              }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
