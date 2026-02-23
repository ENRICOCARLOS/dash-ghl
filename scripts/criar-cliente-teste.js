/**
 * Cria um cliente de teste e vincula ao usuário Carlos@gmail.com.
 * Rode: node scripts/criar-cliente-teste.js
 */

const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env.local");
if (!fs.existsSync(envPath)) {
  console.error("Arquivo .env.local não encontrado.");
  process.exit(1);
}
const envContent = fs.readFileSync(envPath, "utf8");
envContent.split("\n").forEach((line) => {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) {
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    process.env[m[1]] = val;
  }
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local");
  process.exit(1);
}

async function main() {
  const { createClient } = require("@supabase/supabase-js");
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const email = "Carlos@gmail.com";
  const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const user = listData?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    console.error("Usuário Carlos@gmail.com não encontrado. Rode antes: node scripts/criar-usuario.js");
    process.exit(1);
  }

  const client = {
    name: "Cliente Teste GHL",
    ghl_api_key: "test-api-key-123",
    ghl_location_id: "test-location-id-123",
  };

  const { data: newClient, error: errInsert } = await supabase
    .from("clients")
    .insert(client)
    .select("id")
    .single();

  if (errInsert) {
    if (errInsert.code === "23505") {
      console.log("Cliente com esse location_id já existe. Vinculando ao usuário...");
      const { data: existing } = await supabase
        .from("clients")
        .select("id")
        .eq("ghl_location_id", client.ghl_location_id)
        .single();
      if (existing) {
        await supabase.from("user_clients").upsert(
          { user_id: user.id, client_id: existing.id },
          { onConflict: "user_id,client_id" }
        );
        await supabase.from("user_active_client").upsert(
          { user_id: user.id, client_id: existing.id },
          { onConflict: "user_id" }
        );
        console.log("Cliente de teste já existia; vínculo com Carlos feito.");
        return;
      }
    }
    console.error("Erro ao criar cliente:", errInsert.message);
    process.exit(1);
  }

  const { error: errLink } = await supabase
    .from("user_clients")
    .insert({ user_id: user.id, client_id: newClient.id });

  if (errLink) {
    console.error("Erro ao vincular:", errLink.message);
    process.exit(1);
  }

  await supabase.from("user_active_client").upsert(
    { user_id: user.id, client_id: newClient.id },
    { onConflict: "user_id" }
  );

  console.log("Cliente de teste criado e vinculado a Carlos@gmail.com:");
  console.log("  Nome:", client.name);
  console.log("  GHL Location ID:", client.ghl_location_id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
