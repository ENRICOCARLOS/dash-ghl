import { createClient, getAuthUser } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const supabase = await createClient();

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "ADM") return NextResponse.json({ error: "Apenas ADM" }, { status: 403 });

  const body = await request.json();
  const { user_id, client_id } = body as { user_id: string; client_id: string };
  if (!user_id || !client_id) {
    return NextResponse.json({ error: "user_id e client_id obrigatórios." }, { status: 400 });
  }

  const { error } = await supabase.from("user_clients").insert({ user_id, client_id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const supabase = await createClient();

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "ADM") return NextResponse.json({ error: "Apenas ADM" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const user_id = searchParams.get("user_id");
  const client_id = searchParams.get("client_id");
  if (!user_id || !client_id) {
    return NextResponse.json({ error: "user_id e client_id obrigatórios." }, { status: 400 });
  }

  const { error } = await supabase.from("user_clients").delete().eq("user_id", user_id).eq("client_id", client_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
