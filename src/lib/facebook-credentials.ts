import { getAuthUser } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import type { NextRequest } from "next/server";

export type FacebookCredentials = {
  fb_access_token: string;
  fb_ad_account_id: string;
  client_id: string;
};

/**
 * Obtém credenciais Facebook Ads do cliente selecionado.
 * Requer fb_access_token no cadastro do cliente.
 * Para listar apenas contas (ad-accounts), fb_ad_account_id é opcional.
 * Para campanhas e insights, fb_ad_account_id é obrigatório.
 */
export async function getFacebookCredentials(
  request: NextRequest,
  clientIdFromQuery?: string | null,
  requireAdAccountId = false
): Promise<FacebookCredentials | { error: string; status: number }> {
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
    .select("fb_access_token, fb_ad_account_id")
    .eq("id", clientId)
    .single();

  if (error || !client) return { error: "Cliente não encontrado", status: 404 };

  const token = typeof client.fb_access_token === "string" ? client.fb_access_token.trim() : "";
  if (!token)
    return {
      error: "Cliente sem token Facebook configurado. Configure em Gerenciar Clientes.",
      status: 400,
    };

  if (!isAdm) {
    const { data: link } = await service
      .from("user_clients")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("client_id", clientId)
      .single();
    if (!link) return { error: "Sem acesso a esta conta", status: 403 };
  }

  const adAccountId = client.fb_ad_account_id != null ? String(client.fb_ad_account_id).trim() : "";
  if (requireAdAccountId && (!adAccountId || adAccountId === "undefined"))
    return {
      error: "Cliente sem Conta de Anúncios (Ad Account ID) configurada. Configure em Gerenciar Clientes.",
      status: 400,
    };

  return {
    fb_access_token: token,
    fb_ad_account_id: adAccountId,
    client_id: clientId,
  };
}
