/**
 * Tipe database Supabase untuk kebutuhan aplikasi.
 *
 * Cakupan saat ini sengaja terbatas pada `public.profiles` (Milestone 1).
 * Setelah project Supabase development tersedia, tipe lengkap sebaiknya
 * dihasilkan dari skema dengan Supabase CLI:
 *
 *   npx supabase gen types typescript --project-id <project-id> > src/lib/supabase/database.types.ts
 *
 * Selama belum dijalankan, tipe manual ini harus tetap sinkron dengan
 * `supabase/migrations/*.sql`.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type ProfileRow = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  city: string | null;
  is_private: boolean;
  created_at: string;
  updated_at: string;
};

export type ProfileInsert = {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  bio?: string | null;
  city?: string | null;
  is_private?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type ProfileUpdate = {
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
  bio?: string | null;
  city?: string | null;
  is_private?: boolean;
  updated_at?: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type DatabaseSchemaName = keyof Database;
