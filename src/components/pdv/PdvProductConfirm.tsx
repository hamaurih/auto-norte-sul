import { useEffect, useRef, useState } from "react";
import { Check, ImageOff, Minus, Plus, X } from "lucide-react";
import type { PdvCatalogProduct } from "@/lib/pos.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function effectivePdvPrice(product: PdvCatalogProduct) {
  return product.sale_price_b2c && product.sale_price_b2c > 0
    ? product.sale_price_b2c
    : product.price_b2c;
}

/**
 * Cartão grande de conferência: o operador confere o produto lido antes de
 * incluir na venda. Enter confirma, Escape cancela.
 */
export function PdvProductConfirm({
  product,
  inCartQuantity,
  onConfirm,
  onCancel,
}: {
  product: PdvCatalogProduct;
  inCartQuantity: number;
  onConfirm: (quantity: number) => void;
  onCancel: () => void;
}) {
  const available = Math.max(0, product.stock - inCartQuantity);
  const [quantity, setQuantity] = useState(available > 0 ? 1 : 0);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setQuantity(available > 0 ? 1 : 0);
    confirmRef.current?.focus();
  }, [product.id, available]);

  const blocked = available <= 0;
  const invalid = blocked || quantity < 1 || quantity > available;
  const price = effectivePdvPrice(product);

  function commit() {
    if (invalid) return;
    onConfirm(quantity);
  }

  return (
    <section
      aria-label={`Conferência do produto ${product.name}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
      className="rounded-xl border-2 border-primary/40 bg-card p-4 shadow-sm"
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex h-44 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40 sm:h-56 sm:w-56">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={`Foto do produto ${product.name}`}
              className="h-full w-full object-contain"
              loading="lazy"
            />
          ) : (
            <div className="flex flex-col items-center text-muted-foreground">
              <ImageOff className="h-10 w-10" aria-hidden="true" />
              <span className="mt-1 text-xs">Sem foto cadastrada</span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl font-bold leading-tight">{product.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {product.brand ? `Marca: ${product.brand}` : "Marca não informada"}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">SKU</dt>
            <dd className="font-medium">{product.sku}</dd>
            <dt className="text-muted-foreground">Código interno</dt>
            <dd className="font-medium">{product.internal_code ?? "—"}</dd>
            <dt className="text-muted-foreground">Código de barras</dt>
            <dd className="font-medium">{product.barcode ?? "—"}</dd>
          </dl>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="font-display text-3xl font-black text-primary">
              {money.format(price)}
            </span>
            <Badge variant={product.stock > 0 ? "outline" : "destructive"}>
              {product.stock} em estoque no depósito
            </Badge>
            {inCartQuantity > 0 ? (
              <Badge variant="secondary">{inCartQuantity} já na venda</Badge>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="pdv-qty" className="mb-1 block text-xs uppercase text-muted-foreground">
                Quantidade
              </Label>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="min-h-11 min-w-11"
                  aria-label="Diminuir quantidade"
                  disabled={quantity <= 1}
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                >
                  <Minus />
                </Button>
                <Input
                  id="pdv-qty"
                  type="number"
                  min={1}
                  max={Math.max(1, available)}
                  inputMode="numeric"
                  value={quantity}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setQuantity(Number.isFinite(next) ? Math.max(0, Math.trunc(next)) : 0);
                  }}
                  className="h-11 w-20 text-center text-base"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="min-h-11 min-w-11"
                  aria-label="Aumentar quantidade"
                  disabled={quantity >= available}
                  onClick={() => setQuantity((q) => Math.min(available, q + 1))}
                >
                  <Plus />
                </Button>
              </div>
            </div>

            <Button
              ref={confirmRef}
              type="button"
              size="lg"
              className="min-h-11"
              disabled={invalid}
              onClick={commit}
            >
              <Check /> Adicionar à venda
            </Button>
            <Button type="button" variant="outline" size="lg" className="min-h-11" onClick={onCancel}>
              <X /> Cancelar / Esc
            </Button>
          </div>

          <p aria-live="polite" className="mt-2 text-sm">
            {blocked ? (
              <span className="font-semibold text-destructive">
                Sem saldo disponível neste depósito — inclusão bloqueada.
              </span>
            ) : quantity > available ? (
              <span className="font-semibold text-destructive">
                Quantidade acima do saldo disponível ({available}).
              </span>
            ) : (
              <span className="text-muted-foreground">
                Subtotal: {money.format(price * Math.max(0, quantity))} · Enter confirma, Esc cancela.
              </span>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
