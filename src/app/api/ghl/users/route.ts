import { getGhlCredentials } from "@/lib/ghl-credentials";
import { ghlErrorResponse } from "@/lib/ghl-error-response";
import { getLocationUsers } from "@/lib/ghl";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const cred = await getGhlCredentials(request, clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  try {
    const users = await getLocationUsers(cred.ghl_api_key, cred.ghl_location_id);
    return NextResponse.json({ users });
  } catch (e) {
    return ghlErrorResponse(e, "Erro ao buscar usuários");
  }
}
