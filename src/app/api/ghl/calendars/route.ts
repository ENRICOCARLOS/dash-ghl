import { getGhlCredentials } from "@/lib/ghl-credentials";
import { ghlErrorResponse } from "@/lib/ghl-error-response";
import { getCalendars } from "@/lib/ghl";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const cred = await getGhlCredentials(request, clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  try {
    const calendars = await getCalendars(cred.ghl_api_key, cred.ghl_location_id);
    return NextResponse.json({ calendars });
  } catch (e) {
    return ghlErrorResponse(e, "Erro ao buscar calendários");
  }
}
