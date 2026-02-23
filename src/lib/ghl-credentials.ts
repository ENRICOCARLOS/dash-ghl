import { getAuthUser } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { NextRequest } from "next/server";

export type GhlCredentials = {
  ghl_api_key: string;
  ghl_location_id: string;
  client_id: string;
};

/**
 * Obtém credenciais GHL do cliente selecionado.
 * - client_id (query ou sessão) = ID do nosso sistema (UUID em public.clients).
 * - As chamadas à API GHL usam o que está no cadastro do cliente: ghl_api_key e ghl_location_id.
 * Assim, cada conta (ex.: GM Clínicas) puxa os dados da própria Location no GoHighLevel.
 */
export async function getGhlCredentials(
  request: NextRequest,
  clientIdFromQuery?: string | null
): Promise<GhlCredentials | { error: string; status: number }> {
  const user = await getAuthUser(request);
  if (!user) return { error: "Não autorizado", status: 401 };

  const service = createServiceClient();
  const { data: profile } = await service.from("profiles").select("role").eq("id", user.id).single();
  const isAdm = profile?.role === "ADM";

  const { data: active } = await service
    .from("user_active_client")
    .select("client_id")
    .eq("user_id", user.id)
    .single();

  const clientId = clientIdFromQuery ?? active?.client_id;
  if (!clientId) return { error: "Nenhuma conta selecionada", status: 400 };

  const { data: client, error } = await service
    .from("clients")
    .select("ghl_api_key, ghl_location_id")
    .eq("id", clientId)
    .single();

  if (error || !client) return { error: "Cliente não encontrado", status: 404 };

  const apiKey = typeof client.ghl_api_key === "string" ? client.ghl_api_key.trim() : "";
  if (!apiKey) return { error: "Cliente sem API Key GHL configurada. Verifique a conta em Gerenciar Clientes.", status: 400 };

  const raw = client.ghl_location_id != null ? String(client.ghl_location_id).trim() : "";
  const locationId = raw && raw !== "undefined" ? raw : null;
  if (!locationId) return { error: "Cliente sem Location ID configurado no banco. Verifique a conta em Gerenciar Clientes.", status: 400 };

  if (!isAdm) {
    const { data: link } = await service
      .from("user_clients")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("client_id", clientId)
      .single();
    if (!link) return { error: "Sem acesso a esta conta", status: 403 };
  }

  return {
    ghl_api_key: apiKey,
    ghl_location_id: locationId,
    client_id: clientId,
  };
}

/**
 * Obtém credenciais GHL apenas por client_id (uso interno, ex.: cron).
 * Não verifica usuário; usar apenas com autorização (ex.: CRON_SECRET).
 */
export async function getGhlCredentialsByClientId(
  clientId: string
): Promise<GhlCredentials | { error: string; status: number }> {
  const service = createServiceClient();
  const { data: client, error } = await service
    .from("clients")
    .select("id, ghl_api_key, ghl_location_id")
    .eq("id", clientId)
    .single();

  if (error || !client) return { error: "Cliente não encontrado", status: 404 };

  const apiKey = typeof client.ghl_api_key === "string" ? client.ghl_api_key.trim() : "";
  if (!apiKey) return { error: "Cliente sem API Key GHL", status: 400 };

  const raw = client.ghl_location_id != null ? String(client.ghl_location_id).trim() : "";
  const locationId = raw && raw !== "undefined" ? raw : null;
  if (!locationId) return { error: "Cliente sem Location ID", status: 400 };

  return {
    ghl_api_key: apiKey,
    ghl_location_id: locationId,
    client_id: client.id,
  };
}
