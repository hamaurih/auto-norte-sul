import { defineTool } from "@lovable.dev/mcp-js";
import { createMcpSupabase } from "../supabase.server";

export default defineTool({
  name: "list_brands",
  title: "List brands",
  description: "List product brands with their slug.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async () => {
    const supabase = createMcpSupabase();
    const { data, error } = await supabase.from("brands").select("id, name, slug, featured").order("name");
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { brands: data ?? [] },
    };
  },
});