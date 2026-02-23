import { getAuthUser } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const service = createServiceClient();
  const { data: profile } = await service.from("profiles").select("role").eq("id", user.id).single();
  const isAdm = profile?.role === "ADM";

  if (isAdm) {
    const { data, error } = await service.from("clients").select("*").order("name");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data ?? []);
  }

  const { data: links } = await service
    .from("user_clients")
    .select("client_id, clients(*)")
    .eq("user_id", user.id);
  const clients = (links ?? []).map((l: { clients: unknown }) => l.clients).filter(Boolean);
  return NextResponse.json(clients);
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const service = createServiceClient();
  const { data: profile } = await service.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "ADM") return NextResponse.json({ error: "Apenas ADM" }, { status: 403 });

  const body = await request.json();
  const { name, ghl_api_key, ghl_location_id, usuario, senha } = body as {
    name: string;
    ghl_api_key: string;
    ghl_location_id: string;
    usuario: string;
    senha: string;
  };

  if (!name?.trim() || !ghl_api_key?.trim() || !ghl_location_id?.trim() || !usuario?.trim() || !senha?.trim()) {
    return NextResponse.json({ error: "Preencha nome, GHL API Key, GHL Location ID, usuário e senha." }, { status: 400 });
  }

  const { data: newAuthUser, error: authError } = await service.auth.admin.createUser({
    email: usuario.trim(),
    password: senha,
    email_confirm: true,
    user_metadata: { full_name: name, role: "user" },
  });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 400 });
  }

  const { data: newClient, error: clientError } = await service
    .from("clients")
    .insert({ name: name.trim(), ghl_api_key: ghl_api_key.trim(), ghl_location_id: ghl_location_id.trim() })
    .select("id")
    .single();

  if (clientError) {
    await service.auth.admin.deleteUser(newAuthUser.user.id);
    return NextResponse.json({ error: clientError.message }, { status: 500 });
  }

  const { error: linkError } = await service
    .from("user_clients")
    .insert({ user_id: newAuthUser.user.id, client_id: newClient.id });

  if (linkError) {
    await service.from("clients").delete().eq("id", newClient.id);
    await service.auth.admin.deleteUser(newAuthUser.user.id);
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }

  // Define a conta ativa do usuário principal no primeiro login (esta conta)
  const { error: activeErr } = await service
    .from("user_active_client")
    .upsert({ user_id: newAuthUser.user.id, client_id: newClient.id }, { onConflict: "user_id" });
  if (activeErr) {
    // Não falha a criação; o front escolhe o primeiro cliente se não houver ativo
  }

  return NextResponse.json({ id: newClient.id, ok: true });
}
