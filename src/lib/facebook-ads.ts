/**
 * Cliente para Facebook Marketing API (Gerenciador de Anúncios)
 * Base: https://graph.facebook.com
 * Docs: https://developers.facebook.com/docs/marketing-api
 */

const GRAPH_BASE = "https://graph.facebook.com";
const API_VERSION = "v21.0";

export class FacebookAdsApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: number
  ) {
    super(message);
    this.name = "FacebookAdsApiError";
  }
}

function buildUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`${GRAPH_BASE}/${API_VERSION}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

/** Conta de anúncios (retornada por /me/adaccounts). */
export type FacebookAdAccount = {
  id: string;
  name?: string;
  account_id?: string;
  account_status?: number;
};

/** Campanha (retornada por /act_XXX/campaigns). */
export type FacebookCampaign = {
  id: string;
  name: string;
  status?: string;
  objective?: string;
  created_time?: string;
  updated_time?: string;
};

/** Insight agregado (métricas de performance). */
export type FacebookInsight = {
  date_start?: string;
  date_stop?: string;
  impressions?: string;
  clicks?: string;
  spend?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  reach?: string;
  frequency?: string;
  [key: string]: string | undefined;
};

/** Lista contas de anúncios disponíveis para o token (útil para configurar qual usar). */
export async function getAdAccounts(accessToken: string): Promise<FacebookAdAccount[]> {
  const key = accessToken != null ? String(accessToken).trim() : "";
  if (!key) throw new FacebookAdsApiError("Token de acesso Facebook é obrigatório", 400);

  const url = buildUrl("/me/adaccounts", {
    access_token: key,
    fields: "id,name,account_id,account_status",
  });

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = data?.error ?? {};
    throw new FacebookAdsApiError(
      err.message ?? "Erro ao listar contas de anúncios",
      res.status,
      err.code
    );
  }

  const list = data.data ?? [];
  return Array.isArray(list) ? list : [];
}

/** Normaliza ID da conta: aceita com ou sem prefixo "act_". */
export function normalizeAdAccountId(adAccountId: string | null | undefined): string {
  const raw = adAccountId != null ? String(adAccountId).trim() : "";
  if (!raw) throw new FacebookAdsApiError("ID da conta de anúncios é obrigatório", 400);
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

/** Lista campanhas da conta de anúncios. */
export async function getCampaigns(
  accessToken: string,
  adAccountId: string,
  opts?: { status?: string }
): Promise<FacebookCampaign[]> {
  const token = accessToken != null ? String(accessToken).trim() : "";
  if (!token) throw new FacebookAdsApiError("Token de acesso Facebook é obrigatório", 400);
  const accountId = normalizeAdAccountId(adAccountId);

  const params: Record<string, string> = {
    access_token: token,
    fields: "id,name,status,objective,created_time,updated_time",
  };
  if (opts?.status) params["filtering"] = JSON.stringify([{ field: "campaign.effective_status", operator: "IN", value: [opts.status] }]);

  const url = buildUrl(`/${accountId}/campaigns`, params);
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = data?.error ?? {};
    throw new FacebookAdsApiError(
      err.message ?? "Erro ao listar campanhas",
      res.status,
      err.code
    );
  }

  const list = data.data ?? [];
  return Array.isArray(list) ? list : [];
}

/** Parâmetros para buscar insights (período ou preset). */
export type FacebookInsightsParams = {
  /** Período customizado (YYYY-MM-DD). */
  since?: string;
  until?: string;
  /** Ou use preset: today, yesterday, last_7d, last_30d, this_month, last_month, etc. */
  date_preset?: string;
  /** Nível de agregação: account, campaign, adset, ad. */
  level?: "account" | "campaign" | "adset" | "ad";
};

const DEFAULT_INSIGHT_FIELDS = [
  "impressions",
  "clicks",
  "spend",
  "ctr",
  "cpc",
  "cpm",
  "reach",
  "frequency",
].join(",");

/** Busca insights (métricas) da conta, campanhas ou anúncios. */
export async function getInsights(
  accessToken: string,
  adAccountId: string,
  params: FacebookInsightsParams & { fields?: string }
): Promise<FacebookInsight[]> {
  const token = accessToken != null ? String(accessToken).trim() : "";
  if (!token) throw new FacebookAdsApiError("Token de acesso Facebook é obrigatório", 400);
  const accountId = normalizeAdAccountId(adAccountId);

  const q: Record<string, string> = {
    access_token: token,
    fields: params.fields ?? DEFAULT_INSIGHT_FIELDS,
  };
  if (params.level) q.level = params.level;
  if (params.date_preset) q.date_preset = params.date_preset;
  if (params.since)
    q.time_range = JSON.stringify({ since: params.since, until: params.until || params.since });

  const url = buildUrl(`/${accountId}/insights`, q);
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = data?.error ?? {};
    throw new FacebookAdsApiError(
      err.message ?? "Erro ao buscar insights",
      res.status,
      err.code
    );
  }

  const list = data.data ?? [];
  return Array.isArray(list) ? list : [];
}

/** Insight diário por anúncio (uma linha por dia por ad). */
export type FacebookDailyInsightRow = {
  date_start: string;
  date_stop: string;
  ad_id?: string;
  campaign_id?: string;
  adset_id?: string;
  impressions?: string;
  clicks?: string;
  spend?: string;
  [key: string]: string | undefined;
};

/** Busca insights com quebra por dia (time_increment=1), nível anúncio. */
export async function getInsightsDaily(
  accessToken: string,
  adAccountId: string,
  since: string,
  until: string
): Promise<FacebookDailyInsightRow[]> {
  const token = accessToken != null ? String(accessToken).trim() : "";
  if (!token) throw new FacebookAdsApiError("Token de acesso Facebook é obrigatório", 400);
  const accountId = normalizeAdAccountId(adAccountId);

  const q: Record<string, string> = {
    access_token: token,
    level: "ad",
    time_increment: "1",
    fields: "ad_id,campaign_id,adset_id,impressions,clicks,spend",
    time_range: JSON.stringify({ since, until }),
  };

  const url = buildUrl(`/${accountId}/insights`, q);
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = data?.error ?? {};
    throw new FacebookAdsApiError(
      err.message ?? "Erro ao buscar insights diários",
      res.status,
      err.code
    );
  }

  const list = data.data ?? [];
  const rows = Array.isArray(list) ? list : [];
  return rows.map((r: Record<string, unknown>) => {
    const out: FacebookDailyInsightRow = {
      date_start: String(r.date_start ?? ""),
      date_stop: String(r.date_stop ?? ""),
      impressions: r.impressions != null ? String(r.impressions) : "0",
      clicks: r.clicks != null ? String(r.clicks) : "0",
      spend: r.spend != null ? String(r.spend) : "0",
    };
    if (r.ad_id != null) out.ad_id = String(r.ad_id);
    if (r.campaign_id != null) out.campaign_id = String(r.campaign_id);
    if (r.adset_id != null) out.adset_id = String(r.adset_id);
    return out;
  });
}

export type FacebookAdInfo = {
  id: string;
  name?: string;
  campaign?: { id: string; name?: string };
  adset?: { id: string; name?: string };
};

const BATCH_IDS_CHUNK = 50;

/** Busca em lote nomes de anúncios e campanha/conjunto. */
export async function getAdNamesBatch(
  accessToken: string,
  adIds: string[]
): Promise<Map<string, FacebookAdInfo>> {
  const token = accessToken != null ? String(accessToken).trim() : "";
  if (!token) throw new FacebookAdsApiError("Token de acesso Facebook é obrigatório", 400);
  const result = new Map<string, FacebookAdInfo>();

  for (let i = 0; i < adIds.length; i += BATCH_IDS_CHUNK) {
    const chunk = adIds.slice(i, i + BATCH_IDS_CHUNK);
    const ids = chunk.join(",");
    const url = buildUrl("/", {
      access_token: token,
      ids,
      fields: "name,campaign{id,name},adset{id,name}",
    });
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const err = (data?.error ?? data)?.error ?? {};
      throw new FacebookAdsApiError(
        err.message ?? "Erro ao buscar dados dos anúncios",
        res.status,
        err.code
      );
    }

    for (const id of chunk) {
      const obj = data[id];
      if (obj && typeof obj === "object") {
        result.set(id, {
          id,
          name: obj.name != null ? String(obj.name) : "",
          campaign: obj.campaign
            ? { id: String(obj.campaign.id ?? ""), name: obj.campaign.name != null ? String(obj.campaign.name) : "" }
            : undefined,
          adset: obj.adset
            ? { id: String(obj.adset.id ?? ""), name: obj.adset.name != null ? String(obj.adset.name) : "" }
            : undefined,
        });
      }
    }
  }
  return result;
}
