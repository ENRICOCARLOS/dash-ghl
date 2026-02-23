import { getFacebookCredentials } from "@/lib/facebook-credentials";
import { facebookErrorResponse } from "@/lib/facebook-error-response";
import { getAdAccounts } from "@/lib/facebook-ads";
import { NextRequest, NextResponse } from "next/server";

/** Lista contas de anúncios disponíveis para o token do cliente (para configurar qual usar). */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const cred = await getFacebookCredentials(request, clientId, false);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  try {
    const accounts = await getAdAccounts(cred.fb_access_token);
    return NextResponse.json({ ad_accounts: accounts });
  } catch (e) {
    return facebookErrorResponse(e, "Erro ao buscar contas de anúncios do Facebook");
  }
}
