import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/tenant-auth";
import { tdb } from "@/integrations/supabase/tenant-db";

type Confidence = "alta" | "media" | "baixa";

type TaxonomyRuleRow = {
  id: string;
  rule_key: string;
  match_label: string;
  category_slug: string;
  subcategory_slug: string;
  pattern: string;
  priority: number;
  confidence: Confidence;
};

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
};

export type ProductTaxonomySuggestion = {
  productId: string;
  productName: string;
  sku: string | null;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  subcategoryId: string;
  subcategoryName: string;
  subcategorySlug: string;
  ruleId: string;
  ruleKey: string;
  confidence: Confidence;
  matched: string;
  collisionCount: number;
};

type TaxonomyAssignment = {
  productId: string;
  categoryId: string;
  subcategoryId: string;
  ruleId?: string | null;
  confidence?: Confidence;
};

function normalizeTaxonomyName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

async function requireCatalogManager(
  supabase: ReturnType<typeof tdb>,
  userId: string,
  tenantId: string,
) {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !["owner", "admin", "manager"].includes(data.role)) {
    throw new Error("Usuário sem permissão para organizar o catálogo");
  }
}

export const suggestProductTaxonomy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number; includeAssigned?: boolean }) => input)
  .handler(async ({ data, context }): Promise<ProductTaxonomySuggestion[]> => {
    const sb = tdb(context.supabase);
    await requireCatalogManager(sb, context.userId, context.tenantId);

    const [{ data: categories, error: categoryError }, { data: rules, error: ruleError }] =
      await Promise.all([
        sb
          .from("categories")
          .select("id, name, slug, parent_id")
          .eq("tenant_id", context.tenantId)
          .eq("active", true),
        sb
          .from("catalog_taxonomy_rules")
          .select(
            "id, rule_key, match_label, category_slug, subcategory_slug, pattern, priority, confidence",
          )
          .eq("tenant_id", context.tenantId)
          .eq("active", true)
          .order("priority"),
      ]);
    if (categoryError) throw new Error(categoryError.message);
    if (ruleError) throw new Error(ruleError.message);

    const categoryBySlug = new Map(
      ((categories as CategoryRow[] | null) ?? []).map((category) => [category.slug, category]),
    );
    const compiledRules = ((rules as TaxonomyRuleRow[] | null) ?? []).flatMap((rule) => {
      try {
        return [{ ...rule, regex: new RegExp(rule.pattern, "i") }];
      } catch {
        return [];
      }
    });

    let productsQuery = sb
      .from("products")
      .select("id, name, sku, category_id, subcategory_id")
      .eq("tenant_id", context.tenantId)
      .is("deleted_at", null)
      .order("name")
      .limit(Math.min(data.limit ?? 3000, 5000));
    if (!data.includeAssigned) {
      productsQuery = productsQuery.or("category_id.is.null,subcategory_id.is.null");
    }
    const { data: products, error: productError } = await productsQuery;
    if (productError) throw new Error(productError.message);

    const suggestions: ProductTaxonomySuggestion[] = [];
    for (const product of products ?? []) {
      const normalizedName = normalizeTaxonomyName(product.name ?? "");
      const matches = compiledRules.filter((rule) => rule.regex.test(normalizedName));
      if (matches.length === 0) continue;

      matches.sort((a, b) => a.priority - b.priority);
      const bestPriority = matches[0].priority;
      const bestMatches = matches.filter((rule) => rule.priority === bestPriority);
      const best = bestMatches[0];
      const category = categoryBySlug.get(best.category_slug);
      const subcategory = categoryBySlug.get(best.subcategory_slug);
      if (!category || !subcategory || category.parent_id || subcategory.parent_id !== category.id)
        continue;
      if (product.category_id === category.id && product.subcategory_id === subcategory.id)
        continue;

      suggestions.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        categoryId: category.id,
        categoryName: category.name,
        categorySlug: category.slug,
        subcategoryId: subcategory.id,
        subcategoryName: subcategory.name,
        subcategorySlug: subcategory.slug,
        ruleId: best.id,
        ruleKey: best.rule_key,
        confidence: bestMatches.length === 1 ? best.confidence : "media",
        matched: best.match_label,
        collisionCount: bestMatches.length,
      });
    }
    return suggestions;
  });

export const applyProductTaxonomy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: TaxonomyAssignment) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireCatalogManager(sb, context.userId, context.tenantId);
    const { data: result, error } = await sb.rpc("apply_catalog_taxonomy_assignments", {
      p_assignments: [
        {
          product_id: data.productId,
          category_id: data.categoryId,
          subcategory_id: data.subcategoryId,
          rule_id: data.ruleId ?? null,
          confidence: data.confidence ?? "alta",
        },
      ],
      p_source: data.ruleId ? "manual_suggestion" : "manual_override",
    });
    if (error) throw new Error(error.message);
    return result;
  });

export const applyProductTaxonomyBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { assignments: TaxonomyAssignment[] }) => input)
  .handler(async ({ data, context }) => {
    const sb = tdb(context.supabase);
    await requireCatalogManager(sb, context.userId, context.tenantId);
    const highConfidence = data.assignments
      .filter((assignment) => assignment.confidence === "alta")
      .slice(0, 2000);
    if (highConfidence.length === 0) return { applied: 0, skipped: data.assignments.length };

    const { data: result, error } = await sb.rpc("apply_catalog_taxonomy_assignments", {
      p_assignments: highConfidence.map((assignment) => ({
        product_id: assignment.productId,
        category_id: assignment.categoryId,
        subcategory_id: assignment.subcategoryId,
        rule_id: assignment.ruleId ?? null,
        confidence: assignment.confidence,
      })),
      p_source: "bulk_review",
    });
    if (error) throw new Error(error.message);
    return {
      ...(result ?? {}),
      skipped: data.assignments.length - highConfidence.length,
    };
  });
