
-- ============ SEARCH ALIASES ============
CREATE TABLE IF NOT EXISTS public.search_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term TEXT NOT NULL,
  normalized_term TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('product','category','brand','tag','generic')),
  target_id UUID,
  target_slug TEXT,
  target_label TEXT,
  weight INTEGER NOT NULL DEFAULT 10,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(normalized_term, target_type, target_slug)
);
CREATE INDEX IF NOT EXISTS idx_search_aliases_norm ON public.search_aliases(normalized_term) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_search_aliases_target ON public.search_aliases(target_type, target_slug);

GRANT SELECT ON public.search_aliases TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.search_aliases TO authenticated;
GRANT ALL ON public.search_aliases TO service_role;

ALTER TABLE public.search_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "search_aliases_public_read" ON public.search_aliases FOR SELECT USING (is_active = true);
CREATE POLICY "search_aliases_staff_read" ON public.search_aliases FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','gerente','vendedor')));
CREATE POLICY "search_aliases_staff_write" ON public.search_aliases FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','gerente')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','gerente')));

CREATE TRIGGER trg_search_aliases_updated_at BEFORE UPDATE ON public.search_aliases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ SEARCH NO RESULT LOGS ============
CREATE TABLE IF NOT EXISTS public.search_no_result_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term TEXT NOT NULL,
  normalized_term TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'site' CHECK (origin IN ('site','mcp','ia','admin')),
  results_count INTEGER NOT NULL DEFAULT 0,
  matched_alias TEXT,
  matched_brand TEXT,
  matched_category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_snrl_norm ON public.search_no_result_logs(normalized_term);
CREATE INDEX IF NOT EXISTS idx_snrl_created ON public.search_no_result_logs(created_at DESC);

GRANT INSERT ON public.search_no_result_logs TO anon, authenticated;
GRANT SELECT, DELETE ON public.search_no_result_logs TO authenticated;
GRANT ALL ON public.search_no_result_logs TO service_role;

ALTER TABLE public.search_no_result_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "snrl_public_insert" ON public.search_no_result_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "snrl_staff_read" ON public.search_no_result_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','gerente','vendedor')));
CREATE POLICY "snrl_staff_delete" ON public.search_no_result_logs FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','gerente')));

-- ============ SEEDS (apenas para slugs existentes) ============
-- Helper: só insere se a categoria alvo existir
INSERT INTO public.search_aliases (term, normalized_term, target_type, target_slug, target_label, weight)
SELECT v.term, v.normalized_term, 'category', c.slug, c.name, 10
FROM (VALUES
  ('som','som','som-automotivo'),
  ('alto falante','alto falante','som-automotivo'),
  ('alto-falante','alto falante','som-automotivo'),
  ('alto-falantes','alto falante','som-automotivo'),
  ('corneta','corneta','som-automotivo'),
  ('módulo','modulo','som-automotivo'),
  ('modulo','modulo','som-automotivo'),
  ('amplificador','amplificador','som-automotivo'),
  ('subwoofer','subwoofer','som-automotivo'),
  ('multimídia','multimidia','multimidia'),
  ('multimidia','multimidia','multimidia'),
  ('central','central','multimidia'),
  ('central multimídia','central multimidia','multimidia'),
  ('central multimidia','central multimidia','multimidia'),
  ('dvd','dvd','multimidia'),
  ('player','player','multimidia'),
  ('rádio','radio','multimidia'),
  ('radio','radio','multimidia'),
  ('auto rádio','auto radio','multimidia'),
  ('auto radio','auto radio','multimidia'),
  ('led','led','iluminacao'),
  ('lâmpada','lampada','iluminacao'),
  ('lampada','lampada','iluminacao'),
  ('farol','farol','iluminacao'),
  ('milha','milha','iluminacao'),
  ('neblina','neblina','iluminacao'),
  ('tapete','tapete','acessorios-internos'),
  ('carpete','carpete','acessorios-internos'),
  ('capa banco','capa banco','acessorios-internos'),
  ('engate','engate','acessorios-externos'),
  ('reboque','reboque','acessorios-externos'),
  ('estribo','estribo','acessorios-externos'),
  ('câmera de ré','camera de re','seguranca'),
  ('camera de re','camera de re','seguranca'),
  ('sensor de ré','sensor de re','seguranca'),
  ('sensor de re','sensor de re','seguranca'),
  ('alarme','alarme','seguranca'),
  ('trava','trava','seguranca'),
  ('trava elétrica','trava eletrica','seguranca'),
  ('pneu','pneu','rodas-pneus'),
  ('roda','roda','rodas-pneus'),
  ('calota','calota','rodas-pneus')
) AS v(term, normalized_term, target_slug)
JOIN public.categories c ON c.slug = v.target_slug
ON CONFLICT (normalized_term, target_type, target_slug) DO NOTHING;
