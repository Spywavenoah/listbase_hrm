export interface Letterhead {
  id: string;
  name: string;
  body_html: string;
  variables: unknown;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}
