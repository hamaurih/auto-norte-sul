export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_aes_config: {
        Row: {
          active: boolean
          allowed_scopes: string[]
          api_url: string | null
          id: string
          last_test_status: string | null
          last_tested_at: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          allowed_scopes?: string[]
          api_url?: string | null
          id?: string
          last_test_status?: string | null
          last_tested_at?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          allowed_scopes?: string[]
          api_url?: string | null
          id?: string
          last_test_status?: string | null
          last_tested_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ai_chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          latency_ms: number | null
          recommended_action: Json | null
          role: string
          session_id: string
          suggestions: Json | null
          tokens_in: number | null
          tokens_out: number | null
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          latency_ms?: number | null
          recommended_action?: Json | null
          role: string
          session_id: string
          suggestions?: Json | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          latency_ms?: number | null
          recommended_action?: Json | null
          role?: string
          session_id?: string
          suggestions?: Json | null
          tokens_in?: number | null
          tokens_out?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_sessions: {
        Row: {
          created_at: string
          customer_group: string | null
          id: string
          page_context: string | null
          title: string | null
          updated_at: string
          user_id: string | null
          user_type: string | null
        }
        Insert: {
          created_at?: string
          customer_group?: string | null
          id?: string
          page_context?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string | null
          user_type?: string | null
        }
        Update: {
          created_at?: string
          customer_group?: string | null
          id?: string
          page_context?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string | null
          user_type?: string | null
        }
        Relationships: []
      }
      ai_knowledge_base: {
        Row: {
          active: boolean
          audience: string
          content: string
          created_at: string
          id: string
          question: string | null
          tags: string[] | null
          topic: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          audience?: string
          content: string
          created_at?: string
          id?: string
          question?: string | null
          tags?: string[] | null
          topic: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          audience?: string
          content?: string
          created_at?: string
          id?: string
          question?: string | null
          tags?: string[] | null
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_product_embeddings: {
        Row: {
          content: string
          embedding: Json | null
          id: string
          model: string | null
          product_id: string
          updated_at: string
        }
        Insert: {
          content: string
          embedding?: Json | null
          id?: string
          model?: string | null
          product_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          embedding?: Json | null
          id?: string
          model?: string | null
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_product_embeddings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_product_embeddings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id"]
          },
        ]
      }
      ai_tool_logs: {
        Row: {
          created_at: string
          error: string | null
          id: string
          input: Json | null
          latency_ms: number | null
          output: Json | null
          session_id: string | null
          status: string
          tool_name: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          input?: Json | null
          latency_ms?: number | null
          output?: Json | null
          session_id?: string | null
          status?: string
          tool_name: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          input?: Json | null
          latency_ms?: number | null
          output?: Json | null
          session_id?: string | null
          status?: string
          tool_name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_tool_logs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_user_id: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          id: number
          metadata: Json
          organization_id: string
          resource_id: string | null
          resource_type: string
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: never
          metadata?: Json
          organization_id: string
          resource_id?: string | null
          resource_type: string
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: never
          metadata?: Json
          organization_id?: string
          resource_id?: string | null
          resource_type?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_customer_price_tables: {
        Row: {
          active: boolean
          cnpj_digits: string
          created_at: string
          created_by: string | null
          customer_id: string
          price_table: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          cnpj_digits: string
          created_at?: string
          created_by?: string | null
          customer_id: string
          price_table?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          cnpj_digits?: string
          created_at?: string
          created_by?: string | null
          customer_id?: string
          price_table?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "b2b_customer_price_tables_customer_tenant_fkey"
            columns: ["customer_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "b2b_customer_price_tables_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_price_table_settings: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          id: string
          table_a_discount_pct: number
          table_b_discount_pct: number
          table_c_discount_pct: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          table_a_discount_pct?: number
          table_b_discount_pct?: number
          table_c_discount_pct?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          table_a_discount_pct?: number
          table_b_discount_pct?: number
          table_c_discount_pct?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "b2b_price_table_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      b2b_registrations: {
        Row: {
          admin_notes: string | null
          cidade: string
          cnpj: string
          created_at: string
          estado: string | null
          id: string
          nome_fantasia: string | null
          razao_social: string
          reviewed_at: string | null
          reviewed_by: string | null
          segmento: string
          status: Database["public"]["Enums"]["b2b_status"]
          updated_at: string
          user_id: string
          volume_medio_compra: string | null
          whatsapp: string
        }
        Insert: {
          admin_notes?: string | null
          cidade: string
          cnpj: string
          created_at?: string
          estado?: string | null
          id?: string
          nome_fantasia?: string | null
          razao_social: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          segmento: string
          status?: Database["public"]["Enums"]["b2b_status"]
          updated_at?: string
          user_id: string
          volume_medio_compra?: string | null
          whatsapp: string
        }
        Update: {
          admin_notes?: string | null
          cidade?: string
          cnpj?: string
          created_at?: string
          estado?: string | null
          id?: string
          nome_fantasia?: string | null
          razao_social?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          segmento?: string
          status?: Database["public"]["Enums"]["b2b_status"]
          updated_at?: string
          user_id?: string
          volume_medio_compra?: string | null
          whatsapp?: string
        }
        Relationships: []
      }
      banners: {
        Row: {
          active: boolean
          audience: Database["public"]["Enums"]["banner_audience"]
          created_at: string
          cta_label: string | null
          ends_at: string | null
          id: string
          image_mobile_url: string | null
          image_url: string
          link_url: string | null
          position: string
          sort_order: number
          starts_at: string | null
          subtitle: string | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          audience?: Database["public"]["Enums"]["banner_audience"]
          created_at?: string
          cta_label?: string | null
          ends_at?: string | null
          id?: string
          image_mobile_url?: string | null
          image_url: string
          link_url?: string | null
          position?: string
          sort_order?: number
          starts_at?: string | null
          subtitle?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          audience?: Database["public"]["Enums"]["banner_audience"]
          created_at?: string
          cta_label?: string | null
          ends_at?: string | null
          id?: string
          image_mobile_url?: string | null
          image_url?: string
          link_url?: string | null
          position?: string
          sort_order?: number
          starts_at?: string | null
          subtitle?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      bling_config: {
        Row: {
          access_token: string | null
          active: boolean
          auto_sync: boolean
          auto_sync_cron: string | null
          client_id: string | null
          client_secret_encrypted: string | null
          expires_at: string | null
          hide_out_of_stock: boolean
          id: string
          image_overwrites_manual: boolean
          last_authorized_at: string | null
          last_test_at: string | null
          last_test_status: string | null
          manual_price_overrides: boolean
          redirect_uri: string | null
          refresh_token: string | null
          scope: string | null
          source_price_b2c: boolean
          source_products: boolean
          source_stock: boolean
          sync_interval_minutes: number
          sync_prices: boolean
          sync_stock: boolean
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          active?: boolean
          auto_sync?: boolean
          auto_sync_cron?: string | null
          client_id?: string | null
          client_secret_encrypted?: string | null
          expires_at?: string | null
          hide_out_of_stock?: boolean
          id?: string
          image_overwrites_manual?: boolean
          last_authorized_at?: string | null
          last_test_at?: string | null
          last_test_status?: string | null
          manual_price_overrides?: boolean
          redirect_uri?: string | null
          refresh_token?: string | null
          scope?: string | null
          source_price_b2c?: boolean
          source_products?: boolean
          source_stock?: boolean
          sync_interval_minutes?: number
          sync_prices?: boolean
          sync_stock?: boolean
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          active?: boolean
          auto_sync?: boolean
          auto_sync_cron?: string | null
          client_id?: string | null
          client_secret_encrypted?: string | null
          expires_at?: string | null
          hide_out_of_stock?: boolean
          id?: string
          image_overwrites_manual?: boolean
          last_authorized_at?: string | null
          last_test_at?: string | null
          last_test_status?: string | null
          manual_price_overrides?: boolean
          redirect_uri?: string | null
          refresh_token?: string | null
          scope?: string | null
          source_price_b2c?: boolean
          source_products?: boolean
          source_stock?: boolean
          sync_interval_minutes?: number
          sync_prices?: boolean
          sync_stock?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      bling_sync_logs: {
        Row: {
          action: string
          created_at: string
          entity: Database["public"]["Enums"]["sync_entity"]
          entity_id: string | null
          id: string
          message: string | null
          payload: Json | null
          response: Json | null
          status: Database["public"]["Enums"]["sync_status"]
        }
        Insert: {
          action: string
          created_at?: string
          entity: Database["public"]["Enums"]["sync_entity"]
          entity_id?: string | null
          id?: string
          message?: string | null
          payload?: Json | null
          response?: Json | null
          status: Database["public"]["Enums"]["sync_status"]
        }
        Update: {
          action?: string
          created_at?: string
          entity?: Database["public"]["Enums"]["sync_entity"]
          entity_id?: string | null
          id?: string
          message?: string | null
          payload?: Json | null
          response?: Json | null
          status?: Database["public"]["Enums"]["sync_status"]
        }
        Relationships: []
      }
      branches: {
        Row: {
          active: boolean
          address: string | null
          city: string | null
          code: string
          created_at: string
          email: string | null
          id: string
          is_main: boolean
          name: string
          phone: string | null
          state: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          city?: string | null
          code: string
          created_at?: string
          email?: string | null
          id?: string
          is_main?: boolean
          name: string
          phone?: string | null
          state?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          city?: string | null
          code?: string
          created_at?: string
          email?: string | null
          id?: string
          is_main?: boolean
          name?: string
          phone?: string | null
          state?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          bling_id: string | null
          created_at: string
          featured: boolean
          id: string
          logo_url: string | null
          name: string
          slug: string
          tenant_id: string
        }
        Insert: {
          bling_id?: string | null
          created_at?: string
          featured?: boolean
          id?: string
          logo_url?: string | null
          name: string
          slug: string
          tenant_id: string
        }
        Update: {
          bling_id?: string | null
          created_at?: string
          featured?: boolean
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brands_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          active: boolean
          bling_id: string | null
          created_at: string
          icon: string | null
          id: string
          image_url: string | null
          name: string
          parent_id: string | null
          slug: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          active?: boolean
          bling_id?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          image_url?: string | null
          name: string
          parent_id?: string | null
          slug: string
          sort_order?: number
          tenant_id: string
        }
        Update: {
          active?: boolean
          bling_id?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          image_url?: string | null
          name?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_tenant_fkey"
            columns: ["parent_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      coupon_usages: {
        Row: {
          coupon_id: string
          discount_amount: number
          id: string
          order_id: string | null
          used_at: string
          user_id: string
        }
        Insert: {
          coupon_id: string
          discount_amount: number
          id?: string
          order_id?: string | null
          used_at?: string
          user_id: string
        }
        Update: {
          coupon_id?: string
          discount_amount?: number
          id?: string
          order_id?: string | null
          used_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_usages_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_usages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          active: boolean
          category_id: string | null
          code: string
          created_at: string
          customer_group: string | null
          description: string | null
          discount_type: Database["public"]["Enums"]["coupon_discount_type"]
          discount_value: number
          ends_at: string | null
          first_purchase_only: boolean
          id: string
          max_discount_value: number | null
          min_order_value: number | null
          product_id: string | null
          starts_at: string | null
          updated_at: string
          usage_limit: number | null
          usage_limit_per_user: number | null
        }
        Insert: {
          active?: boolean
          category_id?: string | null
          code: string
          created_at?: string
          customer_group?: string | null
          description?: string | null
          discount_type: Database["public"]["Enums"]["coupon_discount_type"]
          discount_value: number
          ends_at?: string | null
          first_purchase_only?: boolean
          id?: string
          max_discount_value?: number | null
          min_order_value?: number | null
          product_id?: string | null
          starts_at?: string | null
          updated_at?: string
          usage_limit?: number | null
          usage_limit_per_user?: number | null
        }
        Update: {
          active?: boolean
          category_id?: string | null
          code?: string
          created_at?: string
          customer_group?: string | null
          description?: string | null
          discount_type?: Database["public"]["Enums"]["coupon_discount_type"]
          discount_value?: number
          ends_at?: string | null
          first_purchase_only?: boolean
          id?: string
          max_discount_value?: number | null
          min_order_value?: number | null
          product_id?: string | null
          starts_at?: string | null
          updated_at?: string
          usage_limit?: number | null
          usage_limit_per_user?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "coupons_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupons_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupons_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id"]
          },
        ]
      }
      customers: {
        Row: {
          active: boolean
          b2b_status: Database["public"]["Enums"]["b2b_approval_status"]
          created_at: string
          customer_group: Database["public"]["Enums"]["customer_group"]
          document: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
          tenant_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          b2b_status?: Database["public"]["Enums"]["b2b_approval_status"]
          created_at?: string
          customer_group?: Database["public"]["Enums"]["customer_group"]
          document?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          tenant_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          b2b_status?: Database["public"]["Enums"]["b2b_approval_status"]
          created_at?: string
          customer_group?: Database["public"]["Enums"]["customer_group"]
          document?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_document_events: {
        Row: {
          created_at: string
          created_by: string | null
          event_type: string
          fiscal_document_id: string
          id: string
          message: string | null
          payload: Json
          protocol: string | null
          sequence: number
          status_code: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          event_type: string
          fiscal_document_id: string
          id?: string
          message?: string | null
          payload?: Json
          protocol?: string | null
          sequence?: number
          status_code?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          event_type?: string
          fiscal_document_id?: string
          id?: string
          message?: string | null
          payload?: Json
          protocol?: string | null
          sequence?: number
          status_code?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_document_events_document_tenant_fkey"
            columns: ["fiscal_document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "fiscal_document_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_document_items: {
        Row: {
          cest: string | null
          cfop: string | null
          created_at: string
          description: string
          discount_value: number
          fiscal_document_id: string
          gross_value: number
          gtin: string | null
          id: string
          line_number: number
          ncm: string | null
          net_value: number
          order_item_id: string | null
          product_id: string | null
          quantity: number
          sku: string
          tax_snapshot: Json
          tenant_id: string
          unit: string
          unit_value: number
        }
        Insert: {
          cest?: string | null
          cfop?: string | null
          created_at?: string
          description: string
          discount_value?: number
          fiscal_document_id: string
          gross_value: number
          gtin?: string | null
          id?: string
          line_number: number
          ncm?: string | null
          net_value: number
          order_item_id?: string | null
          product_id?: string | null
          quantity: number
          sku: string
          tax_snapshot?: Json
          tenant_id: string
          unit?: string
          unit_value: number
        }
        Update: {
          cest?: string | null
          cfop?: string | null
          created_at?: string
          description?: string
          discount_value?: number
          fiscal_document_id?: string
          gross_value?: number
          gtin?: string | null
          id?: string
          line_number?: number
          ncm?: string | null
          net_value?: number
          order_item_id?: string | null
          product_id?: string | null
          quantity?: number
          sku?: string
          tax_snapshot?: Json
          tenant_id?: string
          unit?: string
          unit_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_document_items_document_tenant_fkey"
            columns: ["fiscal_document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "fiscal_document_items_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "fiscal_document_items_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "fiscal_document_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_documents: {
        Row: {
          access_key: string | null
          authorization_code: string | null
          authorized_at: string | null
          branch_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          danfe_path: string | null
          environment: string
          id: string
          idempotency_key: string
          issued_at: string | null
          last_error_code: string | null
          last_error_message: string | null
          model: string
          number: number
          order_id: string | null
          protocol: string | null
          provider: string
          provider_reference: string | null
          recipient_address: Json
          recipient_email: string | null
          recipient_name: string
          recipient_phone: string | null
          recipient_tax_id: string | null
          response_xml_path: string | null
          schema_version: string
          series: number
          status: string
          tax_totals: Json
          tenant_id: string
          totals: Json
          updated_at: string
          updated_by: string | null
          validation_errors: Json
          xml_path: string | null
        }
        Insert: {
          access_key?: string | null
          authorization_code?: string | null
          authorized_at?: string | null
          branch_id: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          danfe_path?: string | null
          environment: string
          id?: string
          idempotency_key?: string
          issued_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          model: string
          number: number
          order_id?: string | null
          protocol?: string | null
          provider: string
          provider_reference?: string | null
          recipient_address?: Json
          recipient_email?: string | null
          recipient_name: string
          recipient_phone?: string | null
          recipient_tax_id?: string | null
          response_xml_path?: string | null
          schema_version?: string
          series: number
          status?: string
          tax_totals?: Json
          tenant_id: string
          totals?: Json
          updated_at?: string
          updated_by?: string | null
          validation_errors?: Json
          xml_path?: string | null
        }
        Update: {
          access_key?: string | null
          authorization_code?: string | null
          authorized_at?: string | null
          branch_id?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          danfe_path?: string | null
          environment?: string
          id?: string
          idempotency_key?: string
          issued_at?: string | null
          last_error_code?: string | null
          last_error_message?: string | null
          model?: string
          number?: number
          order_id?: string | null
          protocol?: string | null
          provider?: string
          provider_reference?: string | null
          recipient_address?: Json
          recipient_email?: string | null
          recipient_name?: string
          recipient_phone?: string | null
          recipient_tax_id?: string | null
          response_xml_path?: string | null
          schema_version?: string
          series?: number
          status?: string
          tax_totals?: Json
          tenant_id?: string
          totals?: Json
          updated_at?: string
          updated_by?: string | null
          validation_errors?: Json
          xml_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_documents_branch_tenant_fkey"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "fiscal_documents_order_tenant_fkey"
            columns: ["order_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "fiscal_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_settings: {
        Row: {
          branch_id: string
          cbs_enabled: boolean
          certificate_expires_at: string | null
          certificate_secret_ref: string | null
          city: string
          city_code: string
          complement: string | null
          created_at: string
          created_by: string | null
          crt: number
          csc_id: string | null
          csc_secret_ref: string | null
          district: string
          email: string | null
          enabled: boolean
          environment: string
          homologation_checked_at: string | null
          homologation_details: Json
          homologation_status: string
          ibs_enabled: boolean
          id: string
          legal_name: string
          municipal_tax_id: string | null
          next_nfce_number: number
          next_nfe_number: number
          nfce_series: number
          nfe_series: number
          number: string
          phone: string | null
          provider: string
          state: string
          state_tax_id: string
          street: string
          tax_id: string
          tax_regime: string
          tenant_id: string
          trade_name: string | null
          transmission_enabled: boolean
          updated_at: string
          updated_by: string | null
          zip_code: string
        }
        Insert: {
          branch_id: string
          cbs_enabled?: boolean
          certificate_expires_at?: string | null
          certificate_secret_ref?: string | null
          city: string
          city_code: string
          complement?: string | null
          created_at?: string
          created_by?: string | null
          crt: number
          csc_id?: string | null
          csc_secret_ref?: string | null
          district: string
          email?: string | null
          enabled?: boolean
          environment?: string
          homologation_checked_at?: string | null
          homologation_details?: Json
          homologation_status?: string
          ibs_enabled?: boolean
          id?: string
          legal_name: string
          municipal_tax_id?: string | null
          next_nfce_number?: number
          next_nfe_number?: number
          nfce_series?: number
          nfe_series?: number
          number: string
          phone?: string | null
          provider?: string
          state: string
          state_tax_id: string
          street: string
          tax_id: string
          tax_regime: string
          tenant_id: string
          trade_name?: string | null
          transmission_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
          zip_code: string
        }
        Update: {
          branch_id?: string
          cbs_enabled?: boolean
          certificate_expires_at?: string | null
          certificate_secret_ref?: string | null
          city?: string
          city_code?: string
          complement?: string | null
          created_at?: string
          created_by?: string | null
          crt?: number
          csc_id?: string | null
          csc_secret_ref?: string | null
          district?: string
          email?: string | null
          enabled?: boolean
          environment?: string
          homologation_checked_at?: string | null
          homologation_details?: Json
          homologation_status?: string
          ibs_enabled?: boolean
          id?: string
          legal_name?: string
          municipal_tax_id?: string | null
          next_nfce_number?: number
          next_nfe_number?: number
          nfce_series?: number
          nfe_series?: number
          number?: string
          phone?: string | null
          provider?: string
          state?: string
          state_tax_id?: string
          street?: string
          tax_id?: string
          tax_regime?: string
          tenant_id?: string
          trade_name?: string | null
          transmission_enabled?: boolean
          updated_at?: string
          updated_by?: string | null
          zip_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_settings_branch_tenant_fkey"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "fiscal_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fiscal_transmission_jobs: {
        Row: {
          attempt: number
          available_at: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          diagnostics: Json
          environment: string
          fiscal_document_id: string
          id: string
          locked_at: string | null
          max_attempts: number
          operation: string
          request_hash: string | null
          response_code: string | null
          response_message: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempt?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          diagnostics?: Json
          environment?: string
          fiscal_document_id: string
          id?: string
          locked_at?: string | null
          max_attempts?: number
          operation?: string
          request_hash?: string | null
          response_code?: string | null
          response_message?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempt?: number
          available_at?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          diagnostics?: Json
          environment?: string
          fiscal_document_id?: string
          id?: string
          locked_at?: string | null
          max_attempts?: number
          operation?: string
          request_hash?: string | null
          response_code?: string | null
          response_message?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_transmission_jobs_document_tenant_fkey"
            columns: ["fiscal_document_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "fiscal_documents"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "fiscal_transmission_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipt_items: {
        Row: {
          accepted_qty: number
          acquisition_unit_cost: number
          allocated_discount_amount: number
          allocated_expense_amount: number
          base_unit_cost: number
          created_at: string
          goods_receipt_id: string
          id: string
          notes: string | null
          package_unit: string
          product_id: string
          purchase_order_item_id: string | null
          received_package_qty: number
          recoverable_tax_amount: number
          rejected_package_qty: number
          rejected_qty: number
          tenant_id: string
          unit_cost: number
          units_per_package: number
          updated_at: string
        }
        Insert: {
          accepted_qty?: number
          acquisition_unit_cost: number
          allocated_discount_amount?: number
          allocated_expense_amount?: number
          base_unit_cost: number
          created_at?: string
          goods_receipt_id: string
          id?: string
          notes?: string | null
          package_unit?: string
          product_id: string
          purchase_order_item_id?: string | null
          received_package_qty?: number
          recoverable_tax_amount?: number
          rejected_package_qty?: number
          rejected_qty?: number
          tenant_id: string
          unit_cost?: number
          units_per_package?: number
          updated_at?: string
        }
        Update: {
          accepted_qty?: number
          acquisition_unit_cost?: number
          allocated_discount_amount?: number
          allocated_expense_amount?: number
          base_unit_cost?: number
          created_at?: string
          goods_receipt_id?: string
          id?: string
          notes?: string | null
          package_unit?: string
          product_id?: string
          purchase_order_item_id?: string | null
          received_package_qty?: number
          recoverable_tax_amount?: number
          rejected_package_qty?: number
          rejected_qty?: number
          tenant_id?: string
          unit_cost?: number
          units_per_package?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_items_order_item_tenant_fkey"
            columns: ["purchase_order_item_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_items"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "goods_receipt_items_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "goods_receipt_items_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "goods_receipt_items_receipt_tenant_fkey"
            columns: ["goods_receipt_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "goods_receipt_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipts: {
        Row: {
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          discount_amount: number
          freight_amount: number
          id: string
          insurance_amount: number
          invoice_number: string | null
          no_order_reason: string | null
          notes: string | null
          number: number
          other_amount: number
          purchase_order_id: string | null
          received_at: string
          recoverable_tax_amount: number
          reverse_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          status: string
          supplier_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          warehouse_id: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          freight_amount?: number
          id?: string
          insurance_amount?: number
          invoice_number?: string | null
          no_order_reason?: string | null
          notes?: string | null
          number?: number
          other_amount?: number
          purchase_order_id?: string | null
          received_at?: string
          recoverable_tax_amount?: number
          reverse_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          status?: string
          supplier_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          warehouse_id: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          freight_amount?: number
          id?: string
          insurance_amount?: number
          invoice_number?: string | null
          no_order_reason?: string | null
          notes?: string | null
          number?: number
          other_amount?: number
          purchase_order_id?: string | null
          received_at?: string
          recoverable_tax_amount?: number
          reverse_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          status?: string
          supplier_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipts_order_tenant_fkey"
            columns: ["purchase_order_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "goods_receipts_supplier_tenant_fkey"
            columns: ["supplier_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "goods_receipts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_warehouse_tenant_fkey"
            columns: ["warehouse_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      integration_logs: {
        Row: {
          created_at: string
          event_type: string
          external_id: string | null
          id: string
          integration_id: string
          message: string | null
          payload: Json | null
          status: Database["public"]["Enums"]["integration_log_status"]
        }
        Insert: {
          created_at?: string
          event_type: string
          external_id?: string | null
          id?: string
          integration_id: string
          message?: string | null
          payload?: Json | null
          status?: Database["public"]["Enums"]["integration_log_status"]
        }
        Update: {
          created_at?: string
          event_type?: string
          external_id?: string | null
          id?: string
          integration_id?: string
          message?: string | null
          payload?: Json | null
          status?: Database["public"]["Enums"]["integration_log_status"]
        }
        Relationships: [
          {
            foreignKeyName: "integration_logs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_settings: {
        Row: {
          created_at: string
          id: string
          integration_id: string
          is_secret: boolean
          key: string
          updated_at: string
          value_encrypted: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          integration_id: string
          is_secret?: boolean
          key: string
          updated_at?: string
          value_encrypted?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          integration_id?: string
          is_secret?: boolean
          key?: string
          updated_at?: string
          value_encrypted?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_settings_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          active: boolean
          category: Database["public"]["Enums"]["integration_category"]
          created_at: string
          description: string | null
          id: string
          last_sync_at: string | null
          name: string
          slug: string
          status: Database["public"]["Enums"]["integration_status"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          category: Database["public"]["Enums"]["integration_category"]
          created_at?: string
          description?: string | null
          id?: string
          last_sync_at?: string | null
          name: string
          slug: string
          status?: Database["public"]["Enums"]["integration_status"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: Database["public"]["Enums"]["integration_category"]
          created_at?: string
          description?: string | null
          id?: string
          last_sync_at?: string | null
          name?: string
          slug?: string
          status?: Database["public"]["Enums"]["integration_status"]
          updated_at?: string
        }
        Relationships: []
      }
      inventory_closing_items: {
        Row: {
          average_cost: number | null
          closing_id: string
          cost_status: string
          created_at: string
          id: string
          inventory_value: number
          on_hand: number
          product_id: string
          tenant_id: string
          warehouse_id: string
        }
        Insert: {
          average_cost?: number | null
          closing_id: string
          cost_status: string
          created_at?: string
          id?: string
          inventory_value?: number
          on_hand: number
          product_id: string
          tenant_id: string
          warehouse_id: string
        }
        Update: {
          average_cost?: number | null
          closing_id?: string
          cost_status?: string
          created_at?: string
          id?: string
          inventory_value?: number
          on_hand?: number
          product_id?: string
          tenant_id?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_closing_items_closing_id_fkey"
            columns: ["closing_id"]
            isOneToOne: false
            referencedRelation: "inventory_closings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_closing_items_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "inventory_closing_items_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "inventory_closing_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_closings: {
        Row: {
          closed_at: string
          closed_by: string | null
          created_at: string
          id: string
          inventory_value: number
          missing_cost_products: number
          period_date: string
          products_count: number
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          status: string
          tenant_id: string
          units_total: number
        }
        Insert: {
          closed_at?: string
          closed_by?: string | null
          created_at?: string
          id?: string
          inventory_value?: number
          missing_cost_products?: number
          period_date: string
          products_count?: number
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          status?: string
          tenant_id: string
          units_total?: number
        }
        Update: {
          closed_at?: string
          closed_by?: string | null
          created_at?: string
          id?: string
          inventory_value?: number
          missing_cost_products?: number
          period_date?: string
          products_count?: number
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          status?: string
          tenant_id?: string
          units_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_closings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_quarantine: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          product_id: string
          quantity: number
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          return_id: string
          return_item_id: string
          status: string
          tenant_id: string
          warehouse_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_id: string
          quantity: number
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          return_id: string
          return_item_id: string
          status?: string
          tenant_id: string
          warehouse_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_id?: string
          quantity?: number
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          return_id?: string
          return_item_id?: string
          status?: string
          tenant_id?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_quarantine_item_tenant_fkey"
            columns: ["return_item_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "inventory_return_items"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "inventory_quarantine_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "inventory_quarantine_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "inventory_quarantine_return_tenant_fkey"
            columns: ["return_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "inventory_returns"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "inventory_quarantine_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_quarantine_warehouse_tenant_fkey"
            columns: ["warehouse_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      inventory_replenishment_settings: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          lead_time_days: number | null
          max_stock: number | null
          notes: string | null
          preferred_supplier_id: string | null
          product_id: string
          review_period_days: number
          safety_stock: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          lead_time_days?: number | null
          max_stock?: number | null
          notes?: string | null
          preferred_supplier_id?: string | null
          product_id: string
          review_period_days?: number
          safety_stock?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          lead_time_days?: number | null
          max_stock?: number | null
          notes?: string | null
          preferred_supplier_id?: string | null
          product_id?: string
          review_period_days?: number
          safety_stock?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_replenishment_settings_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "inventory_replenishment_settings_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "inventory_replenishment_settings_supplier_tenant_fkey"
            columns: ["preferred_supplier_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "inventory_replenishment_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_return_items: {
        Row: {
          condition: string
          created_at: string
          id: string
          order_item_id: string | null
          replacement_product_id: string | null
          replacement_qty: number
          resolution: string
          return_id: string
          returned_product_id: string
          returned_qty: number
          tenant_id: string
        }
        Insert: {
          condition: string
          created_at?: string
          id?: string
          order_item_id?: string | null
          replacement_product_id?: string | null
          replacement_qty?: number
          resolution: string
          return_id: string
          returned_product_id: string
          returned_qty: number
          tenant_id: string
        }
        Update: {
          condition?: string
          created_at?: string
          id?: string
          order_item_id?: string | null
          replacement_product_id?: string | null
          replacement_qty?: number
          resolution?: string
          return_id?: string
          returned_product_id?: string
          returned_qty?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_return_items_replacement_product_tenant_fkey"
            columns: ["replacement_product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "inventory_return_items_replacement_product_tenant_fkey"
            columns: ["replacement_product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "inventory_return_items_return_tenant_fkey"
            columns: ["return_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "inventory_returns"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "inventory_return_items_returned_product_tenant_fkey"
            columns: ["returned_product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "inventory_return_items_returned_product_tenant_fkey"
            columns: ["returned_product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "inventory_return_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_returns: {
        Row: {
          completed_at: string
          completed_by: string | null
          created_at: string
          created_by: string | null
          id: string
          idempotency_key: string
          notes: string | null
          order_id: string | null
          reason: string
          return_type: string
          status: string
          tenant_id: string
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          completed_at?: string
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key: string
          notes?: string | null
          order_id?: string | null
          reason: string
          return_type: string
          status?: string
          tenant_id: string
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          completed_at?: string
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          idempotency_key?: string
          notes?: string | null
          order_id?: string | null
          reason?: string
          return_type?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_returns_order_tenant_fkey"
            columns: ["order_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "inventory_returns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_returns_warehouse_tenant_fkey"
            columns: ["warehouse_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      manufacturer_catalog_sources: {
        Row: {
          allowed_domains: string[]
          base_url: string
          brand_id: string
          created_at: string
          created_by: string | null
          id: string
          image_usage_note: string | null
          last_error: string | null
          last_sync_at: string | null
          last_verified_at: string | null
          name: string
          priority: number
          search_url_template: string | null
          source_kind: string
          status: string
          supported_fields: string[]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          allowed_domains?: string[]
          base_url: string
          brand_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          image_usage_note?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          last_verified_at?: string | null
          name: string
          priority?: number
          search_url_template?: string | null
          source_kind?: string
          status?: string
          supported_fields?: string[]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          allowed_domains?: string[]
          base_url?: string
          brand_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          image_usage_note?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          last_verified_at?: string | null
          name?: string
          priority?: number
          search_url_template?: string | null
          source_kind?: string
          status?: string
          supported_fields?: string[]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manufacturer_catalog_sources_brand_tenant_fkey"
            columns: ["brand_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "manufacturer_catalog_sources_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturer_code_patterns: {
        Row: {
          active: boolean
          brand_id: string
          code_regex: string
          created_at: string
          created_by: string | null
          examples: string[]
          id: string
          name: string
          normalized_prefix: string | null
          priority: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          brand_id: string
          code_regex: string
          created_at?: string
          created_by?: string | null
          examples?: string[]
          id?: string
          name: string
          normalized_prefix?: string | null
          priority?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          brand_id?: string
          code_regex?: string
          created_at?: string
          created_by?: string | null
          examples?: string[]
          id?: string
          name?: string
          normalized_prefix?: string | null
          priority?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manufacturer_code_patterns_brand_tenant_fkey"
            columns: ["brand_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "manufacturer_code_patterns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      nfe_import_items: {
        Row: {
          cfop: string | null
          created_at: string
          description: string
          discount_amount: number
          divergences: Json
          freight_amount: number
          gtin: string | null
          id: string
          line_number: number
          match_confidence: string
          match_source: string
          ncm: string | null
          nfe_import_id: string
          notes: string | null
          other_amount: number
          product_id: string | null
          purchase_order_item_id: string | null
          qty: number
          supplier_code: string | null
          tenant_id: string
          total_amount: number
          unit: string | null
          unit_value: number
          updated_at: string
        }
        Insert: {
          cfop?: string | null
          created_at?: string
          description: string
          discount_amount?: number
          divergences?: Json
          freight_amount?: number
          gtin?: string | null
          id?: string
          line_number: number
          match_confidence?: string
          match_source?: string
          ncm?: string | null
          nfe_import_id: string
          notes?: string | null
          other_amount?: number
          product_id?: string | null
          purchase_order_item_id?: string | null
          qty?: number
          supplier_code?: string | null
          tenant_id: string
          total_amount?: number
          unit?: string | null
          unit_value?: number
          updated_at?: string
        }
        Update: {
          cfop?: string | null
          created_at?: string
          description?: string
          discount_amount?: number
          divergences?: Json
          freight_amount?: number
          gtin?: string | null
          id?: string
          line_number?: number
          match_confidence?: string
          match_source?: string
          ncm?: string | null
          nfe_import_id?: string
          notes?: string | null
          other_amount?: number
          product_id?: string | null
          purchase_order_item_id?: string | null
          qty?: number
          supplier_code?: string | null
          tenant_id?: string
          total_amount?: number
          unit?: string | null
          unit_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nfe_import_items_import_tenant_fkey"
            columns: ["nfe_import_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "nfe_imports"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "nfe_import_items_order_item_tenant_fkey"
            columns: ["purchase_order_item_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_items"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "nfe_import_items_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "nfe_import_items_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "nfe_import_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      nfe_imports: {
        Row: {
          access_key: string
          cancel_reason: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          divergences: Json
          emitter_address: Json
          emitter_name: string | null
          emitter_state_tax_id: string | null
          emitter_tax_id: string
          emitter_trade_name: string | null
          entered_at: string | null
          file_hash: string
          file_name: string | null
          file_size: number | null
          goods_receipt_id: string | null
          id: string
          imported_by: string | null
          issued_at: string | null
          items_count: number
          nfe_model: string | null
          nfe_number: number | null
          nfe_series: number | null
          nfe_version: string | null
          no_order_reason: string | null
          operation_nature: string | null
          purchase_order_id: string | null
          raw_xml: string | null
          recipient_name: string | null
          recipient_tax_id: string | null
          status: string
          supplier_id: string | null
          tenant_id: string
          total_discount: number
          total_freight: number
          total_invoice: number
          total_products: number
          updated_at: string
          warehouse_id: string | null
        }
        Insert: {
          access_key: string
          cancel_reason?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          divergences?: Json
          emitter_address?: Json
          emitter_name?: string | null
          emitter_state_tax_id?: string | null
          emitter_tax_id: string
          emitter_trade_name?: string | null
          entered_at?: string | null
          file_hash: string
          file_name?: string | null
          file_size?: number | null
          goods_receipt_id?: string | null
          id?: string
          imported_by?: string | null
          issued_at?: string | null
          items_count?: number
          nfe_model?: string | null
          nfe_number?: number | null
          nfe_series?: number | null
          nfe_version?: string | null
          no_order_reason?: string | null
          operation_nature?: string | null
          purchase_order_id?: string | null
          raw_xml?: string | null
          recipient_name?: string | null
          recipient_tax_id?: string | null
          status?: string
          supplier_id?: string | null
          tenant_id: string
          total_discount?: number
          total_freight?: number
          total_invoice?: number
          total_products?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Update: {
          access_key?: string
          cancel_reason?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          divergences?: Json
          emitter_address?: Json
          emitter_name?: string | null
          emitter_state_tax_id?: string | null
          emitter_tax_id?: string
          emitter_trade_name?: string | null
          entered_at?: string | null
          file_hash?: string
          file_name?: string | null
          file_size?: number | null
          goods_receipt_id?: string | null
          id?: string
          imported_by?: string | null
          issued_at?: string | null
          items_count?: number
          nfe_model?: string | null
          nfe_number?: number | null
          nfe_series?: number | null
          nfe_version?: string | null
          no_order_reason?: string | null
          operation_nature?: string | null
          purchase_order_id?: string | null
          raw_xml?: string | null
          recipient_name?: string | null
          recipient_tax_id?: string | null
          status?: string
          supplier_id?: string | null
          tenant_id?: string
          total_discount?: number
          total_freight?: number
          total_invoice?: number
          total_products?: number
          updated_at?: string
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nfe_imports_order_tenant_fkey"
            columns: ["purchase_order_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "nfe_imports_receipt_tenant_fkey"
            columns: ["goods_receipt_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "nfe_imports_supplier_tenant_fkey"
            columns: ["supplier_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "nfe_imports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nfe_imports_warehouse_tenant_fkey"
            columns: ["warehouse_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      order_dispatch_items: {
        Row: {
          created_at: string
          dispatch_id: string
          expected_qty: number
          id: string
          last_scanned_at: string | null
          order_item_id: string
          product_id: string
          scanned_qty: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          dispatch_id: string
          expected_qty: number
          id?: string
          last_scanned_at?: string | null
          order_item_id: string
          product_id: string
          scanned_qty?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          dispatch_id?: string
          expected_qty?: number
          id?: string
          last_scanned_at?: string | null
          order_item_id?: string
          product_id?: string
          scanned_qty?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_dispatch_items_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "order_dispatches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_dispatch_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_dispatch_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_dispatch_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_dispatch_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_dispatch_scans: {
        Row: {
          created_at: string
          dispatch_id: string
          dispatch_item_id: string
          id: string
          product_id: string
          quantity: number
          scanned_code: string
          scanner_name: string
          scanner_user_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          dispatch_id: string
          dispatch_item_id: string
          id?: string
          product_id: string
          quantity?: number
          scanned_code: string
          scanner_name: string
          scanner_user_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          dispatch_id?: string
          dispatch_item_id?: string
          id?: string
          product_id?: string
          quantity?: number
          scanned_code?: string
          scanner_name?: string
          scanner_user_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_dispatch_scans_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "order_dispatches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_dispatch_scans_dispatch_item_id_fkey"
            columns: ["dispatch_item_id"]
            isOneToOne: false
            referencedRelation: "order_dispatch_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_dispatch_scans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_dispatch_scans_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "order_dispatch_scans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_dispatches: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          completed_by_name: string | null
          created_at: string
          id: string
          order_id: string
          started_at: string | null
          started_by: string | null
          started_by_name: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          completed_by_name?: string | null
          created_at?: string
          id?: string
          order_id: string
          started_at?: string | null
          started_by?: string | null
          started_by_name?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          completed_by_name?: string | null
          created_at?: string
          id?: string
          order_id?: string
          started_at?: string | null
          started_by?: string | null
          started_by_name?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_dispatches_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_dispatches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          discount_amount: number
          id: string
          list_price: number
          name: string
          order_id: string
          price_discount_pct: number
          price_table: string | null
          product_id: string | null
          quantity: number
          sku: string
          tenant_id: string
          total: number
          unit_price: number
        }
        Insert: {
          discount_amount?: number
          id?: string
          list_price?: number
          name: string
          order_id: string
          price_discount_pct?: number
          price_table?: string | null
          product_id?: string | null
          quantity: number
          sku: string
          tenant_id: string
          total: number
          unit_price: number
        }
        Update: {
          discount_amount?: number
          id?: string
          list_price?: number
          name?: string
          order_id?: string
          price_discount_pct?: number
          price_table?: string | null
          product_id?: string | null
          quantity?: number
          sku?: string
          tenant_id?: string
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_tenant_fkey"
            columns: ["order_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "order_items_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "order_items_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["order_status"] | null
          id: number
          note: string | null
          order_id: string
          tenant_id: string
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: never
          note?: string | null
          order_id: string
          tenant_id: string
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: never
          note?: string | null
          order_id?: string
          tenant_id?: string
          to_status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: [
          {
            foreignKeyName: "order_status_events_order_tenant_fkey"
            columns: ["order_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "order_status_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          b2b_price_discount_pct: number
          b2b_price_table: string | null
          bling_id: string | null
          bling_number: string | null
          created_at: string
          customer_document: string | null
          customer_email: string
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          deleted_at: string | null
          discount: number
          id: string
          idempotency_key: string | null
          is_b2b: boolean
          notes: string | null
          payment_method: string | null
          shipping: number
          shipping_city: string | null
          shipping_complement: string | null
          shipping_neighborhood: string | null
          shipping_number: string | null
          shipping_state: string | null
          shipping_street: string | null
          shipping_zip: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          tenant_id: string
          total: number
          updated_at: string
          user_id: string
        }
        Insert: {
          b2b_price_discount_pct?: number
          b2b_price_table?: string | null
          bling_id?: string | null
          bling_number?: string | null
          created_at?: string
          customer_document?: string | null
          customer_email: string
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          deleted_at?: string | null
          discount?: number
          id?: string
          idempotency_key?: string | null
          is_b2b?: boolean
          notes?: string | null
          payment_method?: string | null
          shipping?: number
          shipping_city?: string | null
          shipping_complement?: string | null
          shipping_neighborhood?: string | null
          shipping_number?: string | null
          shipping_state?: string | null
          shipping_street?: string | null
          shipping_zip?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          tenant_id: string
          total?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          b2b_price_discount_pct?: number
          b2b_price_table?: string | null
          bling_id?: string | null
          bling_number?: string | null
          created_at?: string
          customer_document?: string | null
          customer_email?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          deleted_at?: string | null
          discount?: number
          id?: string
          idempotency_key?: string | null
          is_b2b?: boolean
          notes?: string | null
          payment_method?: string | null
          shipping?: number
          shipping_city?: string | null
          shipping_complement?: string | null
          shipping_neighborhood?: string | null
          shipping_number?: string | null
          shipping_state?: string | null
          shipping_street?: string | null
          shipping_zip?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          tenant_id?: string
          total?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_tenant_fkey"
            columns: ["customer_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          active: boolean
          created_at: string
          id: string
          organization_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          organization_id: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          organization_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          legal_name: string
          slug: string
          status: string
          tax_id: string | null
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          legal_name: string
          slug: string
          status?: string
          tax_id?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          legal_name?: string
          slug?: string
          status?: string
          tax_id?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      payment_intents: {
        Row: {
          amount: number
          authorized_at: string | null
          boleto_barcode: string | null
          boleto_url: string | null
          cancelled_at: string | null
          checkout_url: string | null
          client_reference: string | null
          created_at: string
          currency: string
          expires_at: string | null
          external_id: string | null
          failure_code: string | null
          failure_message: string | null
          id: string
          idempotency_key: string
          method: string
          order_id: string
          paid_at: string | null
          pix_copy_paste: string | null
          pix_qr_code_url: string | null
          provider_id: string
          provider_metadata: Json
          status: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          authorized_at?: string | null
          boleto_barcode?: string | null
          boleto_url?: string | null
          cancelled_at?: string | null
          checkout_url?: string | null
          client_reference?: string | null
          created_at?: string
          currency?: string
          expires_at?: string | null
          external_id?: string | null
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          idempotency_key: string
          method: string
          order_id: string
          paid_at?: string | null
          pix_copy_paste?: string | null
          pix_qr_code_url?: string | null
          provider_id: string
          provider_metadata?: Json
          status?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          authorized_at?: string | null
          boleto_barcode?: string | null
          boleto_url?: string | null
          cancelled_at?: string | null
          checkout_url?: string | null
          client_reference?: string | null
          created_at?: string
          currency?: string
          expires_at?: string | null
          external_id?: string | null
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          idempotency_key?: string
          method?: string
          order_id?: string
          paid_at?: string | null
          pix_copy_paste?: string | null
          pix_qr_code_url?: string | null
          provider_id?: string
          provider_metadata?: Json
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_order_tenant_fkey"
            columns: ["order_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "payment_intents_provider_tenant_fkey"
            columns: ["provider_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "payment_providers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "payment_intents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_providers: {
        Row: {
          active: boolean
          adapter_key: string
          capabilities: Json
          code: string
          created_at: string
          display_name: string
          environment: string
          id: string
          priority: number
          supported_methods: string[]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          adapter_key: string
          capabilities?: Json
          code: string
          created_at?: string
          display_name: string
          environment: string
          id?: string
          priority?: number
          supported_methods?: string[]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          adapter_key?: string
          capabilities?: Json
          code?: string
          created_at?: string
          display_name?: string
          environment?: string
          id?: string
          priority?: number
          supported_methods?: string[]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_providers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_refunds: {
        Row: {
          amount: number
          created_at: string
          external_id: string | null
          id: string
          idempotency_key: string
          payment_intent_id: string
          processed_at: string | null
          provider_metadata: Json
          reason: string
          requested_by: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          external_id?: string | null
          id?: string
          idempotency_key: string
          payment_intent_id: string
          processed_at?: string | null
          provider_metadata?: Json
          reason: string
          requested_by?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          external_id?: string | null
          id?: string
          idempotency_key?: string
          payment_intent_id?: string
          processed_at?: string | null
          provider_metadata?: Json
          reason?: string
          requested_by?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_refunds_intent_tenant_fkey"
            columns: ["payment_intent_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "payment_refunds_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_cash_movements: {
        Row: {
          amount: number
          cash_session_id: string
          created_at: string
          id: string
          operator_id: string
          reason: string
          tenant_id: string
          type: string
        }
        Insert: {
          amount: number
          cash_session_id: string
          created_at?: string
          id?: string
          operator_id: string
          reason: string
          tenant_id: string
          type: string
        }
        Update: {
          amount?: number
          cash_session_id?: string
          created_at?: string
          id?: string
          operator_id?: string
          reason?: string
          tenant_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_cash_movements_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "pos_cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_cash_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_cash_sessions: {
        Row: {
          branch_id: string
          closed_at: string | null
          counted_amount: number | null
          created_at: string
          difference_amount: number | null
          expected_amount: number | null
          id: string
          notes: string | null
          opened_at: string
          opening_amount: number
          operator_id: string
          status: string
          tenant_id: string
          terminal_code: string
          warehouse_id: string
        }
        Insert: {
          branch_id: string
          closed_at?: string | null
          counted_amount?: number | null
          created_at?: string
          difference_amount?: number | null
          expected_amount?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opening_amount?: number
          operator_id: string
          status?: string
          tenant_id: string
          terminal_code: string
          warehouse_id: string
        }
        Update: {
          branch_id?: string
          closed_at?: string | null
          counted_amount?: number | null
          created_at?: string
          difference_amount?: number | null
          expected_amount?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opening_amount?: number
          operator_id?: string
          status?: string
          tenant_id?: string
          terminal_code?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_cash_sessions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_cash_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_cash_sessions_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          installments: number
          method: string
          provider: string | null
          provider_reference: string | null
          sale_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          installments?: number
          method: string
          provider?: string | null
          provider_reference?: string | null
          sale_id: string
          status?: string
          tenant_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          installments?: number
          method?: string
          provider?: string | null
          provider_reference?: string | null
          sale_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_sale_items: {
        Row: {
          id: string
          line_total: number
          product_id: string
          quantity: number
          sale_id: string
          tenant_id: string
          unit_price: number
        }
        Insert: {
          id?: string
          line_total: number
          product_id: string
          quantity: number
          sale_id: string
          tenant_id: string
          unit_price: number
        }
        Update: {
          id?: string
          line_total?: number
          product_id?: string
          quantity?: number
          sale_id?: string
          tenant_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "pos_sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "pos_sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "pos_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sale_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_sales: {
        Row: {
          cancelled_at: string | null
          cash_session_id: string
          created_at: string
          customer_id: string | null
          discount_amount: number
          fiscal_document_id: string | null
          fiscal_status: string
          id: string
          idempotency_key: string
          operator_id: string
          status: string
          subtotal: number
          tenant_id: string
          total: number
          warehouse_id: string
        }
        Insert: {
          cancelled_at?: string | null
          cash_session_id: string
          created_at?: string
          customer_id?: string | null
          discount_amount?: number
          fiscal_document_id?: string | null
          fiscal_status?: string
          id?: string
          idempotency_key: string
          operator_id: string
          status?: string
          subtotal: number
          tenant_id: string
          total: number
          warehouse_id: string
        }
        Update: {
          cancelled_at?: string | null
          cash_session_id?: string
          created_at?: string
          customer_id?: string | null
          discount_amount?: number
          fiscal_document_id?: string | null
          fiscal_status?: string
          id?: string
          idempotency_key?: string
          operator_id?: string
          status?: string
          subtotal?: number
          tenant_id?: string
          total?: number
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_sales_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "pos_cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_sales_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      product_applications: {
        Row: {
          id: string
          notes: string | null
          product_id: string
          tenant_id: string
          vehicle_make: string
          vehicle_model: string
          year_from: number | null
          year_to: number | null
        }
        Insert: {
          id?: string
          notes?: string | null
          product_id: string
          tenant_id: string
          vehicle_make: string
          vehicle_model: string
          year_from?: number | null
          year_to?: number | null
        }
        Update: {
          id?: string
          notes?: string | null
          product_id?: string
          tenant_id?: string
          vehicle_make?: string
          vehicle_model?: string
          year_from?: number | null
          year_to?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_applications_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "product_applications_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "product_applications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_code_normalization_audit: {
        Row: {
          created_at: string | null
          id: string
          normalized_at: string
          original_internal_code: string | null
          original_manufacturer_code: string | null
          original_name: string
          original_sku: string | null
          product_id: string
          proposed_internal_code: string | null
          proposed_manufacturer_code: string | null
          proposed_name: string | null
          reason: string | null
          review_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          normalized_at?: string
          original_internal_code?: string | null
          original_manufacturer_code?: string | null
          original_name: string
          original_sku?: string | null
          product_id: string
          proposed_internal_code?: string | null
          proposed_manufacturer_code?: string | null
          proposed_name?: string | null
          reason?: string | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          normalized_at?: string
          original_internal_code?: string | null
          original_manufacturer_code?: string | null
          original_name?: string
          original_sku?: string | null
          product_id?: string
          proposed_internal_code?: string | null
          proposed_manufacturer_code?: string | null
          proposed_name?: string | null
          reason?: string | null
          review_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_code_normalization_audit_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_code_normalization_audit_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id"]
          },
        ]
      }
      product_cost_candidates: {
        Row: {
          confidence: string
          created_at: string
          created_by: string | null
          current_price: number | null
          evidence: Json
          id: string
          notes: string | null
          product_id: string
          projected_margin_rate: number | null
          proposed_cost: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_date: string | null
          source_reference: string | null
          source_type: string
          status: string
          suggested_price: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          confidence?: string
          created_at?: string
          created_by?: string | null
          current_price?: number | null
          evidence?: Json
          id?: string
          notes?: string | null
          product_id: string
          projected_margin_rate?: number | null
          proposed_cost?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_date?: string | null
          source_reference?: string | null
          source_type: string
          status?: string
          suggested_price?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          confidence?: string
          created_at?: string
          created_by?: string | null
          current_price?: number | null
          evidence?: Json
          id?: string
          notes?: string | null
          product_id?: string
          projected_margin_rate?: number | null
          proposed_cost?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_date?: string | null
          source_reference?: string | null
          source_type?: string
          status?: string
          suggested_price?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_cost_candidates_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "product_cost_candidates_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "product_cost_candidates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_cost_history: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          new_average_cost: number | null
          new_last_cost: number | null
          previous_average_cost: number | null
          previous_last_cost: number | null
          product_id: string
          qty: number
          reference_id: string | null
          source: string
          tenant_id: string
          unit_cost: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          new_average_cost?: number | null
          new_last_cost?: number | null
          previous_average_cost?: number | null
          previous_last_cost?: number | null
          product_id: string
          qty?: number
          reference_id?: string | null
          source: string
          tenant_id: string
          unit_cost?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          new_average_cost?: number | null
          new_last_cost?: number | null
          previous_average_cost?: number | null
          previous_last_cost?: number | null
          product_id?: string
          qty?: number
          reference_id?: string | null
          source?: string
          tenant_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_cost_history_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "product_cost_history_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "product_cost_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_enrichment_candidates: {
        Row: {
          confidence: number
          created_at: string
          created_by: string | null
          id: string
          image_url: string | null
          job_id: string
          license_name: string | null
          license_url: string | null
          match_reasons: Json
          product_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_name: string | null
          source_type: string
          source_url: string
          specifications: Json
          status: string
          storage_url: string | null
          suggested_description: string | null
          suggested_gtin: string | null
          suggested_manufacturer_code: string | null
          suggested_name: string | null
          suggested_short_description: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          created_by?: string | null
          id?: string
          image_url?: string | null
          job_id: string
          license_name?: string | null
          license_url?: string | null
          match_reasons?: Json
          product_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_name?: string | null
          source_type: string
          source_url: string
          specifications?: Json
          status?: string
          storage_url?: string | null
          suggested_description?: string | null
          suggested_gtin?: string | null
          suggested_manufacturer_code?: string | null
          suggested_name?: string | null
          suggested_short_description?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          confidence?: number
          created_at?: string
          created_by?: string | null
          id?: string
          image_url?: string | null
          job_id?: string
          license_name?: string | null
          license_url?: string | null
          match_reasons?: Json
          product_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_name?: string | null
          source_type?: string
          source_url?: string
          specifications?: Json
          status?: string
          storage_url?: string | null
          suggested_description?: string | null
          suggested_gtin?: string | null
          suggested_manufacturer_code?: string | null
          suggested_name?: string | null
          suggested_short_description?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_enrichment_candidates_job_tenant_fkey"
            columns: ["job_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "product_enrichment_jobs"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "product_enrichment_candidates_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "product_enrichment_candidates_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "product_enrichment_candidates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_enrichment_jobs: {
        Row: {
          approved_by: string | null
          attempts: number
          created_at: string
          created_by: string | null
          finished_at: string | null
          id: string
          last_error: string | null
          product_id: string
          scheduled_at: string
          search_query: string | null
          started_at: string | null
          status: string
          tenant_id: string
          trigger_source: string
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          attempts?: number
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          product_id: string
          scheduled_at?: string
          search_query?: string | null
          started_at?: string | null
          status?: string
          tenant_id: string
          trigger_source?: string
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          attempts?: number
          created_at?: string
          created_by?: string | null
          finished_at?: string | null
          id?: string
          last_error?: string | null
          product_id?: string
          scheduled_at?: string
          search_query?: string | null
          started_at?: string | null
          status?: string
          tenant_id?: string
          trigger_source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_enrichment_jobs_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "product_enrichment_jobs_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "product_enrichment_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_fiscal_profiles: {
        Row: {
          cbs_classification: string | null
          cbs_cst: string | null
          cbs_rate: number
          cest: string | null
          cfop_in_state: string | null
          cfop_out_state: string | null
          cofins_cst: string | null
          cofins_rate: number
          created_at: string
          created_by: string | null
          ibs_classification: string | null
          ibs_cst: string | null
          ibs_rate: number
          icms_csosn: string | null
          icms_cst: string | null
          icms_rate: number
          id: string
          ncm: string
          notes: string | null
          origin: number
          pis_cst: string | null
          pis_rate: number
          product_id: string
          tax_benefit_code: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cbs_classification?: string | null
          cbs_cst?: string | null
          cbs_rate?: number
          cest?: string | null
          cfop_in_state?: string | null
          cfop_out_state?: string | null
          cofins_cst?: string | null
          cofins_rate?: number
          created_at?: string
          created_by?: string | null
          ibs_classification?: string | null
          ibs_cst?: string | null
          ibs_rate?: number
          icms_csosn?: string | null
          icms_cst?: string | null
          icms_rate?: number
          id?: string
          ncm: string
          notes?: string | null
          origin?: number
          pis_cst?: string | null
          pis_rate?: number
          product_id: string
          tax_benefit_code?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cbs_classification?: string | null
          cbs_cst?: string | null
          cbs_rate?: number
          cest?: string | null
          cfop_in_state?: string | null
          cfop_out_state?: string | null
          cofins_cst?: string | null
          cofins_rate?: number
          created_at?: string
          created_by?: string | null
          ibs_classification?: string | null
          ibs_cst?: string | null
          ibs_rate?: number
          icms_csosn?: string | null
          icms_cst?: string | null
          icms_rate?: number
          id?: string
          ncm?: string
          notes?: string | null
          origin?: number
          pis_cst?: string | null
          pis_rate?: number
          product_id?: string
          tax_benefit_code?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_fiscal_profiles_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "product_fiscal_profiles_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "product_fiscal_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          alt: string | null
          id: string
          is_primary: boolean
          product_id: string
          sort_order: number
          tenant_id: string
          url: string
        }
        Insert: {
          alt?: string | null
          id?: string
          is_primary?: boolean
          product_id: string
          sort_order?: number
          tenant_id: string
          url: string
        }
        Update: {
          alt?: string | null
          id?: string
          is_primary?: boolean
          product_id?: string
          sort_order?: number
          tenant_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "product_images_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "product_images_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_pricing_settings: {
        Row: {
          commission_rate: number
          created_at: string
          created_by: string | null
          desired_margin_rate: number
          fixed_cost_per_unit: number
          id: string
          other_variable_rate: number
          payment_fee_rate: number
          price_rounding: string
          product_id: string
          tax_rate: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          commission_rate?: number
          created_at?: string
          created_by?: string | null
          desired_margin_rate?: number
          fixed_cost_per_unit?: number
          id?: string
          other_variable_rate?: number
          payment_fee_rate?: number
          price_rounding?: string
          product_id: string
          tax_rate?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          commission_rate?: number
          created_at?: string
          created_by?: string | null
          desired_margin_rate?: number
          fixed_cost_per_unit?: number
          id?: string
          other_variable_rate?: number
          payment_fee_rate?: number
          price_rounding?: string
          product_id?: string
          tax_rate?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_pricing_settings_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "product_pricing_settings_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "product_pricing_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_stock: {
        Row: {
          id: string
          min_stock: number
          on_hand: number
          product_id: string
          reserved: number
          tenant_id: string
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          id?: string
          min_stock?: number
          on_hand?: number
          product_id: string
          reserved?: number
          tenant_id: string
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          id?: string
          min_stock?: number
          on_hand?: number
          product_id?: string
          reserved?: number
          tenant_id?: string
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_stock_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "product_stock_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "product_stock_warehouse_tenant_fkey"
            columns: ["warehouse_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          average_cost: number | null
          bling_id: string | null
          brand_id: string | null
          category_id: string | null
          compare_at_price: number | null
          created_at: string
          deleted_at: string | null
          description: string | null
          featured: boolean
          gtin: string | null
          hide_when_out_of_stock: boolean
          id: string
          internal_code: string | null
          is_bestseller: boolean
          is_new: boolean
          is_offer: boolean
          last_purchase_at: string | null
          last_purchase_cost: number | null
          manufacturer_code: string | null
          min_stock: number
          name: string
          price_b2b: number | null
          price_b2c: number
          sale_ends_at: string | null
          sale_price_b2c: number | null
          sale_starts_at: string | null
          sales_count: number
          short_description: string | null
          sku: string
          slug: string
          stock: number
          subcategory_id: string | null
          tenant_id: string
          updated_at: string
          weight_kg: number | null
        }
        Insert: {
          active?: boolean
          average_cost?: number | null
          bling_id?: string | null
          brand_id?: string | null
          category_id?: string | null
          compare_at_price?: number | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          featured?: boolean
          gtin?: string | null
          hide_when_out_of_stock?: boolean
          id?: string
          internal_code?: string | null
          is_bestseller?: boolean
          is_new?: boolean
          is_offer?: boolean
          last_purchase_at?: string | null
          last_purchase_cost?: number | null
          manufacturer_code?: string | null
          min_stock?: number
          name: string
          price_b2b?: number | null
          price_b2c?: number
          sale_ends_at?: string | null
          sale_price_b2c?: number | null
          sale_starts_at?: string | null
          sales_count?: number
          short_description?: string | null
          sku: string
          slug: string
          stock?: number
          subcategory_id?: string | null
          tenant_id: string
          updated_at?: string
          weight_kg?: number | null
        }
        Update: {
          active?: boolean
          average_cost?: number | null
          bling_id?: string | null
          brand_id?: string | null
          category_id?: string | null
          compare_at_price?: number | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          featured?: boolean
          gtin?: string | null
          hide_when_out_of_stock?: boolean
          id?: string
          internal_code?: string | null
          is_bestseller?: boolean
          is_new?: boolean
          is_offer?: boolean
          last_purchase_at?: string | null
          last_purchase_cost?: number | null
          manufacturer_code?: string | null
          min_stock?: number
          name?: string
          price_b2b?: number | null
          price_b2c?: number
          sale_ends_at?: string | null
          sale_price_b2c?: number | null
          sale_starts_at?: string | null
          sales_count?: number
          short_description?: string | null
          sku?: string
          slug?: string
          stock?: number
          subcategory_id?: string | null
          tenant_id?: string
          updated_at?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_tenant_fkey"
            columns: ["brand_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "products_category_tenant_fkey"
            columns: ["category_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "products_subcategory_tenant_fkey"
            columns: ["subcategory_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          b2b_status: Database["public"]["Enums"]["b2b_approval_status"]
          created_at: string
          customer_group: Database["public"]["Enums"]["customer_group"]
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          b2b_status?: Database["public"]["Enums"]["b2b_approval_status"]
          created_at?: string
          customer_group?: Database["public"]["Enums"]["customer_group"]
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          b2b_status?: Database["public"]["Enums"]["b2b_approval_status"]
          created_at?: string
          customer_group?: Database["public"]["Enums"]["customer_group"]
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      promotions: {
        Row: {
          active: boolean
          brand_id: string | null
          category_id: string | null
          created_at: string
          customer_group: string | null
          description: string | null
          discount_type: Database["public"]["Enums"]["discount_type"]
          discount_value: number
          ends_at: string | null
          id: string
          name: string
          product_id: string | null
          promotion_type: Database["public"]["Enums"]["promotion_type"]
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          brand_id?: string | null
          category_id?: string | null
          created_at?: string
          customer_group?: string | null
          description?: string | null
          discount_type: Database["public"]["Enums"]["discount_type"]
          discount_value: number
          ends_at?: string | null
          id?: string
          name: string
          product_id?: string | null
          promotion_type: Database["public"]["Enums"]["promotion_type"]
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          brand_id?: string | null
          category_id?: string | null
          created_at?: string
          customer_group?: string | null
          description?: string | null
          discount_type?: Database["public"]["Enums"]["discount_type"]
          discount_value?: number
          ends_at?: string | null
          id?: string
          name?: string
          product_id?: string | null
          promotion_type?: Database["public"]["Enums"]["promotion_type"]
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          created_at: string
          discount_amount: number
          id: string
          line_total: number
          notes: string | null
          ordered_qty: number
          product_id: string
          purchase_order_id: string
          received_qty: number
          tax_amount: number
          tenant_id: string
          unit_cost: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          discount_amount?: number
          id?: string
          line_total?: number
          notes?: string | null
          ordered_qty: number
          product_id: string
          purchase_order_id: string
          received_qty?: number
          tax_amount?: number
          tenant_id: string
          unit_cost?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          discount_amount?: number
          id?: string
          line_total?: number
          notes?: string | null
          ordered_qty?: number
          product_id?: string
          purchase_order_id?: string
          received_qty?: number
          tax_amount?: number
          tenant_id?: string
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_order_tenant_fkey"
            columns: ["purchase_order_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "purchase_order_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          created_by: string | null
          discount_amount: number
          expected_at: string | null
          freight_amount: number
          id: string
          issued_at: string
          items_total: number
          notes: string | null
          number: number
          other_amount: number
          payment_terms: string | null
          sent_at: string | null
          status: string
          supplier_id: string
          tenant_id: string
          total_amount: number
          updated_at: string
          updated_by: string | null
          warehouse_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          expected_at?: string | null
          freight_amount?: number
          id?: string
          issued_at?: string
          items_total?: number
          notes?: string | null
          number?: number
          other_amount?: number
          payment_terms?: string | null
          sent_at?: string | null
          status?: string
          supplier_id: string
          tenant_id: string
          total_amount?: number
          updated_at?: string
          updated_by?: string | null
          warehouse_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          created_by?: string | null
          discount_amount?: number
          expected_at?: string | null
          freight_amount?: number
          id?: string
          issued_at?: string
          items_total?: number
          notes?: string | null
          number?: number
          other_amount?: number
          payment_terms?: string | null
          sent_at?: string | null
          status?: string
          supplier_id?: string
          tenant_id?: string
          total_amount?: number
          updated_at?: string
          updated_by?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_supplier_tenant_fkey"
            columns: ["supplier_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "purchase_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_warehouse_tenant_fkey"
            columns: ["warehouse_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      quote_items: {
        Row: {
          created_at: string
          discount: number
          id: string
          name: string
          notes: string | null
          product_id: string | null
          qty: number
          quote_id: string
          sku: string | null
          tenant_id: string
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          discount?: number
          id?: string
          name: string
          notes?: string | null
          product_id?: string | null
          qty: number
          quote_id: string
          sku?: string | null
          tenant_id: string
          total: number
          unit_price: number
        }
        Update: {
          created_at?: string
          discount?: number
          id?: string
          name?: string
          notes?: string | null
          product_id?: string | null
          qty?: number
          quote_id?: string
          sku?: string | null
          tenant_id?: string
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "quote_items_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "quote_items_quote_tenant_fkey"
            columns: ["quote_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "quote_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          branch_id: string | null
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          customer_notes: string | null
          customer_phone: string | null
          deleted_at: string | null
          discount: number
          id: string
          internal_notes: string | null
          number: number
          origin: Database["public"]["Enums"]["quote_origin"]
          sales_rep_id: string | null
          status: Database["public"]["Enums"]["quote_status"]
          subtotal: number
          tenant_id: string
          total: number
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_notes?: string | null
          customer_phone?: string | null
          deleted_at?: string | null
          discount?: number
          id?: string
          internal_notes?: string | null
          number?: number
          origin?: Database["public"]["Enums"]["quote_origin"]
          sales_rep_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal?: number
          tenant_id: string
          total?: number
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_notes?: string | null
          customer_phone?: string | null
          deleted_at?: string | null
          discount?: number
          id?: string
          internal_notes?: string | null
          number?: number
          origin?: Database["public"]["Enums"]["quote_origin"]
          sales_rep_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal?: number
          tenant_id?: string
          total?: number
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_branch_tenant_fkey"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "quotes_customer_tenant_fkey"
            columns: ["customer_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "quotes_sales_rep_tenant_fkey"
            columns: ["sales_rep_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "quotes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_orders: {
        Row: {
          created_at: string
          customer_id: string | null
          discount: number
          id: string
          idempotency_key: string | null
          items: Json
          lead_cnpj: string | null
          lead_email: string | null
          lead_name: string | null
          lead_phone: string | null
          notes: string | null
          order_id: string | null
          price_uplift_pct: number
          rep_id: string
          seller_credit_earned: number
          seller_credit_gross_amount: number
          seller_credit_tax_amount: number
          seller_credit_used: number
          status: string
          subtotal: number
          tenant_id: string
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          discount?: number
          id?: string
          idempotency_key?: string | null
          items?: Json
          lead_cnpj?: string | null
          lead_email?: string | null
          lead_name?: string | null
          lead_phone?: string | null
          notes?: string | null
          order_id?: string | null
          price_uplift_pct?: number
          rep_id: string
          seller_credit_earned?: number
          seller_credit_gross_amount?: number
          seller_credit_tax_amount?: number
          seller_credit_used?: number
          status?: string
          subtotal?: number
          tenant_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          discount?: number
          id?: string
          idempotency_key?: string | null
          items?: Json
          lead_cnpj?: string | null
          lead_email?: string | null
          lead_name?: string | null
          lead_phone?: string | null
          notes?: string | null
          order_id?: string | null
          price_uplift_pct?: number
          rep_id?: string
          seller_credit_earned?: number
          seller_credit_gross_amount?: number
          seller_credit_tax_amount?: number
          seller_credit_used?: number
          status?: string
          subtotal?: number
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_orders_customer_tenant_fkey"
            columns: ["customer_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "sales_orders_order_tenant_fkey"
            columns: ["order_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "sales_orders_rep_tenant_fkey"
            columns: ["rep_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "sales_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_rep_customers: {
        Row: {
          created_at: string
          customer_id: string | null
          id: string
          lead_cnpj: string | null
          lead_email: string | null
          lead_name: string | null
          lead_phone: string | null
          notes: string | null
          rep_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          id?: string
          lead_cnpj?: string | null
          lead_email?: string | null
          lead_name?: string | null
          lead_phone?: string | null
          notes?: string | null
          rep_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          id?: string
          lead_cnpj?: string | null
          lead_email?: string | null
          lead_name?: string | null
          lead_phone?: string | null
          notes?: string | null
          rep_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_rep_customers_customer_tenant_fkey"
            columns: ["customer_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "sales_rep_customers_rep_tenant_fkey"
            columns: ["rep_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "sales_rep_customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_reps: {
        Row: {
          activated_at: string | null
          active: boolean
          can_create_customer: boolean
          can_sell_b2b: boolean
          commission_pct: number
          created_at: string
          email: string
          full_name: string
          id: string
          invited_at: string
          invited_by: string | null
          max_discount_pct: number
          notes: string | null
          phone: string | null
          tenant_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          activated_at?: string | null
          active?: boolean
          can_create_customer?: boolean
          can_sell_b2b?: boolean
          commission_pct?: number
          created_at?: string
          email: string
          full_name: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          max_discount_pct?: number
          notes?: string | null
          phone?: string | null
          tenant_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          activated_at?: string | null
          active?: boolean
          can_create_customer?: boolean
          can_sell_b2b?: boolean
          commission_pct?: number
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          max_discount_pct?: number
          notes?: string | null
          phone?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_reps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      search_aliases: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          normalized_term: string
          target_id: string | null
          target_label: string | null
          target_slug: string | null
          target_type: string
          term: string
          updated_at: string
          weight: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          normalized_term: string
          target_id?: string | null
          target_label?: string | null
          target_slug?: string | null
          target_type: string
          term: string
          updated_at?: string
          weight?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          normalized_term?: string
          target_id?: string | null
          target_label?: string | null
          target_slug?: string | null
          target_type?: string
          term?: string
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      search_no_result_logs: {
        Row: {
          created_at: string
          id: string
          matched_alias: string | null
          matched_brand: string | null
          matched_category: string | null
          normalized_term: string
          origin: string
          results_count: number
          term: string
        }
        Insert: {
          created_at?: string
          id?: string
          matched_alias?: string | null
          matched_brand?: string | null
          matched_category?: string | null
          normalized_term: string
          origin?: string
          results_count?: number
          term: string
        }
        Update: {
          created_at?: string
          id?: string
          matched_alias?: string | null
          matched_brand?: string | null
          matched_category?: string | null
          normalized_term?: string
          origin?: string
          results_count?: number
          term?: string
        }
        Relationships: []
      }
      seller_commission_periods: {
        Row: {
          calculated_at: string
          calculated_by: string | null
          commission_amount: number
          created_at: string
          eligible_order_count: number
          eligible_pos_count: number
          eligible_sales: number
          id: string
          period_month: string
          pos_sales_amount: number
          previous_three_months_average: number
          rate_pct: number
          rep_id: string
          sales_order_amount: number
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          calculated_at?: string
          calculated_by?: string | null
          commission_amount?: number
          created_at?: string
          eligible_order_count?: number
          eligible_pos_count?: number
          eligible_sales?: number
          id?: string
          period_month: string
          pos_sales_amount?: number
          previous_three_months_average?: number
          rate_pct?: number
          rep_id: string
          sales_order_amount?: number
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          calculated_at?: string
          calculated_by?: string | null
          commission_amount?: number
          created_at?: string
          eligible_order_count?: number
          eligible_pos_count?: number
          eligible_sales?: number
          id?: string
          period_month?: string
          pos_sales_amount?: number
          previous_three_months_average?: number
          rate_pct?: number
          rep_id?: string
          sales_order_amount?: number
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_commission_periods_rep_tenant_fkey"
            columns: ["rep_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "seller_commission_periods_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_commission_settings: {
        Row: {
          average_months: number
          baseline_rate_pct: number
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          outperform_rate_pct: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          average_months?: number
          baseline_rate_pct?: number
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          outperform_rate_pct?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          average_months?: number
          baseline_rate_pct?: number
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          outperform_rate_pct?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seller_commission_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_credit_ledger: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          description: string
          entry_type: string
          gross_amount: number
          id: string
          idempotency_key: string
          rep_id: string
          source_order_id: string | null
          tax_amount: number
          tenant_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          description: string
          entry_type: string
          gross_amount?: number
          id?: string
          idempotency_key?: string
          rep_id: string
          source_order_id?: string | null
          tax_amount?: number
          tenant_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          description?: string
          entry_type?: string
          gross_amount?: number
          id?: string
          idempotency_key?: string
          rep_id?: string
          source_order_id?: string | null
          tax_amount?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_credit_ledger_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_credit_ledger_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_credit_ledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_credit_settings: {
        Row: {
          created_at: string
          enabled: boolean
          max_credit_use_pct: number
          max_uplift_pct: number
          tax_rate_pct: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          max_credit_use_pct?: number
          max_uplift_pct?: number
          tax_rate_pct?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          max_credit_use_pct?: number
          max_uplift_pct?: number
          tax_rate_pct?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seller_credit_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_goals: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          period_month: string
          rep_id: string
          target_amount: number
          target_units: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          period_month: string
          rep_id: string
          target_amount?: number
          target_units?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          period_month?: string
          rep_id?: string
          target_amount?: number
          target_units?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "seller_goals_rep_tenant_fkey"
            columns: ["rep_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "seller_goals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          description: string
          event_type: string
          from_status: string | null
          id: number
          metadata: Json
          shipment_id: string
          tenant_id: string
          to_status: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          description: string
          event_type: string
          from_status?: string | null
          id?: never
          metadata?: Json
          shipment_id: string
          tenant_id: string
          to_status?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          description?: string
          event_type?: string
          from_status?: string | null
          id?: never
          metadata?: Json
          shipment_id?: string
          tenant_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipment_events_shipment_tenant_fkey"
            columns: ["shipment_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "shipment_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_packages: {
        Row: {
          created_at: string
          height_cm: number
          id: string
          length_cm: number
          sequence: number
          shipment_id: string
          tenant_id: string
          updated_at: string
          weight_kg: number
          width_cm: number
        }
        Insert: {
          created_at?: string
          height_cm: number
          id?: string
          length_cm: number
          sequence?: number
          shipment_id: string
          tenant_id: string
          updated_at?: string
          weight_kg: number
          width_cm: number
        }
        Update: {
          created_at?: string
          height_cm?: number
          id?: string
          length_cm?: number
          sequence?: number
          shipment_id?: string
          tenant_id?: string
          updated_at?: string
          weight_kg?: number
          width_cm?: number
        }
        Relationships: [
          {
            foreignKeyName: "shipment_packages_shipment_tenant_fkey"
            columns: ["shipment_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "shipment_packages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          carrier_name: string | null
          checked_at: string | null
          checker_user_id: string | null
          created_at: string
          created_by: string | null
          delivered_at: string | null
          estimated_delivery_at: string | null
          external_provider: string | null
          external_shipment_id: string | null
          id: string
          notes: string | null
          order_id: string
          picked_at: string | null
          picker_user_id: string | null
          posted_at: string | null
          service_name: string | null
          status: string
          tenant_id: string
          tracking_code: string | null
          tracking_url: string | null
          updated_at: string
        }
        Insert: {
          carrier_name?: string | null
          checked_at?: string | null
          checker_user_id?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          estimated_delivery_at?: string | null
          external_provider?: string | null
          external_shipment_id?: string | null
          id?: string
          notes?: string | null
          order_id: string
          picked_at?: string | null
          picker_user_id?: string | null
          posted_at?: string | null
          service_name?: string | null
          status?: string
          tenant_id: string
          tracking_code?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Update: {
          carrier_name?: string | null
          checked_at?: string | null
          checker_user_id?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          estimated_delivery_at?: string | null
          external_provider?: string | null
          external_shipment_id?: string | null
          id?: string
          notes?: string | null
          order_id?: string
          picked_at?: string | null
          picker_user_id?: string | null
          posted_at?: string | null
          service_name?: string | null
          status?: string
          tenant_id?: string
          tracking_code?: string | null
          tracking_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipments_order_tenant_fkey"
            columns: ["order_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "shipments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          product_id: string
          qty: number
          reference: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["stock_movement_type"]
          user_id: string | null
          warehouse_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          product_id: string
          qty: number
          reference?: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["stock_movement_type"]
          user_id?: string | null
          warehouse_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          product_id?: string
          qty?: number
          reference?: string | null
          tenant_id?: string
          type?: Database["public"]["Enums"]["stock_movement_type"]
          user_id?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "stock_movements_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "stock_movements_warehouse_tenant_fkey"
            columns: ["warehouse_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      stock_reservations: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          order_id: string
          product_id: string
          quantity: number
          status: string
          tenant_id: string
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          order_id: string
          product_id: string
          quantity: number
          status?: string
          tenant_id: string
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          order_id?: string
          product_id?: string
          quantity?: number
          status?: string
          tenant_id?: string
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_reservations_order_tenant_fkey"
            columns: ["order_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "stock_reservations_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "stock_reservations_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "stock_reservations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_warehouse_tenant_fkey"
            columns: ["warehouse_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      stock_transfer_items: {
        Row: {
          created_at: string
          id: string
          product_id: string
          qty: number
          tenant_id: string
          transfer_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          qty: number
          tenant_id: string
          transfer_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          qty?: number
          tenant_id?: string
          transfer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_items_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "stock_transfer_items_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "stock_transfer_items_transfer_tenant_fkey"
            columns: ["transfer_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          from_warehouse_id: string
          id: string
          notes: string | null
          status: Database["public"]["Enums"]["stock_transfer_status"]
          tenant_id: string
          to_warehouse_id: string
          updated_at: string
        }
        Insert: {
          code?: string
          created_at?: string
          created_by?: string | null
          from_warehouse_id: string
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["stock_transfer_status"]
          tenant_id: string
          to_warehouse_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          from_warehouse_id?: string
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["stock_transfer_status"]
          tenant_id?: string
          to_warehouse_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_destination_tenant_fkey"
            columns: ["to_warehouse_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "stock_transfers_source_tenant_fkey"
            columns: ["from_warehouse_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id", "tenant_id"]
          },
        ]
      }
      supplier_product_codes: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          product_id: string
          supplier_code: string
          supplier_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_id: string
          supplier_code: string
          supplier_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_id?: string
          supplier_code?: string
          supplier_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_product_codes_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "supplier_product_codes_product_tenant_fkey"
            columns: ["product_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id", "tenant_id"]
          },
          {
            foreignKeyName: "supplier_product_codes_supplier_tenant_fkey"
            columns: ["supplier_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "supplier_product_codes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          active: boolean
          address: string | null
          average_lead_days: number | null
          city: string | null
          contact_name: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          legal_name: string
          notes: string | null
          payment_terms: string | null
          phone: string | null
          state: string | null
          state_tax_id: string | null
          tax_id: string | null
          tenant_id: string
          trade_name: string | null
          updated_at: string
          updated_by: string | null
          whatsapp: string | null
          zip_code: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          average_lead_days?: number | null
          city?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          legal_name: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          state?: string | null
          state_tax_id?: string | null
          tax_id?: string | null
          tenant_id: string
          trade_name?: string | null
          updated_at?: string
          updated_by?: string | null
          whatsapp?: string | null
          zip_code?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          average_lead_days?: number | null
          city?: string | null
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          legal_name?: string
          notes?: string | null
          payment_terms?: string | null
          phone?: string | null
          state?: string | null
          state_tax_id?: string | null
          tax_id?: string | null
          tenant_id?: string
          trade_name?: string | null
          updated_at?: string
          updated_by?: string | null
          whatsapp?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      supply_counters: {
        Row: {
          kind: string
          last_number: number
          tenant_id: string
        }
        Insert: {
          kind: string
          last_number?: number
          tenant_id: string
        }
        Update: {
          kind?: string
          last_number?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supply_counters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_company_profiles: {
        Row: {
          accent_color: string
          address_city: string | null
          address_complement: string | null
          address_neighborhood: string | null
          address_number: string | null
          address_state: string | null
          address_street: string | null
          address_zip: string | null
          business_hours: string | null
          country_code: string
          email: string | null
          facebook_url: string | null
          favicon_url: string | null
          footer_text: string | null
          instagram_url: string | null
          legal_name: string | null
          logo_dark_url: string | null
          logo_url: string | null
          municipal_registration: string | null
          phone: string | null
          primary_color: string
          secondary_color: string
          state_registration: string | null
          store_description: string | null
          store_title: string | null
          tax_id: string | null
          tenant_id: string
          trade_name: string
          updated_at: string
          updated_by: string | null
          website: string | null
          whatsapp: string | null
          youtube_url: string | null
        }
        Insert: {
          accent_color?: string
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          business_hours?: string | null
          country_code?: string
          email?: string | null
          facebook_url?: string | null
          favicon_url?: string | null
          footer_text?: string | null
          instagram_url?: string | null
          legal_name?: string | null
          logo_dark_url?: string | null
          logo_url?: string | null
          municipal_registration?: string | null
          phone?: string | null
          primary_color?: string
          secondary_color?: string
          state_registration?: string | null
          store_description?: string | null
          store_title?: string | null
          tax_id?: string | null
          tenant_id: string
          trade_name: string
          updated_at?: string
          updated_by?: string | null
          website?: string | null
          whatsapp?: string | null
          youtube_url?: string | null
        }
        Update: {
          accent_color?: string
          address_city?: string | null
          address_complement?: string | null
          address_neighborhood?: string | null
          address_number?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          business_hours?: string | null
          country_code?: string
          email?: string | null
          facebook_url?: string | null
          favicon_url?: string | null
          footer_text?: string | null
          instagram_url?: string | null
          legal_name?: string | null
          logo_dark_url?: string | null
          logo_url?: string | null
          municipal_registration?: string | null
          phone?: string | null
          primary_color?: string
          secondary_color?: string
          state_registration?: string | null
          store_description?: string | null
          store_title?: string | null
          tax_id?: string | null
          tenant_id?: string
          trade_name?: string
          updated_at?: string
          updated_by?: string | null
          website?: string | null
          whatsapp?: string | null
          youtube_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_company_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_memberships: {
        Row: {
          active: boolean
          created_at: string
          id: string
          role: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          role: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          role?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_modules: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          module_key: string
          settings: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          module_key: string
          settings?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          module_key?: string
          settings?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_modules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_storefronts: {
        Row: {
          active: boolean
          created_at: string
          hostname: string | null
          id: string
          slug: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          hostname?: string | null
          id?: string
          slug: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          hostname?: string | null
          id?: string
          slug?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_storefronts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_user_permissions: {
        Row: {
          can_create: boolean
          can_delete: boolean
          can_update: boolean
          can_view: boolean
          created_at: string
          module_key: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          can_create?: boolean
          can_delete?: boolean
          can_update?: boolean
          can_view?: boolean
          created_at?: string
          module_key: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          can_create?: boolean
          can_delete?: boolean
          can_update?: boolean
          can_view?: boolean
          created_at?: string
          module_key?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_user_permissions_membership_fkey"
            columns: ["tenant_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tenant_memberships"
            referencedColumns: ["tenant_id", "user_id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          environment: string
          id: string
          name: string
          organization_id: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          environment: string
          id?: string
          name: string
          organization_id: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          environment?: string
          id?: string
          name?: string
          organization_id?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      warehouses: {
        Row: {
          active: boolean
          branch_id: string
          code: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          branch_id: string
          code: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          branch_id?: string
          code?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_branch_tenant_fkey"
            columns: ["branch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "warehouses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_product_stock_available: {
        Row: {
          available_effective: number | null
          available_multi: number | null
          has_multi_stock: boolean | null
          legacy_stock: number | null
          on_hand_multi: number | null
          product_id: string | null
          reserved_multi: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      adjust_product_stock: {
        Args: {
          p_notes?: string
          p_product_id: string
          p_qty: number
          p_reference?: string
          p_tenant_id: string
          p_type: string
          p_user_id?: string
          p_warehouse_id: string
        }
        Returns: number
      }
      approve_product_cost_candidates: {
        Args: { p_candidate_ids: string[] }
        Returns: Json
      }
      approve_product_enrichment_candidate: {
        Args: { p_candidate_id: string }
        Returns: Json
      }
      calculate_seller_commission: {
        Args: {
          p_actor_user_id: string
          p_period_month: string
          p_rep_id: string
          p_tenant_id: string
        }
        Returns: Json
      }
      cancel_pos_sale: {
        Args: { p_reason: string; p_sale_id: string }
        Returns: string
      }
      close_inventory_period: { Args: { p_period_date: string }; Returns: Json }
      close_pos_cash_session: {
        Args: {
          p_counted_amount: number
          p_notes?: string
          p_session_id: string
        }
        Returns: {
          branch_id: string
          closed_at: string | null
          counted_amount: number | null
          created_at: string
          difference_amount: number | null
          expected_amount: number | null
          id: string
          notes: string | null
          opened_at: string
          opening_amount: number
          operator_id: string
          status: string
          tenant_id: string
          terminal_code: string
          warehouse_id: string
        }
        SetofOptions: {
          from: "*"
          to: "pos_cash_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_goods_receipt: { Args: { p_receipt_id: string }; Returns: Json }
      create_assisted_order_with_credit: {
        Args: {
          p_actor_user_id?: string
          p_credit_used?: number
          p_customer_id: string
          p_discount: number
          p_idempotency_key?: string
          p_items: Json
          p_lead_cnpj: string
          p_lead_email: string
          p_lead_name: string
          p_lead_phone: string
          p_notes: string
          p_price_uplift_pct?: number
          p_rep_id: string
          p_status: string
          p_subtotal: number
          p_tenant_id: string
          p_total: number
        }
        Returns: string
      }
      create_fiscal_draft_from_order: {
        Args: { p_model?: string; p_order_id: string }
        Returns: Json
      }
      create_replenishment_purchase_orders: {
        Args: { p_items: Json; p_tenant_id: string; p_warehouse_id: string }
        Returns: Json
      }
      enqueue_products_for_enrichment: {
        Args: { p_limit?: number; p_tenant_id: string }
        Returns: number
      }
      finalize_pos_sale: {
        Args: {
          p_cash_session_id: string
          p_customer_id?: string
          p_discount_amount?: number
          p_idempotency_key: string
          p_items: Json
          p_payments: Json
          p_tenant_id: string
        }
        Returns: string
      }
      get_commercial_intelligence: {
        Args: { p_lookback_days?: number; p_tenant_id: string }
        Returns: {
          abc_class: string
          average_cost: number
          commission_rate: number
          cumulative_revenue_pct: number
          current_price: number
          desired_margin_rate: number
          fixed_cost_per_unit: number
          gross_margin_pct: number
          gross_profit: number
          markup_pct: number
          other_variable_rate: number
          payment_fee_rate: number
          price_gap_pct: number
          pricing_status: string
          product_id: string
          product_name: string
          revenue: number
          revenue_share_pct: number
          sku: string
          suggested_price: number
          tax_rate: number
          units_sold: number
        }[]
      }
      get_commercial_intelligence_v2: {
        Args: { p_lookback_days?: number; p_tenant_id: string }
        Returns: Json
      }
      get_inventory_financial_position: { Args: never; Returns: Json }
      get_replenishment_suggestions: {
        Args: { p_lookback_days?: number; p_tenant_id: string }
        Returns: {
          available_qty: number
          average_cost: number
          avg_daily_demand: number
          days_of_cover: number
          estimated_purchase_value: number
          internal_code: string
          lead_time_days: number
          manufacturer_code: string
          on_hand_qty: number
          pending_purchase_qty: number
          preferred_supplier_id: string
          preferred_supplier_name: string
          product_id: string
          product_name: string
          reorder_point: number
          reserved_qty: number
          risk_status: string
          safety_stock: number
          sku: string
          suggested_qty: number
          target_stock: number
          units_sold: number
        }[]
      }
      get_seller_credit_balance: {
        Args: { p_rep_id: string; p_tenant_id: string }
        Returns: number
      }
      get_seller_credit_balances: {
        Args: { p_tenant_id: string }
        Returns: {
          balance: number
          rep_id: string
        }[]
      }
      get_supplier_performance: {
        Args: { p_lookback_days?: number; p_tenant_id: string }
        Returns: Json
      }
      internal_apply_payment_webhook: {
        Args: {
          p_event_type: string
          p_external_payment_id: string
          p_normalized_status: string
          p_payload_sha256: string
          p_provider_event_id: string
          p_provider_id: string
          p_signature_verified: boolean
        }
        Returns: string
      }
      internal_complete_order_dispatch: {
        Args: { p_actor_user_id: string; p_dispatch_id: string }
        Returns: Json
      }
      internal_create_payment_intent: {
        Args: {
          p_actor_user_id: string
          p_idempotency_key: string
          p_order_id: string
          p_provider_code?: string
        }
        Returns: {
          amount: number
          authorized_at: string | null
          boleto_barcode: string | null
          boleto_url: string | null
          cancelled_at: string | null
          checkout_url: string | null
          client_reference: string | null
          created_at: string
          currency: string
          expires_at: string | null
          external_id: string | null
          failure_code: string | null
          failure_message: string | null
          id: string
          idempotency_key: string
          method: string
          order_id: string
          paid_at: string | null
          pix_copy_paste: string | null
          pix_qr_code_url: string | null
          provider_id: string
          provider_metadata: Json
          status: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_intents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      internal_create_storefront_order: {
        Args: {
          p_customer: Json
          p_idempotency_key: string
          p_items: Json
          p_payment_method: string
          p_tenant_slug: string
          p_user_id: string
        }
        Returns: string
      }
      internal_generate_product_internal_codes: {
        Args: { p_actor_user_id: string; p_limit?: number; p_tenant_id: string }
        Returns: {
          internal_code: string
          name: string
          product_id: string
          sku: string
        }[]
      }
      internal_operate_order: {
        Args: {
          p_actor_user_id: string
          p_next_status: Database["public"]["Enums"]["order_status"]
          p_note: string
          p_order_id: string
        }
        Returns: Database["public"]["Enums"]["order_status"]
      }
      internal_scan_order_dispatch: {
        Args: {
          p_actor_user_id?: string
          p_code: string
          p_dispatch_id: string
          p_quantity?: number
        }
        Returns: Json
      }
      internal_start_order_dispatch: {
        Args: { p_actor_user_id: string; p_order_id: string }
        Returns: Json
      }
      internal_transition_order: {
        Args: { p_action: string; p_actor_user_id?: string; p_order_id: string }
        Returns: Database["public"]["Enums"]["order_status"]
      }
      open_pos_cash_session: {
        Args: {
          p_branch_id: string
          p_opening_amount?: number
          p_tenant_id: string
          p_terminal_code: string
          p_warehouse_id: string
        }
        Returns: {
          branch_id: string
          closed_at: string | null
          counted_amount: number | null
          created_at: string
          difference_amount: number | null
          expected_amount: number | null
          id: string
          notes: string | null
          opened_at: string
          opening_amount: number
          operator_id: string
          status: string
          tenant_id: string
          terminal_code: string
          warehouse_id: string
        }
        SetofOptions: {
          from: "*"
          to: "pos_cash_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      propose_manual_product_cost: {
        Args: {
          p_cost: number
          p_evidence_reference: string
          p_notes?: string
          p_product_id: string
        }
        Returns: Json
      }
      record_inventory_return: {
        Args: {
          p_idempotency_key?: string
          p_items: Json
          p_notes?: string
          p_order_id?: string
          p_reason: string
          p_return_type: string
          p_tenant_id: string
          p_user_id: string
          p_warehouse_id: string
        }
        Returns: string
      }
      record_pos_cash_movement: {
        Args: {
          p_amount: number
          p_reason: string
          p_session_id: string
          p_type: string
        }
        Returns: {
          amount: number
          cash_session_id: string
          created_at: string
          id: string
          operator_id: string
          reason: string
          tenant_id: string
          type: string
        }
        SetofOptions: {
          from: "*"
          to: "pos_cash_movements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      refresh_cost_sanitation_queue: { Args: never; Returns: Json }
      reverse_goods_receipt: {
        Args: { p_reason: string; p_receipt_id: string }
        Returns: Json
      }
      validate_cart_items: {
        Args: { p_items: Json; p_tenant_id: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "gerente" | "vendedor" | "cliente"
      b2b_approval_status: "none" | "pending" | "approved" | "rejected"
      b2b_status: "pendente" | "aprovado" | "reprovado"
      banner_audience: "all" | "b2c" | "b2b"
      coupon_discount_type: "percentage" | "fixed_amount"
      customer_group:
        | "b2c"
        | "b2b_pendente"
        | "revendedor"
        | "oficina"
        | "distribuidor"
      discount_type: "percentage" | "fixed_amount" | "special_price"
      integration_category:
        | "erp"
        | "marketplace"
        | "logistics"
        | "payment"
        | "fiscal"
        | "ai"
        | "marketing"
        | "mobile"
      integration_log_status: "success" | "error" | "warning" | "pending"
      integration_status: "disconnected" | "connected" | "error" | "configuring"
      order_status:
        | "rascunho"
        | "aguardando_pagamento"
        | "pago"
        | "faturado"
        | "enviado"
        | "entregue"
        | "cancelado"
      promotion_type: "product" | "category" | "brand" | "customer_group"
      quote_origin: "whatsapp" | "ia" | "site" | "vendedor" | "balcao" | "b2b"
      quote_status:
        | "rascunho"
        | "enviado"
        | "em_negociacao"
        | "aprovado"
        | "recusado"
        | "convertido"
        | "expirado"
      stock_movement_type:
        | "IN"
        | "OUT"
        | "ADJUST"
        | "TRANSFER"
        | "RESERVE"
        | "RELEASE"
      stock_transfer_status:
        | "rascunho"
        | "em_transito"
        | "concluido"
        | "cancelado"
      sync_entity:
        | "produto"
        | "estoque"
        | "preco"
        | "cliente"
        | "pedido"
        | "categoria"
        | "imagem"
      sync_status: "sucesso" | "erro" | "pendente"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "gerente", "vendedor", "cliente"],
      b2b_approval_status: ["none", "pending", "approved", "rejected"],
      b2b_status: ["pendente", "aprovado", "reprovado"],
      banner_audience: ["all", "b2c", "b2b"],
      coupon_discount_type: ["percentage", "fixed_amount"],
      customer_group: [
        "b2c",
        "b2b_pendente",
        "revendedor",
        "oficina",
        "distribuidor",
      ],
      discount_type: ["percentage", "fixed_amount", "special_price"],
      integration_category: [
        "erp",
        "marketplace",
        "logistics",
        "payment",
        "fiscal",
        "ai",
        "marketing",
        "mobile",
      ],
      integration_log_status: ["success", "error", "warning", "pending"],
      integration_status: ["disconnected", "connected", "error", "configuring"],
      order_status: [
        "rascunho",
        "aguardando_pagamento",
        "pago",
        "faturado",
        "enviado",
        "entregue",
        "cancelado",
      ],
      promotion_type: ["product", "category", "brand", "customer_group"],
      quote_origin: ["whatsapp", "ia", "site", "vendedor", "balcao", "b2b"],
      quote_status: [
        "rascunho",
        "enviado",
        "em_negociacao",
        "aprovado",
        "recusado",
        "convertido",
        "expirado",
      ],
      stock_movement_type: [
        "IN",
        "OUT",
        "ADJUST",
        "TRANSFER",
        "RESERVE",
        "RELEASE",
      ],
      stock_transfer_status: [
        "rascunho",
        "em_transito",
        "concluido",
        "cancelado",
      ],
      sync_entity: [
        "produto",
        "estoque",
        "preco",
        "cliente",
        "pedido",
        "categoria",
        "imagem",
      ],
      sync_status: ["sucesso", "erro", "pendente"],
    },
  },
} as const
