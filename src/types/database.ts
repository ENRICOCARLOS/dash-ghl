export type Role = "ADM" | "user";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  created_at: string;
  updated_at: string;
};

export type Client = {
  id: string;
  name: string;
  ghl_api_key?: string;
  ghl_location_id: string;
  /** Slug da visualização de relatório para este cliente (padrão 'padrao'). Variações só se aplicam a este cliente. */
  report_slug?: string;
  created_at?: string;
  updated_at?: string;
};

export type UserClient = {
  user_id: string;
  client_id: string;
};

export type ClientWithUsers = Client & {
  user_clients?: { user_id: string }[];
};

export type ProfileWithClients = Profile & {
  clients?: Client[];
};
