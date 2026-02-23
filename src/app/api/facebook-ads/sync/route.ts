import { getFacebookCredentials } from "@/lib/facebook-credentials";
import { facebookErrorResponse } from "@/lib/facebook-error-response";
import {
  getInsightsDaily,
  getAdNamesBatch,
  type FacebookDailyInsightRow,
} from "@/lib/facebook-ads";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const lastSyncByClient = new Map<string, number>();

/** Formata data para YYYY-MM-DD (formato exigido pela API do Meta). */
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Normaliza data para YYYY-MM-DD. Aceita YYYY-MM-DD ou dd/mm/yyyy.
 */
function normalizeToMetaDate(value: unknown): string | null {
  if (value == null || typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  // Já está YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // dd/mm/yyyy ou dd-mm-yyyy
  const match = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    const d = new Date(parseInt(year!, 10), parseInt(month!, 10) - 1, parseInt(day!, 10));
    if (!Number.isNaN(d.getTime())) return toDateStr(d);
  }
  return null;
}

/** Retorna lista de dias entre since e until (inclusive), em YYYY-MM-DD. */
function daysBetween(since: string, until: string): string[] {
  const out: string[] = [];
  const a = new Date(since + "T12:00:00Z");
  const b = new Date(until + "T12:00:00Z");
  if (a.getTime() > b.getTime()) return out;
  const cur = new Date(a);
  while (cur.getTime() <= b.getTime()) {
    out.push(toDateStr(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Sincronização:
 * - Se body tiver date_start e date_end: atualiza dia a dia (uma requisição por dia) no intervalo.
 * - Senão: incremental (último dia no banco até hoje).
 * Datas devem ser YYYY-MM-DD ou dd/mm/yyyy; a API do Meta usa YYYY-MM-DD.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const clientId = (body.client_id as string) || null;
  const cred = await getFacebookCredentials(request, clientId, true);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  const now = Date.now();
  const last = lastSyncByClient.get(cred.client_id);
  if (last != null && now - last < SYNC_COOLDOWN_MS) {
    const retryAfterSec = Math.ceil((SYNC_COOLDOWN_MS - (now - last)) / 1000);
    return NextResponse.json(
      {
        error: "Aguarde antes de atualizar novamente. Rate limit: 1 atualização a cada 5 minutos.",
        retry_after_seconds: retryAfterSec,
      },
      { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
    );
  }
  lastSyncByClient.set(cred.client_id, now);

  const service = createServiceClient();
  const today = toDateStr(new Date());

  const dateStartRaw = normalizeToMetaDate(body.date_start);
  const dateEndRaw = normalizeToMetaDate(body.date_end);
  const useDateRange = dateStartRaw != null && dateEndRaw != null;

  let since: string;
  let until: string;
  let daysToFetch: string[];

  if (useDateRange) {
    since = dateStartRaw;
    until = dateEndRaw;
    const start = new Date(since + "T12:00:00Z");
    const end = new Date(until + "T12:00:00Z");
    if (start.getTime() > end.getTime()) {
      return NextResponse.json(
        { error: "Data início deve ser anterior ou igual à data fim." },
        { status: 400 }
      );
    }
    daysToFetch = daysBetween(since, until);
  } else {
    // Comportamento incremental: último dia no banco até hoje
    const { data: maxRow } = await service
      .from("facebook_ads_daily_insights")
      .select("date")
      .eq("client_id", cred.client_id)
      .order("date", { ascending: false })
      .limit(1)
      .single();

    if (maxRow?.date) {
      since = typeof maxRow.date === "string" ? maxRow.date.slice(0, 10) : toDateStr(new Date(maxRow.date));
    } else {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      since = toDateStr(d);
    }
    until = today;
    daysToFetch = daysBetween(since, until);
  }

  try {
    const token = cred.fb_access_token;
    const accountId = cred.fb_ad_account_id;

    // Requisição dia a dia para a API do Meta (evita agregação do intervalo)
    const allRows: FacebookDailyInsightRow[] = [];
    for (const day of daysToFetch) {
      const dayRows = await getInsightsDaily(token, accountId, day, day);
      allRows.push(...dayRows);
    }

    const adIds = [...new Set(allRows.map((r) => r.ad_id).filter(Boolean))] as string[];
    if (adIds.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "Nenhum dado de anúncio no período.",
        rows_upserted: 0,
        since,
        until,
      });
    }

    const adInfoMap = await getAdNamesBatch(token, adIds);

    const toUpsert = allRows
      .filter((r) => r.date_start && r.ad_id)
      .map((r) => {
        const info = adInfoMap.get(r.ad_id!);
        return {
          client_id: cred.client_id,
          date: r.date_start!.slice(0, 10),
          campaign_id: info?.campaign?.id ?? r.campaign_id ?? "",
          campaign_name: info?.campaign?.name ?? "",
          adset_id: info?.adset?.id ?? r.adset_id ?? "",
          adset_name: info?.adset?.name ?? "",
          ad_id: r.ad_id!,
          ad_name: info?.name ?? "",
          impressions: parseInt(String(r.impressions ?? "0"), 10) || 0,
          clicks: parseInt(String(r.clicks ?? "0"), 10) || 0,
          spend: parseFloat(String(r.spend ?? "0")) || 0,
        };
      });

    for (const row of toUpsert) {
      await service
        .from("facebook_ads_daily_insights")
        .upsert(row, { onConflict: "client_id,date,ad_id" });
    }

    const message = useDateRange
      ? `Meta: ${toUpsert.length} registros (${daysToFetch.length} dias).`
      : "Dados Meta atualizados (incremental: último dia atualizado + novos).";

    return NextResponse.json({
      ok: true,
      message,
      rows_upserted: toUpsert.length,
      since,
      until,
    });
  } catch (e) {
    return facebookErrorResponse(e, "Erro ao sincronizar dados do Facebook Ads");
  }
}
