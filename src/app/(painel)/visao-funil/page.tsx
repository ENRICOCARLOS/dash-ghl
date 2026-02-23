"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveClient } from "@/contexts/ActiveClientContext";

type Pipeline = { id: string; name: string; stages?: { id: string; name: string }[] };
type Calendar = { id: string; name: string };
type User = { id: string; name: string; email?: string };
type OpportunityCustomField = { id: string; name: string; dataType?: string };
type SelectedImportField = { id: string; name: string };

const SALE_DATE_DATA_TYPES = ["date", "datetime", "timestamp"];
function isDateDataType(dataType?: string): boolean {
  if (!dataType) return false;
  return SALE_DATE_DATA_TYPES.includes(dataType.trim().toLowerCase());
}

function predefSnapshot(pipelines: Pipeline[], calendars: Calendar[], users: User[]): string {
  return JSON.stringify({
    p: pipelines.map((p) => ({ id: p.id, name: p.name, stages: (p.stages ?? []).map((s) => ({ id: s.id, name: s.name })) })),
    c: calendars.map((c) => ({ id: c.id, name: c.name })),
    u: users.map((u) => ({ id: u.id, name: u.name, email: u.email })),
  });
}

function loadData(
  clientId: string,
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
): Promise<{ pipelines: Pipeline[]; calendars: Calendar[]; users: User[] }> {
  const q = `?client_id=${encodeURIComponent(clientId)}`;
  return Promise.all([
    authFetch(`/api/ghl/pipelines${q}`).then((r) => r.json()),
    authFetch(`/api/ghl/calendars${q}`).then((r) => r.json()),
    authFetch(`/api/ghl/users${q}`).then((r) => r.json()),
  ]).then(([pipRes, calRes, usrRes]) => {
    if (pipRes.error) throw new Error(pipRes.error);
    if (calRes.error) throw new Error(calRes.error);
    if (usrRes.error) throw new Error(usrRes.error);
    return {
      pipelines: pipRes.pipelines ?? [],
      calendars: calRes.calendars ?? [],
      users: usrRes.users ?? [],
    };
  });
}

function loadLastSaved(
  clientId: string,
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
): Promise<string | null> {
  const q = `?client_id=${encodeURIComponent(clientId)}`;
  return authFetch(`/api/ghl/predefinitions/last-saved${q}`)
    .then((r) => r.json())
    .then((data) => (data.error ? null : (data.last_saved_at ?? null)));
}

/** Carrega apenas dados salvos no Supabase (sem chamar API do GHL). Usado ao abrir a tela. */
function loadFromSupabaseOnly(
  clientId: string,
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
): Promise<{
  pipelines: Pipeline[];
  calendars: Calendar[];
  users: User[];
  last_saved_at: string | null;
  sale_date_field_id: string | null;
  opportunity_import_selected: SelectedImportField[];
  utm_mapping: UtmMappingState;
  utm_source_suggestions: string[];
}> {
  const q = `?client_id=${encodeURIComponent(clientId)}`;
  return authFetch(`/api/ghl/predefinitions/load-from-supabase${q}`)
    .then((r) => r.json())
    .then((data) => {
      if (data.error) throw new Error(data.error);
      return {
        pipelines: data.pipelines ?? [],
        calendars: data.calendars ?? [],
        users: data.users ?? [],
        last_saved_at: data.last_saved_at ?? null,
        sale_date_field_id: data.sale_date_field_id ?? null,
        opportunity_import_selected: Array.isArray(data.opportunity_import_selected) ? data.opportunity_import_selected : [],
        utm_mapping: {
          utm_source_field_id: data.utm_mapping?.utm_source_field_id ?? null,
          utm_campaign_field_id: data.utm_mapping?.utm_campaign_field_id ?? null,
          utm_medium_field_id: data.utm_mapping?.utm_medium_field_id ?? null,
          utm_term_field_id: data.utm_mapping?.utm_term_field_id ?? null,
          utm_content_field_id: data.utm_mapping?.utm_content_field_id ?? null,
          facebook_campaign_utm: data.utm_mapping?.facebook_campaign_utm ?? null,
          facebook_adset_utm: data.utm_mapping?.facebook_adset_utm ?? null,
          facebook_creative_utm: data.utm_mapping?.facebook_creative_utm ?? null,
          facebook_utm_source_terms: Array.isArray(data.utm_mapping?.facebook_utm_source_terms)
            ? data.utm_mapping.facebook_utm_source_terms.filter((x: unknown): x is string => typeof x === "string").map((s: string) => s.trim()).filter(Boolean)
            : [],
          opportunity_ads_link_opportunity_column: data.utm_mapping?.opportunity_ads_link_opportunity_column ?? null,
          opportunity_ads_link_ads_column: data.utm_mapping?.opportunity_ads_link_ads_column ?? null,
        },
        utm_source_suggestions: Array.isArray(data.utm_source_suggestions) ? data.utm_source_suggestions : [],
      };
    });
}

