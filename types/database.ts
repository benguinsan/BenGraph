// Generated from the live schema (Supabase MCP generate_typescript_types).
// Regenerate after every migration; don't edit by hand.

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      analyses: {
        Row: { commit_sha: string | null; created_at: string; finished_at: string | null; id: string; org_id: string; project_id: string; started_at: string | null; status: string }
        Insert: { commit_sha?: string | null; created_at?: string; finished_at?: string | null; id?: string; org_id: string; project_id: string; started_at?: string | null; status?: string }
        Update: { commit_sha?: string | null; created_at?: string; finished_at?: string | null; id?: string; org_id?: string; project_id?: string; started_at?: string | null; status?: string }
        Relationships: [
          { foreignKeyName: "analyses_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "analyses_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id"] },
        ]
      }
      edges: {
        Row: { analysis_id: string; id: string; org_id: string; source_file_id: string; target_file_id: string }
        Insert: { analysis_id: string; id?: string; org_id: string; source_file_id: string; target_file_id: string }
        Update: { analysis_id?: string; id?: string; org_id?: string; source_file_id?: string; target_file_id?: string }
        Relationships: [
          { foreignKeyName: "edges_analysis_id_fkey"; columns: ["analysis_id"]; isOneToOne: false; referencedRelation: "analyses"; referencedColumns: ["id"] },
          { foreignKeyName: "edges_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "edges_source_file_id_fkey"; columns: ["source_file_id"]; isOneToOne: false; referencedRelation: "files"; referencedColumns: ["id"] },
          { foreignKeyName: "edges_target_file_id_fkey"; columns: ["target_file_id"]; isOneToOne: false; referencedRelation: "files"; referencedColumns: ["id"] },
        ]
      }
      explanations: {
        Row: { body: string; created_at: string; file_id: string; id: string; org_id: string }
        Insert: { body: string; created_at?: string; file_id: string; id?: string; org_id: string }
        Update: { body?: string; created_at?: string; file_id?: string; id?: string; org_id?: string }
        Relationships: [
          { foreignKeyName: "explanations_file_id_fkey"; columns: ["file_id"]; isOneToOne: false; referencedRelation: "files"; referencedColumns: ["id"] },
          { foreignKeyName: "explanations_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
        ]
      }
      file_roles: {
        Row: { file_id: string; id: string; org_id: string; role: string }
        Insert: { file_id: string; id?: string; org_id: string; role: string }
        Update: { file_id?: string; id?: string; org_id?: string; role?: string }
        Relationships: [
          { foreignKeyName: "file_roles_file_id_fkey"; columns: ["file_id"]; isOneToOne: false; referencedRelation: "files"; referencedColumns: ["id"] },
          { foreignKeyName: "file_roles_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
        ]
      }
      files: {
        Row: { analysis_id: string; id: string; org_id: string; path: string }
        Insert: { analysis_id: string; id?: string; org_id: string; path: string }
        Update: { analysis_id?: string; id?: string; org_id?: string; path?: string }
        Relationships: [
          { foreignKeyName: "files_analysis_id_fkey"; columns: ["analysis_id"]; isOneToOne: false; referencedRelation: "analyses"; referencedColumns: ["id"] },
          { foreignKeyName: "files_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
        ]
      }
      insights: {
        Row: { analysis_id: string; id: string; kind: string; org_id: string }
        Insert: { analysis_id: string; id?: string; kind: string; org_id: string }
        Update: { analysis_id?: string; id?: string; kind?: string; org_id?: string }
        Relationships: [
          { foreignKeyName: "insights_analysis_id_fkey"; columns: ["analysis_id"]; isOneToOne: false; referencedRelation: "analyses"; referencedColumns: ["id"] },
          { foreignKeyName: "insights_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
        ]
      }
      organizations: {
        Row: { created_at: string; id: string }
        Insert: { created_at?: string; id: string }
        Update: { created_at?: string; id?: string }
        Relationships: []
      }
      projects: {
        Row: { created_at: string; id: string; org_id: string; repo_url: string }
        Insert: { created_at?: string; id?: string; org_id: string; repo_url: string }
        Update: { created_at?: string; id?: string; org_id?: string; repo_url?: string }
        Relationships: [
          { foreignKeyName: "projects_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
        ]
      }
      routes: {
        Row: { analysis_id: string; file_id: string; id: string; method: string; org_id: string; path: string }
        Insert: { analysis_id: string; file_id: string; id?: string; method: string; org_id: string; path: string }
        Update: { analysis_id?: string; file_id?: string; id?: string; method?: string; org_id?: string; path?: string }
        Relationships: [
          { foreignKeyName: "routes_analysis_id_fkey"; columns: ["analysis_id"]; isOneToOne: false; referencedRelation: "analyses"; referencedColumns: ["id"] },
          { foreignKeyName: "routes_file_id_fkey"; columns: ["file_id"]; isOneToOne: false; referencedRelation: "files"; referencedColumns: ["id"] },
          { foreignKeyName: "routes_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
        ]
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      requesting_org_id: { Args: never; Returns: string }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
