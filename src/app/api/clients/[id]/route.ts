import { createClient, getAuthUser } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const supabase = await createClient();

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "ADM") return NextResponse.json({ error: "Apenas ADM" }, { status: 403 });

  const body = await request.json();
  const { name, ghl_api_key, ghl_location_id, report_slug, fb_access_token, fb_ad_account_id } = body as {
    name?: string;
    ghl_api_key?: string;
    ghl_location_id?: string;
    report_slug?: string;
    fb_access_token?: string | null;
    fb_ad_account_id?: string | null;
  };

  const updates: Record<string, string | null> = {};
  if (name !== undefined) updates.name = name.trim();
  if (ghl_api_key !== undefined) updates.ghl_api_key = ghl_api_key.trim();
  if (ghl_location_id !== undefined) updates.ghl_location_id = ghl_location_id.trim();
  if (report_slug !== undefined) updates.report_slug = String(report_slug).trim() || "padrao";
  if (fb_access_token !== undefined) updates.fb_access_token = fb_access_token == null ? null : String(fb_access_token).trim() || null;
  if (fb_ad_account_id !== undefined) updates.fb_ad_account_id = fb_ad_account_id == null ? null : String(fb_ad_account_id).trim() || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 });
  }

  const { error } = await supabase.from("clients").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const supabase = await createClient();

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "ADM") return NextResponse.json({ error: "Apenas ADM" }, { status: 403 });

  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
