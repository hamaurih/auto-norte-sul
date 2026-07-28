
-- ai_chat_messages
DROP POLICY IF EXISTS chat_msgs_own ON public.ai_chat_messages;
CREATE POLICY chat_msgs_own ON public.ai_chat_messages
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ai_chat_sessions s WHERE s.id = ai_chat_messages.session_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ai_chat_sessions s WHERE s.id = ai_chat_messages.session_id AND s.user_id = auth.uid()));

-- ai_chat_sessions
DROP POLICY IF EXISTS chat_sessions_own ON public.ai_chat_sessions;
CREATE POLICY chat_sessions_own ON public.ai_chat_sessions
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ai_tool_logs
DROP POLICY IF EXISTS ai_tool_logs_own_read ON public.ai_tool_logs;
CREATE POLICY ai_tool_logs_own_read ON public.ai_tool_logs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- sales_orders
DROP POLICY IF EXISTS so_rep_insert ON public.sales_orders;
CREATE POLICY so_rep_insert ON public.sales_orders
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.sales_reps sr WHERE sr.id = sales_orders.rep_id AND sr.user_id = auth.uid()));

DROP POLICY IF EXISTS so_rep_read ON public.sales_orders;
CREATE POLICY so_rep_read ON public.sales_orders
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales_reps sr WHERE sr.id = sales_orders.rep_id AND sr.user_id = auth.uid()));

-- sales_rep_customers
DROP POLICY IF EXISTS src_rep_read ON public.sales_rep_customers;
CREATE POLICY src_rep_read ON public.sales_rep_customers
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales_reps sr WHERE sr.id = sales_rep_customers.rep_id AND sr.user_id = auth.uid()));

DROP POLICY IF EXISTS src_rep_write ON public.sales_rep_customers;
CREATE POLICY src_rep_write ON public.sales_rep_customers
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.sales_reps sr WHERE sr.id = sales_rep_customers.rep_id AND sr.user_id = auth.uid()));

-- sales_reps
DROP POLICY IF EXISTS sales_reps_self_read ON public.sales_reps;
CREATE POLICY sales_reps_self_read ON public.sales_reps
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- product_stock: restrict detailed warehouse data to authenticated staff only.
-- Public availability is served via v_product_stock_available view.
DROP POLICY IF EXISTS product_stock_public_read ON public.product_stock;
CREATE POLICY product_stock_auth_read ON public.product_stock
  FOR SELECT TO authenticated
  USING (true);
