
DROP POLICY IF EXISTS "snrl_public_insert" ON public.search_no_result_logs;
CREATE POLICY "snrl_public_insert_validated" ON public.search_no_result_logs FOR INSERT
  WITH CHECK (
    char_length(term) BETWEEN 1 AND 200
    AND char_length(normalized_term) BETWEEN 1 AND 200
    AND origin IN ('site','mcp','ia','admin')
  );
