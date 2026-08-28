import { defineTool } from "@lovable.dev/mcp-js";
import { createMcpSupabase } from "../supabase.server";

export default defineTool({
  name: "list_categories",
  title: "List categories",
  description: "List active product categories with their slug.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async () => {
    const supabase = createMcpSupabase();
    const { data, error } = await supabase
      .from("categories")
      .select("id, name, slug, parent_id")
      .eq("active", true)
      .order("sort_order");
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { categories: data ?? [] },
    };
  },
});