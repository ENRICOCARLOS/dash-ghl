import { getGhlCredentials } from "@/lib/ghl-credentials";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const KEY_SALE_DATE_FIELD_ID = "sale_date_field_id";

/** GET: retorna o campo customizado atualmente definido como "data da venda" (ou null). */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const cred = await getGhlCredentials(request, clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  const service = createServiceClient();
  const { data: row } = await service
    .from("location_predefinitions")
    .select("value")
    .eq("client_id", cred.client_id)
    .eq("key", KEY_SALE_DATE_FIELD_ID)
    .eq("active", true)
    .maybeSingle();

  return NextResponse.json({
    sale_date_field_id: row?.value ?? null,
  });
}

/**
 * POST: salva o campo customizado que representa a data da venda.
 * Antes de inserir, executa o script de desativação da linha anterior (active = false).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const clientId = (body.client_id as string) ?? null;
  const saleDateFieldId = typeof body.sale_date_field_id === "string" ? body.sale_date_field_id.trim() : "";

  const cred = await getGhlCredentials(request, clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  const service = createServiceClient();

  try {
    // Desativar a linha anterior para a mesma key (script de desativação).
    await service
      .from("location_predefinitions")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("client_id", cred.client_id)
      .eq("key", KEY_SALE_DATE_FIELD_ID);

    if (saleDateFieldId) {
      await service.from("location_predefinitions").insert({
        client_id: cred.client_id,
        key: KEY_SALE_DATE_FIELD_ID,
        value: saleDateFieldId,
        active: true,
      });
    }

    return NextResponse.json({ ok: true, sale_date_field_id: saleDateFieldId || null });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao salvar campo data da venda";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
