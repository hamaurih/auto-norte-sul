
-- Public read for product-images and banners buckets (URLs assinadas ainda funcionam, mas leitura direta é liberada)
CREATE POLICY "public read product-images" ON storage.objects
  FOR SELECT USING (bucket_id = 'product-images');

CREATE POLICY "public read banners" ON storage.objects
  FOR SELECT USING (bucket_id = 'banners');

CREATE POLICY "staff write product-images" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'product-images' AND public.is_staff(auth.uid()))
  WITH CHECK (bucket_id = 'product-images' AND public.is_staff(auth.uid()));

CREATE POLICY "staff write banners" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'banners' AND public.is_staff(auth.uid()))
  WITH CHECK (bucket_id = 'banners' AND public.is_staff(auth.uid()));