function loadSaleDateFieldData(
  clientId: string,
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
): Promise<{ customFields: OpportunityCustomField[]; saleDateFieldId: string | null }> {
  const q = `?client_id=${encodeURIComponent(clientId)}`;
  return Promise.all([
    authFetch(`/api/ghl/opportunity-custom-fields${q}`).then((r) => r.json()),
    authFetch(`/api/ghl/predefinitions/sale-date-field${q}`).then((r) => r.json()),
  ]).then(([cfRes, sdRes]) => {
    if (cfRes.error) throw new Error(cfRes.error);
    return {
      customFields: cfRes.customFields ?? [],
      saleDateFieldId: sdRes.sale_date_field_id ?? null,
    };
  });
}

function loadImportCustomFields(
  clientId: string,
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
): Promise<{ customFields: OpportunityCustomField[]; selected: SelectedImportField[] }> {
  const q = `?client_id=${encodeURIComponent(clientId)}`;
  return authFetch(`/api/ghl/predefinitions/opportunity-custom-fields-import${q}`)
    .then((r) => r.json())
    .then((oppRes) => {
      if (oppRes.error) throw new Error(oppRes.error);
      return {
        customFields: oppRes.customFields ?? [],
        selected: Array.isArray(oppRes.selected) ? oppRes.selected : [],
      };
    });
}

const UTM_COLUMN_OPTIONS = [
  { value: "utm_source", label: "utm_source" },
  { value: "utm_campaign", label: "utm_campaign" },
  { value: "utm_medium", label: "utm_medium" },
  { value: "utm_term", label: "utm_term" },
  { value: "utm_content", label: "utm_content" },
] as const;

type UtmMappingState = {
  utm_source_field_id: string | null;
  utm_campaign_field_id: string | null;
  utm_medium_field_id: string | null;
  utm_term_field_id: string | null;
  utm_content_field_id: string | null;
  facebook_campaign_utm: string | null;
  facebook_adset_utm: string | null;
  facebook_creative_utm: string | null;
  facebook_utm_source_terms: string[];
  /** Coluna de oportunidades que liga à tabela de anúncios Meta (para puxar investimento). */
  opportunity_ads_link_opportunity_column: string | null;
  /** Coluna da tabela de anúncios Meta que liga à oportunidade. */
  opportunity_ads_link_ads_column: string | null;
};

function loadUtmMapping(
  clientId: string,
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
): Promise<UtmMappingState> {
  const q = `?client_id=${encodeURIComponent(clientId)}`;
  return authFetch(`/api/ghl/predefinitions/utm-mapping${q}`)
    .then((r) => r.json())
    .then((data) => {
      if (data.error) throw new Error(data.error);
      return {
        utm_source_field_id: data.utm_source_field_id ?? null,
        utm_campaign_field_id: data.utm_campaign_field_id ?? null,
        utm_medium_field_id: data.utm_medium_field_id ?? null,
        utm_term_field_id: data.utm_term_field_id ?? null,
        utm_content_field_id: data.utm_content_field_id ?? null,
        facebook_campaign_utm: data.facebook_campaign_utm ?? null,
        facebook_adset_utm: data.facebook_adset_utm ?? null,
        facebook_creative_utm: data.facebook_creative_utm ?? null,
        facebook_utm_source_terms: Array.isArray(data.facebook_utm_source_terms)
          ? data.facebook_utm_source_terms.filter((x: unknown): x is string => typeof x === "string").map((s: string) => s.trim()).filter(Boolean)
          : [],
        opportunity_ads_link_opportunity_column: data.opportunity_ads_link_opportunity_column ?? null,
        opportunity_ads_link_ads_column: data.opportunity_ads_link_ads_column ?? null,
      };
    });
}

