import { getGhlCredentials } from "@/lib/ghl-credentials";
import { createServiceClient } from "@/lib/supabase/server";
import { getOpportunityCustomFields } from "@/lib/ghl";
import { NextRequest, NextResponse } from "next/server";

const KEY_OPPORTUNITY_IMPORT_CUSTOM_FIELDS = "opportunity_import_custom_fields";

type SelectedField = { id: string; name: string };

/** GET: retorna campos customizados disponíveis no GHL e os atualmente selecionados para importação. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const cred = await getGhlCredentials(request, clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  try {
    const [customFields, predef] = await Promise.all([
      getOpportunityCustomFields(cred.ghl_api_key, cred.ghl_location_id),
      (async () => {
        const service = createServiceClient();
        const { data } = await service
          .from("location_predefinitions")
          .select("value")
          .eq("client_id", cred.client_id)
          .eq("key", KEY_OPPORTUNITY_IMPORT_CUSTOM_FIELDS)
          .eq("active", true)
          .maybeSingle();
        return data?.value ?? null;
      })(),
    ]);

    let selected: SelectedField[] = [];
    if (predef && typeof predef === "string") {
      try {
        const parsed = JSON.parse(predef) as unknown;
        selected = Array.isArray(parsed)
          ? (parsed as SelectedField[]).filter((x) => x && typeof x.id === "string")
          : [];
      } catch {
        selected = [];
      }
    }

    return NextResponse.json({
      customFields,
      selected,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao listar campos";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST: salva quais campos customizados de oportunidades importar para o banco.
 * Cria automaticamente as colunas cf_<fieldId> na tabela opportunities.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const clientId = (body.client_id as string) ?? null;
  const selected = Array.isArray(body.selected) ? (body.selected as SelectedField[]) : [];

  const cred = await getGhlCredentials(request, clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  const normalized: SelectedField[] = selected
    .filter((x): x is SelectedField => x != null && typeof x.id === "string" && String(x.id).trim() !== "")
    .map((x) => ({ id: String(x.id).trim(), name: String((x as SelectedField).name ?? "").trim() || String(x.id).trim() }));

  const service = createServiceClient();

  try {
    await service
      .from("location_predefinitions")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("client_id", cred.client_id)
      .eq("key", KEY_OPPORTUNITY_IMPORT_CUSTOM_FIELDS);

    const value = JSON.stringify(normalized);
    if (normalized.length > 0) {
      await service.from("location_predefinitions").insert({
        client_id: cred.client_id,
        key: KEY_OPPORTUNITY_IMPORT_CUSTOM_FIELDS,
        value,
        active: true,
      });
    }

    for (const field of normalized) {
      await service.rpc("add_opportunity_custom_field_column", { field_id: field.id });
    }

    return NextResponse.json({ ok: true, selected: normalized });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao salvar campos para importação";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
