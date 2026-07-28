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
          updated_at?: string
        }
        Relationships: []
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
        }
        Insert: {
          bling_id?: string | null
          created_at?: string
          featured?: boolean
          id?: string
          logo_url?: string | null
          name: string
          slug: string
        }
        Update: {
          bling_id?: string | null
          created_at?: string
          featured?: boolean
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
        }
        Relationships: []
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
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
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
      order_items: {
        Row: {
          id: string
          name: string
          order_id: string
          product_id: string | null
          quantity: number
          sku: string
          total: number
          unit_price: number
        }
        Insert: {
          id?: string
          name: string
          order_id: string
          product_id?: string | null
          quantity: number
          sku: string
          total: number
          unit_price: number
        }
        Update: {
          id?: string
          name?: string
          order_id?: string
          product_id?: string | null
          quantity?: number
          sku?: string
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id"]
          },
        ]
      }
      orders: {
        Row: {
          bling_id: string | null
          bling_number: string | null
          created_at: string
          customer_document: string | null
          customer_email: string
          customer_name: string
          customer_phone: string | null
          discount: number
          id: string
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
          total: number
          updated_at: string
          user_id: string
        }
        Insert: {
          bling_id?: string | null
          bling_number?: string | null
          created_at?: string
          customer_document?: string | null
          customer_email: string
          customer_name: string
          customer_phone?: string | null
          discount?: number
          id?: string
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
          total?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          bling_id?: string | null
          bling_number?: string | null
          created_at?: string
          customer_document?: string | null
          customer_email?: string
          customer_name?: string
          customer_phone?: string | null
          discount?: number
          id?: string
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
          total?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      product_applications: {
        Row: {
          id: string
          notes: string | null
          product_id: string
          vehicle_make: string
          vehicle_model: string
          year_from: number | null
          year_to: number | null
        }
        Insert: {
          id?: string
          notes?: string | null
          product_id: string
          vehicle_make: string
          vehicle_model: string
          year_from?: number | null
          year_to?: number | null
        }
        Update: {
          id?: string
          notes?: string | null
          product_id?: string
          vehicle_make?: string
          vehicle_model?: string
          year_from?: number | null
          year_to?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_applications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_applications_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id"]
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
          url: string
        }
        Insert: {
          alt?: string | null
          id?: string
          is_primary?: boolean
          product_id: string
          sort_order?: number
          url: string
        }
        Update: {
          alt?: string | null
          id?: string
          is_primary?: boolean
          product_id?: string
          sort_order?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id"]
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
          updated_at: string
          warehouse_id: string
        }
        Insert: {
          id?: string
          min_stock?: number
          on_hand?: number
          product_id: string
          reserved?: number
          updated_at?: string
          warehouse_id: string
        }
        Update: {
          id?: string
          min_stock?: number
          on_hand?: number
          product_id?: string
          reserved?: number
          updated_at?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_stock_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          bling_id: string | null
          brand_id: string | null
          category_id: string | null
          compare_at_price: number | null
          created_at: string
          description: string | null
          featured: boolean
          hide_when_out_of_stock: boolean
          id: string
          internal_code: string | null
          is_bestseller: boolean
          is_new: boolean
          is_offer: boolean
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
          updated_at: string
          weight_kg: number | null
        }
        Insert: {
          active?: boolean
          bling_id?: string | null
          brand_id?: string | null
          category_id?: string | null
          compare_at_price?: number | null
          created_at?: string
          description?: string | null
          featured?: boolean
          hide_when_out_of_stock?: boolean
          id?: string
          internal_code?: string | null
          is_bestseller?: boolean
          is_new?: boolean
          is_offer?: boolean
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
          updated_at?: string
          weight_kg?: number | null
        }
        Update: {
          active?: boolean
          bling_id?: string | null
          brand_id?: string | null
          category_id?: string | null
          compare_at_price?: number | null
          created_at?: string
          description?: string | null
          featured?: boolean
          hide_when_out_of_stock?: boolean
          id?: string
          internal_code?: string | null
          is_bestseller?: boolean
          is_new?: boolean
          is_offer?: boolean
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
          updated_at?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_subcategory_id_fkey"
            columns: ["subcategory_id"]
            isOneToOne: false
            referencedRelation: "categories"
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
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "quote_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quote_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "quote_items_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
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
          discount: number
          id: string
          internal_notes: string | null
          number: number
          origin: Database["public"]["Enums"]["quote_origin"]
          sales_rep_id: string | null
          status: Database["public"]["Enums"]["quote_status"]
          subtotal: number
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
          discount?: number
          id?: string
          internal_notes?: string | null
          number?: number
          origin?: Database["public"]["Enums"]["quote_origin"]
          sales_rep_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal?: number
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
          discount?: number
          id?: string
          internal_notes?: string | null
          number?: number
          origin?: Database["public"]["Enums"]["quote_origin"]
          sales_rep_id?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          subtotal?: number
          total?: number
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_sales_rep_id_fkey"
            columns: ["sales_rep_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
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
          items: Json
          lead_cnpj: string | null
          lead_email: string | null
          lead_name: string | null
          lead_phone: string | null
          notes: string | null
          order_id: string | null
          rep_id: string
          status: string
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          discount?: number
          id?: string
          items?: Json
          lead_cnpj?: string | null
          lead_email?: string | null
          lead_name?: string | null
          lead_phone?: string | null
          notes?: string | null
          order_id?: string | null
          rep_id: string
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          discount?: number
          id?: string
          items?: Json
          lead_cnpj?: string | null
          lead_email?: string | null
          lead_name?: string | null
          lead_phone?: string | null
          notes?: string | null
          order_id?: string | null
          rep_id?: string
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
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
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_rep_customers_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "sales_reps"
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
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
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
      stock_movements: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          product_id: string
          qty: number
          reference: string | null
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
          type?: Database["public"]["Enums"]["stock_movement_type"]
          user_id?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_movements_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfer_items: {
        Row: {
          created_at: string
          id: string
          product_id: string
          qty: number
          transfer_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          qty: number
          transfer_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          qty?: number
          transfer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_product_stock_available"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_transfer_items_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id"]
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
          to_warehouse_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_from_warehouse_id_fkey"
            columns: ["from_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_to_warehouse_id_fkey"
            columns: ["to_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
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
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
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
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
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
