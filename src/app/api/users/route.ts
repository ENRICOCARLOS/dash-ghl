import { getAuthUser } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const service = createServiceClient();
  const { data: profile } = await service.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "ADM") return NextResponse.json({ error: "Apenas ADM" }, { status: 403 });

  const { data, error } = await service.from("profiles").select("id, email, full_name, role, created_at").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: links } = await service.from("user_clients").select("user_id, clients(id, name)");
  const byUser: Record<string, { id: string; name: string }[]> = {};
  const rows = (links ?? []) as unknown as { user_id: string; clients: { id: string; name: string } | null }[];
  for (const r of rows) {
    if (!r.clients) continue;
    if (!byUser[r.user_id]) byUser[r.user_id] = [];
    byUser[r.user_id].push(r.clients);
  }

  const users = (data ?? []).map((u) => ({ ...u, clients: byUser[u.id] ?? [] }));
  return NextResponse.json(users);
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const service = createServiceClient();
  const { data: profile } = await service.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "ADM") return NextResponse.json({ error: "Apenas ADM" }, { status: 403 });

  const body = await request.json();
  const { email, senha, full_name, client_ids } = body as {
    email: string;
    senha: string;
    full_name?: string;
    client_ids?: string[];
  };

  if (!email?.trim() || !senha?.trim()) {
    return NextResponse.json({ error: "E-mail e senha obrigatórios." }, { status: 400 });
  }

  const { data: newUser, error: authError } = await service.auth.admin.createUser({
    email: email.trim(),
    password: senha,
    email_confirm: true,
    user_metadata: { full_name: full_name ?? "", role: "user" },
  });

  if (authError) return NextResponse.json({ error: authError.message }, { status: 400 });

  if (Array.isArray(client_ids) && client_ids.length > 0) {
    const rows = client_ids.map((client_id: string) => ({ user_id: newUser.user.id, client_id }));
    await service.from("user_clients").insert(rows);
  }

  return NextResponse.json({ id: newUser.user.id, ok: true });
}
