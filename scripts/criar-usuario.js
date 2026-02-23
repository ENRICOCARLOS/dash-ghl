/**
 * Script: cria um usuário no Supabase (Auth + profile).
 * Uso: node scripts/criar-usuario.js <email> <senha> [nome]
 * Exemplo: node scripts/criar-usuario.js usuario@exemplo.com MinhaSenha123 "Nome Completo"
 * (Usa .env.local na raiz para NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.)
 */

const fs = require("fs");
const path = require("path");

// Carrega .env.local
const envPath = path.join(__dirname, "..", ".env.local");
if (!fs.existsSync(envPath)) {
  console.error("Arquivo .env.local não encontrado na raiz do projeto.");
  process.exit(1);
}
const envContent = fs.readFileSync(envPath, "utf8");
envContent.split("\n").forEach((line) => {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) {
    const key = m[1];
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    process.env[key] = val;
  }
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local");
  process.exit(1);
}

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  const fullName = process.argv[4] || "Usuário";

  if (!email || !password) {
    console.error("Uso: node scripts/criar-usuario.js <email> <senha> [nome]");
    process.exit(1);
  }

  const { createClient } = require("@supabase/supabase-js");
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (error) {
    if (error.message.includes("already been registered") || error.code === "user_already_exists") {
      console.log("Usuário já existe. Atualizando senha e garantindo profile ADM...");
      const { data: list } = await supabase.auth.admin.listUsers();
      const user = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (user) {
        await supabase.auth.admin.updateUserById(user.id, { password });
        const { error: upProfile } = await supabase.from("profiles").update({ role: "ADM" }).eq("id", user.id);
        if (!upProfile) console.log("Profile atualizado para ADM.");
        console.log("Pronto. Faça login com:", email, "/", password);
        return;
      }
    }
    console.error("Erro:", error.message);
    process.exit(1);
  }

  const userId = data?.user?.id;
  if (!userId) {
    console.error("Usuário não foi criado.");
    process.exit(1);
  }

  const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true });
  const isFirst = (count ?? 0) === 0;
  const { error: profileErr } = await supabase.from("profiles").insert({
    id: userId,
    email: data.user.email,
    full_name: data.user.user_metadata?.full_name ?? fullName,
    role: isFirst ? "ADM" : "user",
  });

  if (profileErr) {
    const { error: upErr } = await supabase.from("profiles").update({ role: "ADM" }).eq("id", userId);
    if (upErr) console.warn("Aviso profile:", profileErr.message);
  } else {
    console.log("Profile criado.", isFirst ? "Role: ADM (primeiro usuário)." : "Role: user.");
  }

  console.log("Usuário criado. Faça login com:", email, "/", password);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