export default function PredefinicoesPage() {
  const { authFetch } = useAuth();
  const { activeClient } = useActiveClient();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [opportunityCustomFields, setOpportunityCustomFields] = useState<OpportunityCustomField[]>([]);
  const [saleDateFieldId, setSaleDateFieldId] = useState<string | null>(null);
  const [opportunityImportFields, setOpportunityImportFields] = useState<OpportunityCustomField[]>([]);
  const [selectedOpportunityImport, setSelectedOpportunityImport] = useState<SelectedImportField[]>([]);
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saleDateFieldSaving, setSaleDateFieldSaving] = useState(false);
  const [opportunityImportSaving, setOpportunityImportSaving] = useState(false);
  const [utmMapping, setUtmMapping] = useState<UtmMappingState>({
    utm_source_field_id: null,
    utm_campaign_field_id: null,
    utm_medium_field_id: null,
    utm_term_field_id: null,
    utm_content_field_id: null,
    facebook_campaign_utm: null,
    facebook_adset_utm: null,
    facebook_creative_utm: null,
    facebook_utm_source_terms: [],
    opportunity_ads_link_opportunity_column: null,
    opportunity_ads_link_ads_column: null,
  });
  const [facebookSourceTermInput, setFacebookSourceTermInput] = useState("");
  const [utmSourceSuggestions, setUtmSourceSuggestions] = useState<string[]>([]);
  const [utmMappingSaving, setUtmMappingSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const initialPredefRef = useRef<string>("");

  const clientId = activeClient?.id;

  const loadUtmSourceSuggestions = useCallback((cId: string) => {
    const q = `?client_id=${encodeURIComponent(cId)}`;
    authFetch(`/api/ghl/predefinitions/utm-source-suggestions${q}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.terms)) setUtmSourceSuggestions(data.terms);
      })
      .catch(() => {});
  }, [authFetch]);

  /** Carrega só do Supabase (ao abrir a tela). Não chama API do GHL. */
  const loadFromSupabase = useCallback(async () => {
    if (!clientId) return;
    setFetching(true);
    setError(null);
    try {
      const data = await loadFromSupabaseOnly(clientId, authFetch);
      setPipelines(data.pipelines);
      setCalendars(data.calendars);
      setUsers(data.users);
      setOpportunityCustomFields([]); // lista do GHL só ao clicar "Atualizar dados"
      setSaleDateFieldId(data.sale_date_field_id);
      setOpportunityImportFields([]);
      setSelectedOpportunityImport(data.opportunity_import_selected);
      setUtmMapping(data.utm_mapping);
      setLastSavedAt(data.last_saved_at);
      setUtmSourceSuggestions(data.utm_source_suggestions);
      initialPredefRef.current = predefSnapshot(data.pipelines, data.calendars, data.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar dados");
    } finally {
      setFetching(false);
    }
  }, [clientId, authFetch]);

  /** Carrega dados da API do GHL + Supabase. Só chamado ao clicar em "Atualizar dados". */
  const loadAll = useCallback(async () => {
    if (!clientId) return;
    setFetching(true);
    setError(null);
    try {
      const [main, saleDate, importData, utmData, savedAt] = await Promise.all([
        loadData(clientId, authFetch),
        loadSaleDateFieldData(clientId, authFetch),
        loadImportCustomFields(clientId, authFetch),
        loadUtmMapping(clientId, authFetch),
        loadLastSaved(clientId, authFetch),
      ]);
      setPipelines(main.pipelines);
      setCalendars(main.calendars);
      setUsers(main.users);
      setOpportunityCustomFields(saleDate.customFields);
      setSaleDateFieldId(saleDate.saleDateFieldId);
      setOpportunityImportFields(importData.customFields);
      setSelectedOpportunityImport(importData.selected);
      setUtmMapping(utmData);
      setLastSavedAt(savedAt);
      initialPredefRef.current = predefSnapshot(main.pipelines, main.calendars, main.users);
      loadUtmSourceSuggestions(clientId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar dados");
    } finally {
      setFetching(false);
    }
  }, [clientId, authFetch, loadUtmSourceSuggestions]);

  useEffect(() => {
    if (!clientId) return;
    loadFromSupabase();
  }, [clientId, loadFromSupabase]);

  const handleAtualizar = async () => {
    if (!clientId) return;
    setFetching(true);
    setError(null);
    try {
      const [main, saleDate, importData, utmData, savedAt] = await Promise.all([
        loadData(clientId, authFetch),
        loadSaleDateFieldData(clientId, authFetch),
        loadImportCustomFields(clientId, authFetch),
        loadUtmMapping(clientId, authFetch),
        loadLastSaved(clientId, authFetch),
      ]);
      setPipelines(main.pipelines);
      setCalendars(main.calendars);
      setUsers(main.users);
      setOpportunityCustomFields(saleDate.customFields);
      setSaleDateFieldId(saleDate.saleDateFieldId);
      setOpportunityImportFields(importData.customFields);
      setSelectedOpportunityImport(importData.selected);
      setUtmMapping(utmData);
      setLastSavedAt(savedAt);
      initialPredefRef.current = predefSnapshot(main.pipelines, main.calendars, main.users);
      loadUtmSourceSuggestions(clientId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao atualizar dados");
    } finally {
      setFetching(false);
    }
  };

  const hasPredefChanges =
    initialPredefRef.current !== "" &&
    initialPredefRef.current !== predefSnapshot(pipelines, calendars, users);

  function formatLastSaved(iso: string | null): string {
    if (!iso) return "Nunca salvo";
    try {
      const d = new Date(iso);
      return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    } catch {
      return "Nunca salvo";
    }
  }

  const handleSalvar = async () => {
    if (!clientId) return;
    setSaving(true);
    setError(null);
    setSaveOk(false);
    try {
      const payload = {
        client_id: clientId,
        pipelines: pipelines.map((p) => ({
          id: p.id,
          name: p.name,
          stages: Array.isArray(p.stages) ? p.stages.map((s) => ({ id: s.id, name: s.name })) : [],
        })),
        calendars,
        users,
      };
      const res = await authFetch("/api/ghl/save-predefinicoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao salvar");
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 3000);
      initialPredefRef.current = predefSnapshot(pipelines, calendars, users);
      const savedAt = new Date().toISOString();
      setLastSavedAt(savedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const handleSalvarCampoDataVenda = async () => {
    if (!clientId) return;
    setSaleDateFieldSaving(true);
    setError(null);
    try {
      const res = await authFetch("/api/ghl/predefinitions/sale-date-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          sale_date_field_id: saleDateFieldId ?? "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao salvar");
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar campo data da venda");
    } finally {
      setSaleDateFieldSaving(false);
    }
  };

  const toggleOpportunityImport = (field: OpportunityCustomField) => {
    const has = selectedOpportunityImport.some((s) => s.id === field.id);
    if (has) {
      setSelectedOpportunityImport((prev) => prev.filter((s) => s.id !== field.id));
    } else {
      setSelectedOpportunityImport((prev) => [...prev, { id: field.id, name: field.name }]);
    }
  };

  const handleSalvarOpportunityImport = async () => {
    if (!clientId) return;
    setOpportunityImportSaving(true);
    setError(null);
    try {
      const res = await authFetch("/api/ghl/predefinitions/opportunity-custom-fields-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, selected: selectedOpportunityImport }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao salvar");
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar campos de oportunidades");
    } finally {
      setOpportunityImportSaving(false);
    }
  };

  const handleSalvarUtmMapping = async () => {
    if (!clientId) return;
    setUtmMappingSaving(true);
    setError(null);
    try {
      const res = await authFetch("/api/ghl/predefinitions/utm-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          ...utmMapping,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao salvar mapeamento UTM");
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar mapeamento UTM");
    } finally {
      setUtmMappingSaving(false);
    }
  };

  const addFacebookSourceTerm = () => {
    const term = facebookSourceTermInput.trim();
    if (!term) return;
    setUtmMapping((prev) => ({
      ...prev,
      facebook_utm_source_terms: Array.from(new Set([...(prev.facebook_utm_source_terms ?? []), term])),
    }));
    setFacebookSourceTermInput("");
  };

  const toggleFacebookSourceTerm = (term: string, checked: boolean) => {
    setUtmMapping((prev) => ({
      ...prev,
      facebook_utm_source_terms: checked
        ? Array.from(new Set([...(prev.facebook_utm_source_terms ?? []), term]))
        : (prev.facebook_utm_source_terms ?? []).filter((t) => t !== term),
    }));
  };

  if (!activeClient) {
    return (
      <div>
        <h1 className="page-title">Predefinições</h1>
        <p className="mt-1 text-[#7B8099]">Selecione uma conta no topo da página.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="page-title">Predefinições</h1>
            <p className="mt-2 text-[#E05C5C]">{error}</p>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={handleAtualizar} disabled={fetching} className="btn-primary px-4 py-2 text-sm">
              {fetching ? "Atualizando…" : "Atualizar dados"}
            </button>
            <button type="button" onClick={handleSalvar} disabled={saving || !hasPredefChanges} className="btn-save px-4 py-2 text-sm">
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Top bar: título + Atualizar dados + Salvar (sempre visível, cor destaque) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title text-lg">Predefinições</h1>
          <p className="mt-0.5 text-sm text-[#7B8099]">
            <strong className="text-[#E8EAF0]">{activeClient.name}</strong>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={handleAtualizar} disabled={fetching} className="btn-primary px-4 py-2 text-sm">
            {fetching ? "Atualizando…" : "Atualizar dados"}
          </button>
          <button
            type="button"
            onClick={handleSalvar}
            disabled={saving || !hasPredefChanges}
            className="btn-save px-4 py-2 text-sm"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
          <span className="text-xs text-[#7B8099]">Último salvamento: {formatLastSaved(lastSavedAt)}</span>
        </div>
      </div>

      {saveOk && (
        <div
          className="mt-2 rounded-lg border-l-4 px-2 py-1.5 text-sm"
          style={{ borderLeftColor: "#2DD4A0", background: "#2DD4A015", color: "#2DD4A0" }}
        >
          Predefinições salvas no banco.
        </div>
      )}

      {/* Data da venda — apenas campos de tipo data no GHL; coluna sale_date_value (timestamptz) no Supabase */}
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
        <span className="text-sm font-medium text-[var(--text-primary)]">Data da venda</span>
        <select
          value={saleDateFieldId ?? ""}
          onChange={(e) => setSaleDateFieldId(e.target.value || null)}
          className="min-w-[180px] rounded border border-[#1F2330] bg-[#1A1F2E] px-3 py-2 text-sm text-[#E8EAF0]"
        >
          <option value="">Criação (padrão)</option>
          {(() => {
            const dateFields = opportunityCustomFields.filter((f) => isDateDataType(f.dataType));
            return (
              <>
                {saleDateFieldId && !dateFields.some((f) => f.id === saleDateFieldId) && (
                  <option value={saleDateFieldId}>Campo configurado (atualize para ver nome)</option>
                )}
                {dateFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                    {f.dataType ? ` (${f.dataType})` : ""}
                  </option>
                ))}
              </>
            );
          })()}
        </select>
        <button
          type="button"
          onClick={handleSalvarCampoDataVenda}
          disabled={saleDateFieldSaving}
          className="btn-secondary px-3 py-2 text-sm"
        >
          {saleDateFieldSaving ? "Salvando…" : "Salvar"}
        </button>
        <span className="text-xs text-[#7B8099]">
          Apenas campos de tipo data no GHL. Coluna <code className="rounded bg-[var(--bg-elev)] px-1">sale_date_value</code> (timestamptz) no Supabase.
        </span>
        {opportunityCustomFields.length > 0 && !opportunityCustomFields.some((f) => isDateDataType(f.dataType)) && (
          <span className="text-xs text-amber-500">Nenhum campo de data encontrado. Crie um campo tipo &quot;date&quot; ou &quot;datetime&quot; nas oportunidades no GHL e clique em Atualizar dados.</span>
        )}
      </div>

      {/* Campos para importar — card maior (vários itens) */}
      <div className="mt-4">
        <div className="card card-compact overflow-hidden">
          <div className="card-header">
            <h2 className="card-title text-sm">Campos para importar</h2>
          </div>
          <p className="mb-3 text-xs text-[#7B8099]">Campos de oportunidades do GHL → colunas no banco.</p>
          <div className="max-h-40 overflow-auto">
            {opportunityImportFields.length === 0 ? (
              <p className="text-xs text-[#7B8099]">Nenhum campo no GHL. Clique em Atualizar dados.</p>
            ) : (
              <ul className="space-y-1.5">
                {opportunityImportFields.map((f) => (
                  <li key={f.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`opp-${f.id}`}
                      checked={selectedOpportunityImport.some((s) => s.id === f.id)}
                      onChange={() => toggleOpportunityImport(f)}
                      className="rounded border-[#1F2330] bg-[#1A1F2E] text-[#2DD4A0]"
                    />
                    <label htmlFor={`opp-${f.id}`} className="truncate text-sm text-[#E8EAF0] cursor-pointer">
                      {f.name}
                      {f.dataType ? ` (${f.dataType})` : ""}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={handleSalvarOpportunityImport}
            disabled={opportunityImportSaving}
            className="mt-3 w-full btn-secondary px-3 py-2 text-sm"
          >
            {opportunityImportSaving ? "Salvando…" : "Salvar e criar colunas"}
          </button>
        </div>
      </div>

      {/* Relacionamento de UTM — alinhamento e espaçamento padronizados */}
      <div className="mt-4">
        <div className="card card-compact overflow-hidden">
          <div className="card-header">
            <h2 className="card-title text-sm">Relacionamento de UTMs</h2>
          </div>
          <p className="mb-4 text-xs text-[#7B8099]">GHL e Facebook → colunas utm_* na oportunidade.</p>
          <div className="space-y-4">
            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[#7B8099]">Campos GHL → coluna UTM</p>
              <div className="space-y-2">
                {(["utm_source", "utm_campaign", "utm_medium", "utm_term", "utm_content"] as const).map((col) => (
                  <div key={col} className="flex items-center gap-4">
                    <label className="w-24 shrink-0 text-sm text-[#7B8099]">{col.replace("utm_", "")}</label>
                    <select
                      value={utmMapping[`${col}_field_id` as keyof UtmMappingState] ?? ""}
                      onChange={(e) =>
                        setUtmMapping((prev) => ({ ...prev, [`${col}_field_id`]: e.target.value || null }))
                      }
                      className="min-w-0 flex-1 max-w-xs rounded border border-[#1F2330] bg-[#1A1F2E] px-3 py-2 text-sm text-[#E8EAF0]"
                    >
                      <option value="">— Nenhum —</option>
                      {opportunityCustomFields.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-[#1F2330] pt-4">
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[#7B8099]">Facebook Ads → coluna UTM</p>
              <div className="space-y-2">
                {[
                  { key: "facebook_campaign_utm", label: "Campanha" },
                  { key: "facebook_adset_utm", label: "Conjunto" },
                  { key: "facebook_creative_utm", label: "Criativo" },
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-4">
                    <label className="w-24 shrink-0 text-sm text-[#7B8099]">{label}</label>
                    <select
                      value={utmMapping[key as keyof UtmMappingState] ?? ""}
                      onChange={(e) =>
                        setUtmMapping((prev) => ({ ...prev, [key]: e.target.value || null }))
                      }
                      className="min-w-0 flex-1 max-w-xs rounded border border-[#1F2330] bg-[#1A1F2E] px-3 py-2 text-sm text-[#E8EAF0]"
                    >
                      <option value="">— Não usar —</option>
                      {UTM_COLUMN_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-[#1F2330] pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[#7B8099]">Relação oportunidade ↔ anúncios Meta (investimento)</p>
              <p className="mb-3 text-xs text-[#7B8099]">
                Defina qual coluna da oportunidade (UTM) corresponde à coluna da tabela de anúncios da Meta.
                Com isso o sistema consegue puxar o investimento (spend) por oportunidade ou por campanha/criativo.
              </p>
              <div className="space-y-2">
                <div className="flex items-center gap-4">
                  <label className="w-48 shrink-0 text-sm text-[#7B8099]">Coluna da oportunidade</label>
                  <select
                    value={utmMapping.opportunity_ads_link_opportunity_column ?? ""}
                    onChange={(e) =>
                      setUtmMapping((prev) => ({
                        ...prev,
                        opportunity_ads_link_opportunity_column: e.target.value || null,
                      }))
                    }
                    className="min-w-0 flex-1 max-w-xs rounded border border-[#1F2330] bg-[#1A1F2E] px-3 py-2 text-sm text-[#E8EAF0]"
                  >
                    <option value="">— Nenhuma —</option>
                    {UTM_COLUMN_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-4">
                  <label className="w-48 shrink-0 text-sm text-[#7B8099]">Coluna da tabela de anúncios Meta</label>
                  <select
                    value={utmMapping.opportunity_ads_link_ads_column ?? ""}
                    onChange={(e) =>
                      setUtmMapping((prev) => ({
                        ...prev,
                        opportunity_ads_link_ads_column: e.target.value || null,
                      }))
                    }
                    className="min-w-0 flex-1 max-w-xs rounded border border-[#1F2330] bg-[#1A1F2E] px-3 py-2 text-sm text-[#E8EAF0]"
                  >
                    <option value="">— Nenhuma —</option>
                    <option value="ad_id">ad_id</option>
                    <option value="ad_name">ad_name</option>
                    <option value="campaign_id">campaign_id</option>
                    <option value="campaign_name">campaign_name</option>
                    <option value="adset_id">adset_id</option>
                    <option value="adset_name">adset_name</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="border-t border-[#1F2330] pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[#7B8099]">UTM Source (lista de termos)</p>
              <p className="mb-3 text-xs text-[#7B8099]">
                Cadastre aqui todas as possibilidades de valor para UTM Source usadas no projeto
                (ex.: meta-ads, facebook, fb_ads). Esses termos ficam salvos na configuração para cruzamento
                entre base do Meta e oportunidades.
              </p>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={facebookSourceTermInput}
                  onChange={(e) => setFacebookSourceTermInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addFacebookSourceTerm();
                    }
                  }}
                  placeholder="Digite um termo e pressione Enter"
                  className="min-w-0 flex-1 max-w-sm rounded border border-[#1F2330] bg-[#1A1F2E] px-3 py-2 text-sm text-[#E8EAF0]"
                />
                <button
                  type="button"
                  onClick={addFacebookSourceTerm}
                  className="btn-secondary px-3 py-2 text-sm"
                >
                  Adicionar
                </button>
              </div>
              {/* Sugestões baseadas nos valores existentes em opportunities.utm_source */}
              {utmSourceSuggestions.length > 0 && (
                <div className="mb-3">
                  <p className="mb-1.5 text-xs text-[#7B8099]">Sugestões baseadas nas oportunidades existentes:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {utmSourceSuggestions.map((s) => {
                      const already = (utmMapping.facebook_utm_source_terms ?? []).includes(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
                            if (!already) {
                              setUtmMapping((prev) => ({
                                ...prev,
                                facebook_utm_source_terms: Array.from(
                                  new Set([...(prev.facebook_utm_source_terms ?? []), s])
                                ),
                              }));
                            }
                          }}
                          title={already ? "Já adicionado" : `Adicionar "${s}"`}
                          className={`rounded px-2 py-0.5 text-xs border transition-colors ${
                            already
                              ? "border-[#2DD4A0] bg-[#2DD4A0]/10 text-[#2DD4A0] cursor-default opacity-60"
                              : "border-[#1F2330] bg-[#1A1F2E] text-[#7B8099] hover:border-[#2DD4A0] hover:text-[#2DD4A0] cursor-pointer"
                          }`}
                        >
                          {already ? `✓ ${s}` : `+ ${s}`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {(utmMapping.facebook_utm_source_terms ?? []).length === 0 ? (
                <p className="text-xs text-[#7B8099]">Nenhum termo cadastrado.</p>
              ) : (
                <ul className="space-y-1.5">
                  {(utmMapping.facebook_utm_source_terms ?? []).map((term) => (
                    <li key={term} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`fb-source-${term}`}
                        checked
                        onChange={(e) => toggleFacebookSourceTerm(term, e.target.checked)}
                        className="rounded border-[#1F2330] bg-[#1A1F2E] text-[#2DD4A0]"
                      />
                      <label htmlFor={`fb-source-${term}`} className="text-sm text-[#E8EAF0] cursor-pointer">
                        {term}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              onClick={handleSalvarUtmMapping}
              disabled={utmMappingSaving}
              className="btn-secondary w-full sm:w-auto px-4 py-2 text-sm"
            >
              {utmMappingSaving ? "Salvando…" : "Salvar mapeamento UTM"}
            </button>
          </div>
        </div>
      </div>

      {/* Quadrantes: pipelines, estágios, calendários, usuários — grid 2x2 compacto */}
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="card card-compact overflow-hidden">
          <div className="card-header">
            <h2 className="card-title text-sm">Pipelines</h2>
          </div>
          <ul className="max-h-40 overflow-auto divide-y divide-[#1F2330]">
            {pipelines.length === 0 ? (
              <li className="py-2 text-xs text-[#7B8099]">Nenhuma pipeline</li>
            ) : (
              pipelines.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-1.5 text-xs hover:bg-[#1A1F2E]">
                  <span className="truncate font-medium text-[#E8EAF0]">{p.name}</span>
                  <code className="ml-1 shrink-0 rounded bg-[#1A1F2E] px-1 py-0.5 text-[10px] text-[#7B8099]">{p.id.slice(0, 8)}</code>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="card card-compact overflow-hidden">
          <div className="card-header">
            <h2 className="card-title text-sm">Estágios por pipeline</h2>
          </div>
          <div className="max-h-40 overflow-auto divide-y divide-[#1F2330]">
            {pipelines.length === 0 ? (
              <p className="py-2 text-xs text-[#7B8099]">Nenhuma pipeline</p>
            ) : (
              pipelines.map((p) => (
                <div key={p.id} className="py-1.5 hover:bg-[#1A1F2E]">
                  <p className="text-xs font-medium text-[#E8EAF0]">{p.name}</p>
                  <ul className="ml-2 mt-0.5 space-y-0.5">
                    {(p.stages ?? []).length === 0 ? (
                      <li className="text-[10px] text-[#7B8099]">—</li>
                    ) : (
                      (p.stages ?? []).map((s) => (
                        <li key={s.id} className="flex items-center justify-between text-[10px] text-[#7B8099]">
                          <span className="truncate">{s.name}</span>
                          <code className="shrink-0 rounded bg-[#1A1F2E] px-1 text-[#E8EAF0]">{s.id.slice(0, 8)}</code>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card card-compact overflow-hidden">
          <div className="card-header">
            <h2 className="card-title text-sm">Calendários</h2>
          </div>
          <ul className="max-h-40 overflow-auto divide-y divide-[#1F2330]">
            {calendars.length === 0 ? (
              <li className="py-2 text-xs text-[#7B8099]">Nenhum calendário</li>
            ) : (
              calendars.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-1.5 text-xs hover:bg-[#1A1F2E]">
                  <span className="truncate font-medium text-[#E8EAF0]">{c.name}</span>
                  <code className="ml-1 shrink-0 rounded bg-[#1A1F2E] px-1 py-0.5 text-[10px] text-[#7B8099]">{c.id.slice(0, 8)}</code>
                </li>
              ))
            )}
          </ul>
        </div>

        <div className="card card-compact overflow-hidden">
          <div className="card-header">
            <h2 className="card-title text-sm">Usuários da conta</h2>
          </div>
          <ul className="max-h-40 overflow-auto divide-y divide-[#1F2330]">
            {users.length === 0 ? (
              <li className="py-2 text-xs text-[#7B8099]">Nenhum usuário</li>
            ) : (
              users.map((u) => (
                <li key={u.id} className="flex items-center justify-between py-1.5 text-xs hover:bg-[#1A1F2E]">
                  <span className="truncate font-medium text-[#E8EAF0]">{u.name || u.email || u.id}</span>
                  <code className="ml-1 shrink-0 rounded bg-[#1A1F2E] px-1 py-0.5 text-[10px] text-[#7B8099]">{u.id.slice(0, 8)}</code>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
