"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveClient } from "@/contexts/ActiveClientContext";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";

type Pipeline = { id: string; name: string; stages?: { id: string; name: string }[] };
type Counts = { byPipeline: Record<string, number>; byStage: Record<string, number> };
type PeriodKind = "today" | "week" | "month" | "year" | "custom";

type IndicatorsPayload = {
  saleDateFieldId: string | null;
  indicators: {
    sales: number | null;
    revenue: number | null;
    salesAds: number | null;
    revenueAds: number | null;
    callsRealized: number | null;
    callsRealizedAds: number | null;
    conversionRate: number | null;
    callsScheduled: number | null;
    callsScheduledAds: number | null;
    showRate: number | null;
    appointmentsCreated: number | null;
    appointmentsCreatedAds: number | null;
    leadsQualified: number | null;
    leadsQualifiedAds: number | null;
  };
  previousIndicators: {
    sales: number | null;
    revenue: number | null;
    salesAds: number | null;
    revenueAds: number | null;
    callsRealized: number | null;
    callsRealizedAds: number | null;
    callsScheduled: number | null;
    callsScheduledAds: number | null;
    appointmentsCreated: number | null;
    appointmentsCreatedAds: number | null;
    leadsQualified: number | null;
    leadsQualifiedAds: number | null;
  } | null;
  errors: string[];
};

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function getPeriodBoundsFromYearMonth(
  year: number,
  month: number | null,
  allPeriod: boolean
): { start: number; end: number } {
  if (allPeriod) {
    const start = new Date(year, 0, 1, 0, 0, 0, 0).getTime();
    const end = new Date(year, 11, 31, 23, 59, 59, 999).getTime();
    return { start, end };
  }
  const m = month ?? 0;
  const start = new Date(year, m, 1, 0, 0, 0, 0).getTime();
  const end = new Date(year, m + 1, 0, 23, 59, 59, 999).getTime();
  return { start, end };
}

function getPeriodBounds(
  kind: PeriodKind,
  customStart?: string,
  customEnd?: string
): { start: number; end: number } {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  let start: Date;
  switch (kind) {
    case "today":
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { start: start.getTime(), end: end.getTime() };
    case "week": {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      start = new Date(now);
      start.setDate(diff);
      start.setHours(0, 0, 0, 0);
      return { start: start.getTime(), end: end.getTime() };
    }
    case "month":
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { start: start.getTime(), end: end.getTime() };
    case "year":
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      return { start: start.getTime(), end: end.getTime() };
    case "custom":
      if (customStart && customEnd) {
        const s = new Date(customStart);
        s.setHours(0, 0, 0, 0);
        const e = new Date(customEnd);
        e.setHours(23, 59, 59, 999);
        return { start: s.getTime(), end: e.getTime() };
      }
      return getPeriodBounds("month");
    default:
      return getPeriodBounds("month");
  }
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

/** Parte inteira e centavos para exibir centavos em fonte menor. */
function formatCurrencyParts(value: number): { main: string; cents: string } {
  const full = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
  const lastComma = full.lastIndexOf(",");
  if (lastComma === -1) return { main: full, cents: "" };
  return { main: full.slice(0, lastComma), cents: full.slice(lastComma) };
}

function formatMaybeCurrency(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatCurrency(value);
}

/** Exibe número nas tabelas: 0 vira "—". */
function numOrDash(n: number): string | number {
  return n === 0 ? "—" : n;
}

/** Exibe valor em dinheiro: 0 vira "—". */
function moneyOrDash(value: number): string {
  if (value === 0 || !Number.isFinite(value)) return "—";
  return formatCurrency(value);
}

/** Valor em R$ com centavos em fonte menor (para uso em células e KPIs). */
function MoneyWithSmallCents({ value }: { value: number }) {
  if (value === 0 || !Number.isFinite(value)) return <>—</>;
  const { main, cents } = formatCurrencyParts(value);
  return <>{main}{cents ? <span className="cur-cents">{cents}</span> : null}</>;
}

/** Exibe percentual: 0 vira "—". */
function rateOrDash(value: number): string {
  if (value === 0 || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

/** Iniciais do nome (ex.: "Maria Silva" → "MS", "Não atribuído" → "?"). */
function getInitials(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  if (t.toLowerCase() === "não atribuído" || t === "Não atribuído") return "?";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return t.slice(0, 2).toUpperCase();
}

function calcDivision(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function variationPercent(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

const CHART_COLORS = ["#4f6ef7", "#22c493", "#e9a23b", "#e05c5c", "#7b8099"];
const CHART_COST_COLORS = ["#7eb8f7", "#00d4b4", "#e8a12a"];

function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return dateStr;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split("-");
    return `${d}/${m}/${y}`;
  }
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    const [y, m] = dateStr.split("-");
    return `${m}/${y}`;
  }
  return dateStr;
}

/** Data abreviada para eixo do gráfico: "22/02" ou "Fev" (mês único). */
function formatDateShort(dateStr: string): string {
  if (!dateStr) return dateStr;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [, m, d] = dateStr.split("-");
    return `${d}/${m}`;
  }
  if (/^\d{4}-\d{2}$/.test(dateStr)) {
    const [, m] = dateStr.split("-");
    return MONTHS[parseInt(m, 10) - 1] ?? m;
  }
  return dateStr;
}

/** Formata número para eixo/label: no máximo 2 decimais, k/M para milhares/milhões. */
function formatChartValue(value: number, isCurrency: boolean): string {
  if (!Number.isFinite(value)) return "—";
  const prefix = isCurrency ? "R$ " : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${prefix}${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (abs >= 1_000) return `${prefix}${(value / 1_000).toFixed(2).replace(/\.?0+$/, "")}k`;
  if (Number.isInteger(value)) return `${prefix}${value}`;
  return `${prefix}${value.toFixed(2)}`;
}

/** Índices onde exibir label no gráfico: maior, menor (não zero) e a cada N pontos. */
function getIndicesToShowForSeries(
  data: Record<string, unknown>[],
  dataKey: string,
  everyN: number
): Set<number> {
  const indices = new Set<number>();
  const values = data.map((d) => Number(d[dataKey]) ?? 0);
  let maxIdx = 0;
  let minNonZeroIdx = -1;
  let minNonZero = Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > values[maxIdx]) maxIdx = i;
    if (values[i] > 0 && values[i] < minNonZero) {
      minNonZero = values[i];
      minNonZeroIdx = i;
    }
  }
  indices.add(maxIdx);
  if (minNonZeroIdx >= 0) indices.add(minNonZeroIdx);
  for (let i = 0; i < data.length; i += everyN) indices.add(i);
  return indices;
}

const SUMMARY_COL_DEFS: { id: string; label: string }[] = [
  { id: "mes", label: "Mês" },
  { id: "leads", label: "Leads" },
  { id: "agend", label: "Agend." },
  { id: "vendas", label: "Vendas" },
  { id: "fatur", label: "Fatur." },
  { id: "invest", label: "Invest." },
  { id: "calls", label: "Calls" },
  { id: "cpl", label: "CPL" },
  { id: "cpAgend", label: "Custo/Agend." },
  { id: "cpCall", label: "Custo/Call" },
  { id: "cpa", label: "Custo/Venda" },
  { id: "roas", label: "ROAS" },
];

export default function RelatorioClientePage() {
  const params = useParams();
  const router = useRouter();
  const clientIdFromUrl = params.clientId as string;
  const { authFetch, clients } = useAuth();
  const { activeClient, setActiveClientId } = useActiveClient();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [counts, setCounts] = useState<Counts>({ byPipeline: {}, byStage: {} });
  const [selectedPipelineIds, setSelectedPipelineIds] = useState<string[]>([]);
  const [availableSources, setAvailableSources] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [fonteDropdownOpen, setFonteDropdownOpen] = useState(false);
  const fonteDropdownRef = useRef<HTMLDivElement>(null);
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth());
  const [allPeriod, setAllPeriod] = useState(false);
  const [periodKind, setPeriodKind] = useState<PeriodKind>("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [indicatorsData, setIndicatorsData] = useState<IndicatorsPayload | null>(null);
  const [investment, setInvestment] = useState<{ total: number; previousTotal: number } | null>(null);
  const [extra, setExtra] = useState<{
    series: { date: string; leads: number; appointments: number; sales: number; investment: number }[];
    monthly: { month: string; sales: number; revenue: number; investment: number; callsRealized: number; appointments: number; leads: number; cpl: number; cpa: number }[];
    byResponsible: { name: string; sales: number; revenue: number; opportunities: number; conversionRate: number }[];
    utmCampaign: { name: string; leads: number; sales: number; revenue: number; investment?: number; appointments?: number; callsRealized?: number }[];
    utmMedium: { name: string; leads: number; sales: number; revenue: number; investment?: number; appointments?: number; callsRealized?: number }[];
    utmContent: { name: string; leads: number; sales: number; revenue: number; investment?: number; appointments?: number; callsRealized?: number }[];
    bySource: { source: string; opportunities: number; sales: number; revenue: number; conversion: number }[];
    revenueByRange: { range: string; count: number; revenue: number }[];
    splitByField?: { dimId: string; label: string; totalOpportunities: number; totalRevenue: number; rows: { value: string; opportunities: number; sales: number; revenue: number; appointments: number; callsRealized: number; pctOpportunities: number; pctRevenue: number }[] }[];
  } | null>(null);
  const [lineChartSeries, setLineChartSeries] = useState<("leads" | "appointments" | "sales" | "investment")[]>(["leads", "investment"]);
  const [evoMode, setEvoMode] = useState<"volume" | "custo">("volume");
  const [lineChartCostSeries, setLineChartCostSeries] = useState<("cpl" | "cpa" | "costPerAgend")[]>(["cpl", "cpa"]);
  const [filterResponsible, setFilterResponsible] = useState<string[]>([]);
  const [filterResponsibleDropdownOpen, setFilterResponsibleDropdownOpen] = useState(false);
  const filterResponsibleDropdownRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [indicatorsLoading, setIndicatorsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [funnelPipelineId, setFunnelPipelineId] = useState<string>("");
  /** IDs das etapas ocultas no funil de conversão (são somadas à etapa anterior). */
  const [funnelHiddenStageIds, setFunnelHiddenStageIds] = useState<Set<string>>(new Set());
  const [funnelFilterOpen, setFunnelFilterOpen] = useState(false);
  const funnelFilterRef = useRef<HTMLDivElement>(null);
  const [summaryColPanelOpen, setSummaryColPanelOpen] = useState(false);
  const [summaryCols, setSummaryCols] = useState<string[]>(["mes", "leads", "agend", "vendas", "fatur", "invest", "calls", "cpl", "cpAgend", "cpCall", "cpa", "roas"]);

  /** Campos personalizados: ordenação por painel e página por painel */
  const SPLIT_SORT_OPTIONS = [
    { id: "value", label: "Nome" },
    { id: "sales", label: "Vendas" },
    { id: "appointments", label: "Agend." },
    { id: "callsRealized", label: "Calls" },
    { id: "revenue", label: "Faturamento" },
    { id: "pctRevenue", label: "% fatur." },
    { id: "opportunities", label: "Oportunidades" },
    { id: "pctOpportunities", label: "% oport." },
  ] as const;
  const SPLIT_PAGE_SIZE = 10;
  const [splitSortByPanel, setSplitSortByPanel] = useState<Record<string, { key: string; dir: "asc" | "desc" }>>({});
  const [splitPageByPanel, setSplitPageByPanel] = useState<Record<string, number>>({});
  /** Filtro ao clicar em um card: filtra as demais tabelas por este valor (dimId + value). */
  const [splitSelectedFilter, setSplitSelectedFilter] = useState<{ dimId: string; value: string; label: string } | null>(null);

  const toggleSummaryCol = useCallback((id: string) => {
    setSummaryCols((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((c) => c !== id);
        return next.length ? next : prev;
      }
      return [...prev, id];
    });
  }, []);

  const [origemColPanelOpen, setOrigemColPanelOpen] = useState(false);
  const [origemCols, setOrigemCols] = useState<string[]>(["origem", "oportunidades", "vendas", "fatur", "conversao"]);
  const toggleOrigemCol = useCallback((id: string) => {
    setOrigemCols((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((c) => c !== id);
        return next.length ? next : prev;
      }
      return [...prev, id];
    });
  }, []);

  const [utmColPanelOpen, setUtmColPanelOpen] = useState<"camp" | "med" | "cont" | null>(null);
  const [utmCols, setUtmCols] = useState<string[]>(["name", "leads", "vendas", "fatur", "invest", "agend", "calls"]);
  const toggleUtmCol = useCallback((id: string) => {
    setUtmCols((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((c) => c !== id);
        return next.length ? next : prev;
      }
      return [...prev, id];
    });
  }, []);

  const hasAccess = clients.some((c) => c.id === clientIdFromUrl);
  const clientId = activeClient?.id === clientIdFromUrl ? activeClient.id : hasAccess ? clientIdFromUrl : null;
  const accountName = activeClient?.name ?? clients.find((c) => c.id === clientIdFromUrl)?.name ?? "Conta";
  const periodBounds = getPeriodBoundsFromYearMonth(selectedYear, selectedMonth, allPeriod);
  const periodDays = Math.ceil((periodBounds.end - periodBounds.start) / (24 * 60 * 60 * 1000));

  useEffect(() => {
    if (!clientIdFromUrl || !hasAccess) {
      router.replace("/relatorio");
      return;
    }
    if (activeClient?.id !== clientIdFromUrl) {
      setActiveClientId(clientIdFromUrl);
    }
  }, [clientIdFromUrl, hasAccess, activeClient?.id, setActiveClientId, router]);

  useEffect(() => {
    if (!filterResponsibleDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (filterResponsibleDropdownRef.current && !filterResponsibleDropdownRef.current.contains(e.target as Node)) {
        setFilterResponsibleDropdownOpen(false);
      }
      if (funnelFilterRef.current && !funnelFilterRef.current.contains(e.target as Node)) {
        setFunnelFilterOpen(false);
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [filterResponsibleDropdownOpen]);

  const fetchPipelinesAndCounts = useCallback(async () => {
    if (!clientId) return;
    const q = `?client_id=${encodeURIComponent(clientId)}`;
    const res = await authFetch(`/api/report/data${q}`).then((r) => r.json());
    if (res.error) throw new Error(res.error);
    const pl = (res.pipelines ?? []) as Pipeline[];
    setPipelines(pl);
    const opportunities = (res.opportunities ?? []) as { pipelineId?: string; stageId?: string }[];
    const byPipeline: Record<string, number> = {};
    const byStage: Record<string, number> = {};
    opportunities.forEach((o) => {
      if (o.pipelineId) byPipeline[o.pipelineId] = (byPipeline[o.pipelineId] ?? 0) + 1;
      if (o.stageId) byStage[o.stageId] = (byStage[o.stageId] ?? 0) + 1;
    });
    setCounts({ byPipeline, byStage });
    setAvailableSources((res.sources ?? []) as string[]);
  }, [clientId, authFetch]);

  const fetchIndicators = useCallback(async () => {
    if (!clientId) {
      setIndicatorsLoading(false);
      return;
    }
    setIndicatorsLoading(true);
    const searchParams = new URLSearchParams({
      client_id: clientId,
      start: String(periodBounds.start),
      end: String(periodBounds.end),
    });
    if (selectedPipelineIds.length > 0) searchParams.set("pipeline_ids", selectedPipelineIds.join(","));
    if (selectedSources.length > 0) searchParams.set("sources", selectedSources.join(","));
    try {
      const res = await authFetch(`/api/report/indicators?${searchParams}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setIndicatorsData(json);
    } catch {
      setIndicatorsData(null);
    } finally {
      setIndicatorsLoading(false);
    }
  }, [clientId, authFetch, periodBounds.start, periodBounds.end, selectedPipelineIds, selectedSources]);

  const fetchInvestment = useCallback(async () => {
    if (!clientId) return;
    const q = `?client_id=${clientId}&start=${periodBounds.start}&end=${periodBounds.end}`;
    try {
      const res = await authFetch(`/api/report/investment${q}`).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      setInvestment({ total: res.total ?? 0, previousTotal: res.previousTotal ?? 0 });
    } catch {
      setInvestment(null);
    }
  }, [clientId, authFetch, periodBounds.start, periodBounds.end]);

  const fetchExtra = useCallback(async () => {
    if (!clientId) return;
    const searchParams = new URLSearchParams({
      client_id: clientId,
      start: String(periodBounds.start),
      end: String(periodBounds.end),
    });
    // Resumo mensal: filtra apenas pelo ano do período selecionado (não pelo período completo).
    searchParams.set("year", String(selectedYear));
    if (selectedPipelineIds.length > 0) searchParams.set("pipeline_ids", selectedPipelineIds.join(","));
    if (selectedSources.length > 0) searchParams.set("sources", selectedSources.join(","));
    if (splitSelectedFilter) {
      searchParams.set("split_filter_dim", splitSelectedFilter.dimId);
      searchParams.set("split_filter_value", splitSelectedFilter.value);
    }
    try {
      const res = await authFetch(`/api/report/extra?${searchParams}`).then((r) => r.json());
      if (res.error) throw new Error(res.error);
      setExtra(res);
    } catch {
      setExtra(null);
    }
  }, [clientId, authFetch, periodBounds.start, periodBounds.end, selectedYear, selectedPipelineIds, selectedSources, splitSelectedFilter]);

  useEffect(() => {
    if (!clientId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchPipelinesAndCounts()
      .catch((e) => setError(e instanceof Error ? e.message : "Erro ao carregar"))
      .finally(() => setLoading(false));
  }, [clientId, fetchPipelinesAndCounts]);

  useEffect(() => {
    if (!clientId) return;
    fetchIndicators();
    fetchInvestment();
    fetchExtra();
  }, [clientId, fetchIndicators, fetchInvestment, fetchExtra]);

  useEffect(() => {
    const onSync = () => {
      fetchPipelinesAndCounts().catch(() => {});
      fetchIndicators();
      fetchInvestment();
      fetchExtra();
    };
    window.addEventListener("dash-ghl-sync-complete", onSync);
    return () => window.removeEventListener("dash-ghl-sync-complete", onSync);
  }, [fetchPipelinesAndCounts, fetchIndicators, fetchInvestment, fetchExtra]);

  const FUNNEL_STORAGE_KEY = clientId ? `dash-ghl-funnel-${clientId}` : null;

  useEffect(() => {
    if (!clientId || pipelines.length === 0) return;
    const key = `dash-ghl-funnel-${clientId}`;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const data = JSON.parse(raw) as { pipelineId?: string; hiddenStageIds?: string[] };
        if (data.pipelineId && pipelines.some((p) => p.id === data.pipelineId)) {
          setFunnelPipelineId(data.pipelineId);
          const pipeline = pipelines.find((p) => p.id === data.pipelineId);
          const stageIds = new Set((pipeline?.stages ?? []).map((s) => s.id));
          const hidden = (data.hiddenStageIds ?? []).filter((id) => stageIds.has(id));
          setFunnelHiddenStageIds(new Set(hidden));
          return;
        }
      }
    } catch {
      /* ignore */
    }
    if (!funnelPipelineId) setFunnelPipelineId(pipelines[0].id);
  }, [clientId, pipelines]);

  useEffect(() => {
    if (!FUNNEL_STORAGE_KEY) return;
    try {
      localStorage.setItem(FUNNEL_STORAGE_KEY, JSON.stringify({
        pipelineId: funnelPipelineId,
        hiddenStageIds: Array.from(funnelHiddenStageIds),
      }));
    } catch {
      /* ignore */
    }
  }, [FUNNEL_STORAGE_KEY, funnelPipelineId, funnelHiddenStageIds]);

  useEffect(() => {
    setFunnelFilterOpen(false);
    setFunnelHiddenStageIds((prev) => {
      const pipeline = funnelPipelineId ? pipelines.find((p) => p.id === funnelPipelineId) : pipelines[0];
      const stageIds = new Set((pipeline?.stages ?? []).map((s) => s.id));
      const next = new Set<string>();
      prev.forEach((id) => { if (stageIds.has(id)) next.add(id); });
      return next;
    });
  }, [funnelPipelineId, pipelines]);

  const togglePipeline = (id: string) => {
    setSelectedPipelineIds((prev) => {
      if (prev.length === 0) return [id];
      if (prev.includes(id)) {
        const next = prev.filter((x) => x !== id);
        return next.length === 0 ? [] : next;
      }
      return [...prev, id];
    });
  };
  const selectAllPipelines = () => setSelectedPipelineIds([]);
  const ind = indicatorsData?.indicators;
  const invPrev = investment?.previousTotal ?? 0;
  const invCurr = investment?.total ?? 0;
  const leadsAds = ind?.leadsQualifiedAds ?? 0;
  const appointmentsAds = ind?.appointmentsCreatedAds ?? 0;
  const callsAds = ind?.callsRealizedAds ?? 0;
  const salesAds = ind?.salesAds ?? 0;
  const revenueAds = ind?.revenueAds ?? 0;
  const revenue = ind?.revenue ?? 0;
  const roasTotal = calcDivision(revenue, invCurr);
  const roasAds = calcDivision(revenueAds, invCurr);
  const cplAds = calcDivision(invCurr, leadsAds);
  const cpAgAds = calcDivision(invCurr, appointmentsAds);
  const cpCallRealizadaAds = calcDivision(invCurr, callsAds);
  const cpaAds = calcDivision(invCurr, salesAds);
  const cpAgendTotal = calcDivision(invCurr, ind?.appointmentsCreated ?? 0);
  const cpCallTotal = calcDivision(invCurr, ind?.callsRealized ?? 0);
  const cpVendaTotal = calcDivision(invCurr, ind?.sales ?? 0);

  const funnelPipeline = funnelPipelineId ? pipelines.find((p) => p.id === funnelPipelineId) : pipelines[0] ?? null;
  const funnelStagesWithCount = (funnelPipeline?.stages ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    count: counts.byStage[s.id] ?? 0,
  }));
  const funnelTotal = funnelStagesWithCount.reduce((sum, s) => sum + s.count, 0);
  const funnelMax = Math.max(...funnelStagesWithCount.map((s) => s.count), 1);

  /** Etapas exibidas no funil: ocultas são somadas à etapa anterior (visível). */
  const funnelDisplayStages = (() => {
    const stages = funnelStagesWithCount;
    if (stages.length === 0) return [];
    const hidden = funnelHiddenStageIds;
    const result: { id: string; name: string; count: number; isFirst: boolean }[] = [];
    let i = 0;
    while (i < stages.length) {
      const stage = stages[i];
      if (!hidden.has(stage.id)) {
        let displayCount = stage.count;
        let j = i + 1;
        while (j < stages.length && hidden.has(stages[j].id)) {
          displayCount += stages[j].count;
          j++;
        }
        result.push({ id: stage.id, name: stage.name, count: displayCount, isFirst: result.length === 0 });
        i = j;
      } else {
        i++;
      }
    }
    return result;
  })();
  const funnelDisplayTotal = funnelDisplayStages.reduce((sum, s) => sum + s.count, 0);
  const funnelDisplayMax = Math.max(...funnelDisplayStages.map((s) => s.count), 1);

  const toggleFunnelStageHidden = useCallback((stageId: string) => {
    setFunnelHiddenStageIds((prev) => {
      const next = new Set(prev);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  }, []);

  if (!hasAccess) return null;
  if (!clientId) {
    return (
      <div>
        <h1 className="page-title">Relatório</h1>
        <p className="mt-1 text-[var(--text-secondary)]">Carregando conta...</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div>
        <h1 className="page-title">Relatório — {accountName}</h1>
        <p className="mt-2 flex items-center gap-2 text-[var(--text-secondary)]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          Carregando dados...
        </p>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <h1 className="page-title">Relatório — {accountName}</h1>
        <p className="mt-2 text-[var(--danger)]">{error}</p>
      </div>
    );
  }

  const leads = ind?.leadsQualified ?? 0;
  const appointments = ind?.appointmentsCreated ?? 0;
  const calls = ind?.callsRealized ?? 0;
  const sales = ind?.sales ?? 0;
  const convLeadsToAgend = leads > 0 ? (appointments / leads) * 100 : 0;
  const convAgendToCalls = appointments > 0 ? (calls / appointments) * 100 : 0;
  const convCallsToVendas = calls > 0 ? (sales / calls) * 100 : 0;
  const convLeadsToVendas = leads > 0 ? (sales / leads) * 100 : 0;

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const leadsPct = leads > 0 ? (appointments / leads) * 100 : 0;
  const agendPct = appointments > 0 ? (calls / appointments) * 100 : 0;

  return (
    <div className="relatorio-dashboard space-y-6">
      {/* Page header — template structure */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{accountName} <span>/ Relatório</span></h1>
          <p className="page-subtitle">
            Indicadores e funil de atendimento · {MONTHS[selectedMonth]} {selectedYear}
          </p>
        </div>
      </div>

      {/* Erros retornados pela API de indicadores (ex.: coluna ausente no banco) */}
      {indicatorsData?.errors && indicatorsData.errors.length > 0 && (
        <div className="rounded-lg border border-[var(--danger)]/50 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[var(--danger)]">
          <span className="font-medium">Avisos ao carregar dados:</span>
          <ul className="mt-1 list-inside list-disc">
            {indicatorsData.errors.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Period block — template structure */}
      <div className="period-block">
        <div className="period-header">
          <div className="period-header-left">
            <span className="period-label">Período</span>
            <div className="year-nav">
              <button type="button" className="year-btn" onClick={() => setSelectedYear((y) => y - 1)} aria-label="Ano anterior">
                &#8249;
              </button>
              <span className="year-display">{selectedYear}</span>
              <button type="button" className="year-btn" onClick={() => setSelectedYear((y) => y + 1)} aria-label="Próximo ano">
                &#8250;
              </button>
            </div>
          </div>
          <button
            type="button"
            className={`all-period-btn ${allPeriod ? "active" : ""}`}
            onClick={() => setAllPeriod(true)}
          >
            Todo período
          </button>
        </div>
        <div className="month-grid">
          {MONTHS.map((m, i) => {
            const isFuture = selectedYear > currentYear || (selectedYear === currentYear && i > currentMonth);
            const isActive = !allPeriod && selectedMonth === i;
            const hasData = selectedYear < currentYear || (selectedYear === currentYear && i <= currentMonth);
            return (
              <button
                key={m}
                type="button"
                className={`month-pill ${isActive ? "active" : ""} ${isFuture ? "disabled" : ""} ${hasData ? "has-data" : ""}`}
                onClick={() => {
                  if (isFuture) return;
                  setAllPeriod(false);
                  setSelectedMonth(i);
                }}
              >
                {m}
              </button>
            );
          })}
        </div>
      </div>

      {/* Pipeline + Fonte/Origem */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="r-mono" style={{ fontSize: "8px", letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--text-dim)" }}>
            Pipeline
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {pipelines.map((p) => {
              const isSelected = selectedPipelineIds.length === 0 || selectedPipelineIds.includes(p.id);
              const count = counts.byPipeline[p.id] ?? 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePipeline(p.id)}
                  className={`month-pill ${isSelected ? "active" : ""}`}
                  style={{ maxWidth: "none" }}
                >
                  {p.name} {count > 0 ? `· ${count}` : ""}
                </button>
              );
            })}
            <button
              type="button"
              onClick={selectAllPipelines}
              className="border-0 bg-transparent p-0 text-xs cursor-pointer text-[var(--text-dim)] hover:text-[var(--text-secondary)]"
            >
              Selecionar todos
            </button>
          </div>
        </div>
        {/* Fonte/Origem — lista suspensa multi-select */}
        <div className="flex items-center gap-2" ref={fonteDropdownRef}>
          <span className="r-mono" style={{ fontSize: "8px", letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--text-dim)" }}>
            Fonte / Origem
          </span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setFonteDropdownOpen((v) => !v)}
              className="min-w-[180px] rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] text-left flex items-center justify-between gap-2 focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            >
              <span className="truncate">
                {selectedSources.length === 0
                  ? "Todos"
                  : selectedSources.length === 1
                    ? selectedSources[0]
                    : `${selectedSources.length} selecionadas`}
              </span>
              <span className="text-[var(--text-dim)]">{fonteDropdownOpen ? "▲" : "▼"}</span>
            </button>
            {fonteDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 min-w-[220px] max-h-[280px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] shadow-lg py-2">
                {availableSources.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-[var(--text-dim)]">Nenhuma origem disponível</div>
                ) : (
                  <>
                    {availableSources.map((s) => (
                      <label
                        key={s}
                        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--bg-hover)]"
                      >
                        <input
                          type="checkbox"
                          checked={selectedSources.includes(s)}
                          onChange={() => {
                            setSelectedSources((prev) =>
                              prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                            );
                          }}
                          className="rounded border-[var(--border)]"
                        />
                        <span className="text-sm">{s}</span>
                      </label>
                    ))}
                    <div className="border-t border-[var(--border)] mt-2 pt-2 px-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSources([]);
                          setFonteDropdownOpen(false);
                        }}
                        className="text-sm font-medium w-full text-left py-1 hover:underline"
                        style={{ color: "var(--success)" }}
                      >
                        Limpar filtro
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          {selectedSources.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedSources([])}
              className="text-sm font-medium border-0 bg-transparent p-0 cursor-pointer hover:underline"
              style={{ color: "var(--success)" }}
            >
              Limpar filtro
            </button>
          )}
        </div>
      </div>

      {/* Visão Geral — KPI strip (template structure) */}
      <div className="sec-label"><span>Visão Geral</span></div>

      {indicatorsLoading ? (
        <div className="kpi-strip">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="kpi-card">
              <div className="kpi-name">—</div>
              <div className="kpi-val">—</div>
              <div className="kpi-divider" />
              <div className="kpi-sub-row">
                <div className="kpi-sub-item ads"><div className="sub-lbl">Anúncios</div><div className="sub-val">—</div></div>
                <div className="kpi-sub-item org"><div className="sub-lbl">Outros</div><div className="sub-val">—</div></div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="kpi-strip">
            <div className="kpi-card accent">
              <div className="kpi-name">Faturamento</div>
              <div className="kpi-val"><MoneyWithSmallCents value={ind?.revenue ?? 0} /></div>
              <div className="kpi-divider" />
              <div className="kpi-sub-row">
                <div className="kpi-sub-item ads"><div className="sub-lbl">Anúncios</div><div className="sub-val"><MoneyWithSmallCents value={revenueAds} /></div></div>
                <div className="kpi-sub-item org"><div className="sub-lbl">Outros</div><div className="sub-val"><MoneyWithSmallCents value={(ind?.revenue ?? 0) - revenueAds} /></div></div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-name">Leads</div>
              <div className="kpi-val">{leads.toLocaleString("pt-BR")}</div>
              <div className="kpi-divider" />
              <div className="kpi-sub-row">
                <div className="kpi-sub-item ads"><div className="sub-lbl">Anúncios</div><div className="sub-val">{leadsAds}</div></div>
                <div className="kpi-sub-item org"><div className="sub-lbl">Outros</div><div className="sub-val">{leads - leadsAds}</div></div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-name">Agendamentos</div>
              <div className="kpi-val">{appointments}</div>
              <div className="kpi-divider" />
              <div className="kpi-sub-row">
                <div className="kpi-sub-item ads"><div className="sub-lbl">Anúncios</div><div className="sub-val">{appointmentsAds}</div></div>
                <div className="kpi-sub-item org"><div className="sub-lbl">Outros</div><div className="sub-val">{appointments - appointmentsAds}</div></div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-name">Calls Realizadas</div>
              <div className="kpi-val">{calls}</div>
              <div className="kpi-divider" />
              <div className="kpi-sub-row">
                <div className="kpi-sub-item ads"><div className="sub-lbl">Anúncios</div><div className="sub-val">{callsAds}</div></div>
                <div className="kpi-sub-item org"><div className="sub-lbl">Outros</div><div className="sub-val">{calls - callsAds}</div></div>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-name">Vendas</div>
              <div className="kpi-val">{sales}</div>
              <div className="kpi-divider" />
              <div className="kpi-sub-row">
                <div className="kpi-sub-item ads"><div className="sub-lbl">Anúncios</div><div className="sub-val">{salesAds}</div></div>
                <div className="kpi-sub-item org"><div className="sub-lbl">Outros</div><div className="sub-val">{sales - salesAds}</div></div>
              </div>
            </div>
          </div>

          {/* Funil de Conversão — etapas = pipeline do banco; filtro "Ocultar no funil" agrega à etapa anterior */}
          <div className="sec-label"><span>Funil de Conversão</span></div>
          <div className="two-col two-col-6040">
            <div className="card">
              <div className="card-header">
                <span className="card-title">Funil de Conversão</span>
                <div className="flex items-center gap-2 flex-wrap">
                  {funnelPipeline && funnelStagesWithCount.length > 0 && (
                    <div className="relative" ref={funnelFilterRef}>
                      <button
                        type="button"
                        onClick={() => setFunnelFilterOpen((o) => !o)}
                        className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-2 py-1 text-xs text-[var(--text-primary)] flex items-center gap-1.5"
                        aria-expanded={funnelFilterOpen}
                        aria-label="Ocultar etapas no funil"
                      >
                        Ocultar no funil
                        {funnelHiddenStageIds.size > 0 && <span className="rounded-full bg-[var(--accent)] text-[var(--bg-base)] text-[10px] px-1.5">{funnelHiddenStageIds.size}</span>}
                      </button>
                      {funnelFilterOpen && (
                        <div className="absolute top-full left-0 mt-1 z-20 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] py-2 min-w-[180px] shadow-lg">
                          <div className="px-3 pb-1.5 text-[10px] uppercase tracking-wider text-[var(--text-dim)]">Ocultar etapa (soma na anterior)</div>
                          {funnelStagesWithCount.map((s) => (
                            <label key={s.id} className="flex items-center gap-2 px-3 py-1 hover:bg-[var(--bg-hover)] cursor-pointer">
                              <input
                                type="checkbox"
                                checked={funnelHiddenStageIds.has(s.id)}
                                onChange={() => toggleFunnelStageHidden(s.id)}
                                className="rounded border-[var(--border)] accent-[var(--accent)]"
                              />
                              <span className="text-xs truncate">{s.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <span className="card-badge badge-blue">Etapas do pipeline</span>
                </div>
              </div>
              <div className="funnel-col-header">
                <div className="fcol-stage">Etapa</div>
                <div className="fcol-bar">Proporção</div>
                <div className="fcol-total">Total</div>
                <div className="fcol-tx">Tx. Conv.</div>
                <div className="fcol-lost">Perdidos</div>
              </div>
              {funnelDisplayStages.length === 0 ? (
                <div className="px-4 py-6 text-center text-[var(--text-dim)] text-sm">Selecione um pipeline e sincronize etapas.</div>
              ) : (
                <>
                  {funnelDisplayStages.map((stage, idx) => {
                    const prevCount = idx === 0 ? 0 : funnelDisplayStages[idx - 1].count;
                    const lost = prevCount - stage.count;
                    const lostPct = prevCount > 0 ? (lost / prevCount) * 100 : 0;
                    const tx = prevCount > 0 ? (stage.count / prevCount) * 100 : 0;
                    const barPct = funnelDisplayMax > 0 ? Math.max((stage.count / funnelDisplayMax) * 100, stage.count > 0 ? 2 : 0) : 0;
                    const colors = ["var(--hi)", "var(--accent)", "var(--warning)", "var(--success)"];
                    const color = colors[idx % colors.length];
                    const colorDim = color === "var(--hi)" ? "var(--hi-dim)" : color === "var(--accent)" ? "var(--accent-dim)" : color === "var(--warning)" ? "var(--warning-muted)" : "var(--success-muted)";
                    const isLast = idx === funnelDisplayStages.length - 1;
                    return (
                      <div key={stage.id} className="funnel-row" style={isLast ? { borderBottom: "none" } : undefined}>
                        <div className="fcol-stage">
                          <span className="frow-dot" style={{ background: color, boxShadow: `0 0 6px ${colorDim}` }} />
                          <span className="frow-name">{stage.name}</span>
                        </div>
                        <div className="fcol-bar"><div className="frow-bar-track"><div className="frow-bar-fill" style={{ width: `${barPct}%`, background: `linear-gradient(90deg, ${colorDim}, ${color})` }} /></div></div>
                        <div className="fcol-total"><span className="frow-num" style={{ color }}>{stage.count.toLocaleString("pt-BR")}</span></div>
                        <div className="fcol-tx">{stage.isFirst ? <span className="frow-dash">—</span> : <span className={isLast ? "frow-tx-final" : "frow-tx"}>{tx.toFixed(2)}%</span>}</div>
                        <div className="fcol-lost">
                          {stage.isFirst ? <span className="frow-dash">—</span> : (
                            <span className="frow-lost-val">
                              {lostPct.toFixed(1)}%
                              <span className="frow-lost-num">{lost.toLocaleString("pt-BR")}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div className="funnel-conv-strip">
                    {funnelDisplayStages.length <= 1 ? (
                      <div className="fcs-item fcs-highlight">
                        <div className="fcs-label">Conversão</div>
                        <div className="fcs-val" style={{ color: "var(--text-dim)" }}>—</div>
                        <div className="fcs-detail">Duas ou mais etapas para ver conversões</div>
                        <div className="fcs-bar"><div className="fcs-fill" style={{ width: "0%" }} /></div>
                      </div>
                    ) : (
                      <>
                        {funnelDisplayStages.slice(0, -1).map((stage, idx) => {
                          const next = funnelDisplayStages[idx + 1];
                          const conv = stage.count > 0 ? (next.count / stage.count) * 100 : 0;
                          return (
                            <div key={stage.id} className="fcs-item">
                              <div className="fcs-label">{stage.name} → {next.name}</div>
                              <div className="fcs-val">{conv.toFixed(2)}%</div>
                              <div className="fcs-detail">{next.count} / {stage.count.toLocaleString("pt-BR")}</div>
                              <div className="fcs-bar"><div className="fcs-fill" style={{ width: `${Math.min(conv, 100)}%` }} /></div>
                            </div>
                          );
                        }).flatMap((el, i) => (i === 0 ? [el] : [<div key={`d-${i}`} className="fcs-divider" />, el]))}
                        <div className="fcs-divider" />
                        <div className="fcs-item fcs-highlight">
                          <div className="fcs-label">{funnelDisplayStages[0].name} → {funnelDisplayStages[funnelDisplayStages.length - 1].name}</div>
                          <div className="fcs-val" style={{ color: "var(--hi)" }}>
                            {funnelDisplayStages[0].count > 0 ? ((funnelDisplayStages[funnelDisplayStages.length - 1].count / funnelDisplayStages[0].count) * 100).toFixed(2) : "0"}%
                          </div>
                          <div className="fcs-detail">Conversão geral</div>
                          <div className="fcs-bar"><div className="fcs-fill" style={{ width: `${Math.min(funnelDisplayStages[0].count > 0 ? (funnelDisplayStages[funnelDisplayStages.length - 1].count / funnelDisplayStages[0].count) * 100 : 0, 100)}%`, minWidth: 3 }} /></div>
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Eficiência · Custos</span>
                  <span className="card-badge badge-cyan">Total e Anúncios</span>
                </div>
                <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="eff-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                    <div className="eff-item"><div className="eff-lbl">ROAS (Fatur./Invest.)</div><div className={`eff-val ${roasTotal != null ? "green" : ""}`}>{roasTotal == null ? "—" : `${roasTotal.toFixed(2)}x`}</div></div>
                    <div className="eff-item"><div className="eff-lbl">ROAS Anúncios</div><div className={`eff-val ${roasAds != null ? "green" : ""}`}>{roasAds == null ? "—" : `${roasAds.toFixed(2)}x`}</div></div>
                    <div className="eff-item"><div className="eff-lbl">Investimento</div><div className="eff-val"><MoneyWithSmallCents value={invCurr} /></div></div>
                  </div>
                  <div className="eff-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                    <div className="eff-item"><div className="eff-lbl">Custo por agendamento</div><div className="eff-val orange">{formatMaybeCurrency(cpAgendTotal)}</div></div>
                    <div className="eff-item"><div className="eff-lbl">Custo por Call Realizada</div><div className="eff-val orange">{formatMaybeCurrency(cpCallTotal)}</div></div>
                    <div className="eff-item"><div className="eff-lbl">Custo por venda</div><div className="eff-val orange">{formatMaybeCurrency(cpVendaTotal)}</div></div>
                  </div>
                  <div className="eff-row" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
                    <div className="eff-item"><div className="eff-lbl">CPL (Anúncios)</div><div className="eff-val cyan">{formatMaybeCurrency(cplAds)}</div></div>
                    <div className="eff-item"><div className="eff-lbl">Custo Agend. (Anúncios)</div><div className="eff-val cyan">{formatMaybeCurrency(cpAgAds)}</div></div>
                    <div className="eff-item"><div className="eff-lbl">Custo Call (Anúncios)</div><div className="eff-val cyan">{formatMaybeCurrency(cpCallRealizadaAds)}</div></div>
                    <div className="eff-item"><div className="eff-lbl">CPA (Anúncios)</div><div className="eff-val cyan">{formatMaybeCurrency(cpaAds)}</div></div>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-header">
                  <span className="card-title">Pipeline GHL</span>
                  <div className="flex items-center gap-2 flex-wrap">
                    {pipelines.length > 1 && (
                      <select
                        value={funnelPipelineId}
                        onChange={(e) => setFunnelPipelineId(e.target.value)}
                        className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-2 py-1 text-xs text-[var(--text-primary)]"
                        aria-label="Selecionar pipeline"
                      >
                        {pipelines.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    )}
                    <span className="card-badge badge-cyan">Funil de Atendimento</span>
                  </div>
                </div>
                <div className="tbl-overflow">
                  <table className="compact-table">
                    <thead><tr><th>Etapa</th><th>Qtd</th><th>% Total</th></tr></thead>
                    <tbody>
                      {funnelStagesWithCount.length === 0 ? (
                        <tr><td colSpan={3} className="text-center text-[var(--text-dim)]">Nenhum estágio</td></tr>
                      ) : (
                        funnelStagesWithCount.map((stage) => (
                          <tr key={stage.id}>
                            <td>{stage.name}</td>
                            <td className="num">{numOrDash(stage.count)}</td>
                            <td className="rate">{funnelTotal > 0 && stage.count > 0 ? `${((stage.count / funnelTotal) * 100).toFixed(1)}%` : "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Evolução no Período · Resumo Mensal — layout do template */}
      <div className="sec-label"><span>Evolução no Período · Resumo</span></div>
      <div className="two-col two-col-6040">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Evolução no Período</span>
            <div className="flex items-center gap-2">
              <div className="mode-tog" role="group" aria-label="Modo do gráfico">
                <button
                  type="button"
                  className={`mode-btn ${evoMode === "volume" ? "active" : ""}`}
                  aria-pressed={evoMode === "volume"}
                  onClick={() => setEvoMode("volume")}
                >
                  Volume
                </button>
                <button
                  type="button"
                  className={`mode-btn ${evoMode === "custo" ? "active" : ""}`}
                  aria-pressed={evoMode === "custo"}
                  onClick={() => setEvoMode("custo")}
                >
                  Custos
                </button>
              </div>
            </div>
          </div>
          <div className="card-body" style={{ paddingBottom: 8 }}>
            <div className="switch-group" style={{ marginBottom: 12 }}>
              {evoMode === "volume"
                ? (["leads", "appointments", "sales", "investment"] as const).map((key, i) => {
                    const label = key === "leads" ? "Leads" : key === "appointments" ? "Agend." : key === "sales" ? "Vendas" : "Invest.";
                    const on = lineChartSeries.includes(key);
                    const color = CHART_COLORS[i];
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setLineChartSeries((s) => (on ? s.filter((x) => x !== key) : [...s, key]))}
                        className={`sw-btn ${on ? "active" : ""}`}
                        style={on ? { borderLeft: `3px solid ${color}` } : undefined}
                      >
                        {label}
                      </button>
                    );
                  })
                : (["cpl", "cpa", "costPerAgend"] as const).map((key, i) => {
                    const label = key === "cpl" ? "CPL" : key === "cpa" ? "CPA" : "Custo Agend.";
                    const on = lineChartCostSeries.includes(key);
                    const color = CHART_COST_COLORS[i];
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setLineChartCostSeries((s) => (on ? s.filter((x) => x !== key) : [...s, key]))}
                        className={`sw-btn ${on ? "active" : ""}`}
                        style={on ? { borderLeft: `3px solid ${color}` } : undefined}
                      >
                        {label}
                      </button>
                    );
                  })}
            </div>
            <div className="chart-area" style={{ height: 190 }}>
              {extra?.series && extra.series.length > 0 ? (
                (() => {
                  const chartData =
                    evoMode === "custo"
                      ? extra.series.map((p) => ({
                          date: p.date,
                          cpl: p.leads > 0 ? p.investment / p.leads : 0,
                          cpa: p.sales > 0 ? p.investment / p.sales : 0,
                          costPerAgend: p.appointments > 0 ? p.investment / p.appointments : 0,
                        }))
                      : extra.series;
                  const isCost = evoMode === "custo";
                  const everyN = Math.max(1, Math.floor(chartData.length / 6));
                  const renderLabel = (indices: Set<number>, stroke: string) => {
                    const ChartTickLabel = (props: { value?: unknown; index?: number; x?: number; y?: number }) => {
                      const idx = props.index;
                      const val = typeof props.value === "number" ? props.value : Number(props.value);
                      if (idx == null || !indices.has(idx) || !Number.isFinite(val)) return null;
                      const str = isCost ? formatChartValue(val, true) : formatChartValue(val, false);
                      const x = props.x ?? 0;
                      const y = (props.y ?? 0) - 6;
                      return (
                        <text x={x} y={y} textAnchor="middle" fill={stroke} fontSize={10}>
                          {str}
                        </text>
                      );
                    };
                    ChartTickLabel.displayName = "ChartTickLabel";
                    return ChartTickLabel;
                  };
                  const labelProps = (indices: Set<number>, stroke: string) => ({
                    content: renderLabel(indices, stroke) as (props: unknown) => React.ReactElement | null,
                    position: "top" as const,
                  });
                  return (
                    <ResponsiveContainer width="100%" height={190}>
                      <LineChart data={chartData} margin={{ top: 18, right: 10, left: 10, bottom: 24 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} vertical={false} />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10, fill: "var(--text-secondary)" }}
                          stroke="var(--border)"
                          tickFormatter={formatDateShort}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: "var(--text-secondary)" }}
                          stroke="var(--border)"
                          tickFormatter={(v: number) => formatChartValue(v, isCost)}
                          width={42}
                        />
                        <Tooltip
                          contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8 }}
                          labelStyle={{ color: "var(--text-primary)" }}
                          labelFormatter={(label: unknown) => formatDateDisplay(String(label ?? ""))}
                          formatter={(value: unknown) => {
                            const v = typeof value === "number" ? value : 0;
                            const str = isCost ? formatChartValue(v, true) : formatChartValue(v, false);
                            return [str, ""];
                          }}
                        />
                        {evoMode === "volume" && (
                          <>
                            {lineChartSeries.includes("leads") && (
                              <Line type="monotone" dataKey="leads" name="Leads" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }}>
                                <LabelList {...labelProps(getIndicesToShowForSeries(chartData, "leads", everyN), CHART_COLORS[0])} />
                              </Line>
                            )}
                            {lineChartSeries.includes("appointments") && (
                              <Line type="monotone" dataKey="appointments" name="Agendamentos" stroke={CHART_COLORS[1]} strokeWidth={2} dot={{ r: 3 }}>
                                <LabelList {...labelProps(getIndicesToShowForSeries(chartData, "appointments", everyN), CHART_COLORS[1])} />
                              </Line>
                            )}
                            {lineChartSeries.includes("sales") && (
                              <Line type="monotone" dataKey="sales" name="Vendas" stroke={CHART_COLORS[2]} strokeWidth={2} dot={{ r: 3 }}>
                                <LabelList {...labelProps(getIndicesToShowForSeries(chartData, "sales", everyN), CHART_COLORS[2])} />
                              </Line>
                            )}
                            {lineChartSeries.includes("investment") && (
                              <Line type="monotone" dataKey="investment" name="Investimento (R$)" stroke={CHART_COLORS[3]} strokeWidth={2} dot={{ r: 3 }}>
                                <LabelList {...labelProps(getIndicesToShowForSeries(chartData, "investment", everyN), CHART_COLORS[3])} />
                              </Line>
                            )}
                          </>
                        )}
                        {evoMode === "custo" && (
                          <>
                            {lineChartCostSeries.includes("cpl") && (
                              <Line type="monotone" dataKey="cpl" name="CPL" stroke={CHART_COST_COLORS[0]} strokeWidth={2} dot={{ r: 3 }}>
                                <LabelList {...labelProps(getIndicesToShowForSeries(chartData, "cpl", everyN), CHART_COST_COLORS[0])} />
                              </Line>
                            )}
                            {lineChartCostSeries.includes("cpa") && (
                              <Line type="monotone" dataKey="cpa" name="CPA" stroke={CHART_COST_COLORS[1]} strokeWidth={2} dot={{ r: 3 }}>
                                <LabelList {...labelProps(getIndicesToShowForSeries(chartData, "cpa", everyN), CHART_COST_COLORS[1])} />
                              </Line>
                            )}
                            {lineChartCostSeries.includes("costPerAgend") && (
                              <Line type="monotone" dataKey="costPerAgend" name="Custo Agend." stroke={CHART_COST_COLORS[2]} strokeWidth={2} dot={{ r: 3 }}>
                                <LabelList {...labelProps(getIndicesToShowForSeries(chartData, "costPerAgend", everyN), CHART_COST_COLORS[2])} />
                              </Line>
                            )}
                          </>
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  );
                })()
              ) : (
                <div className="flex h-full min-h-[190px] items-center justify-center text-sm text-[var(--text-secondary)]">
                  Sem dados para o período.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="tbl-bar">
            <span className="tbl-title">Resumo Mensal</span>
            <button
              type="button"
              className="tbl-cfg-btn"
              onClick={() => setSummaryColPanelOpen((o) => !o)}
              aria-expanded={summaryColPanelOpen}
            >
              ⚙ Colunas
            </button>
          </div>
          <div className={`col-panel ${summaryColPanelOpen ? "open" : ""}`} id="summaryColPanel">
            {SUMMARY_COL_DEFS.map(({ id, label }) => (
              <label key={id} className="col-ck">
                <input
                  type="checkbox"
                  checked={summaryCols.includes(id)}
                  onChange={() => toggleSummaryCol(id)}
                  data-col={id}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="tbl-overflow">
            <table className="compact-table">
              <thead>
                <tr>
                  {summaryCols.map((c) => (
                    <th key={c}>{SUMMARY_COL_DEFS.find((d) => d.id === c)?.label ?? c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {extra?.monthly && extra.monthly.length > 0 ? (
                  extra.monthly.map((row) => (
                    <tr key={row.month}>
                      {summaryCols.map((col) => {
                        if (col === "mes") return <td key={col} className="num">{formatDateDisplay(row.month)}</td>;
                        if (col === "leads") return <td key={col}>{numOrDash(row.leads)}</td>;
                        if (col === "agend") return <td key={col}>{numOrDash(row.appointments)}</td>;
                        if (col === "vendas") return <td key={col} className="num">{numOrDash(row.sales)}</td>;
                        if (col === "fatur") return <td key={col} className="money"><MoneyWithSmallCents value={row.revenue} /></td>;
                        if (col === "invest") return <td key={col} className="cost"><MoneyWithSmallCents value={row.investment} /></td>;
                        if (col === "calls") return <td key={col} className="num">{numOrDash(row.callsRealized)}</td>;
                        if (col === "cpl") return <td key={col} className="rate">{row.leads > 0 ? <MoneyWithSmallCents value={row.investment / row.leads} /> : "—"}</td>;
                        if (col === "cpAgend") return <td key={col} className="cost">{row.appointments > 0 ? <MoneyWithSmallCents value={row.investment / row.appointments} /> : "—"}</td>;
                        if (col === "cpCall") return <td key={col} className="cost">{row.callsRealized > 0 ? <MoneyWithSmallCents value={row.investment / row.callsRealized} /> : "—"}</td>;
                        if (col === "cpa") return <td key={col} className="cost">{row.sales > 0 ? <MoneyWithSmallCents value={row.investment / row.sales} /> : "—"}</td>;
                        if (col === "roas") return <td key={col} className="rate">{row.investment > 0 ? `${(row.revenue / row.investment).toFixed(2)}x` : "—"}</td>;
                        return <td key={col}>—</td>;
                      })}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={summaryCols.length} className="text-center text-[var(--text-dim)]">
                      Nenhum dado no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Performance por responsável — grid de cards (sem card wrapper: só os cards têm fundo) */}
      <div className="sec-label"><span>PERFORMANCE POR RESPONSÁVEL</span></div>
      <div className="resp-section">
        <div className="resp-card-header">
          <span className="card-title">Performance por responsável</span>
          <div className="resp-filter-wrap" ref={filterResponsibleDropdownRef}>
            <span className="resp-filter-label">Filtrar</span>
            <button
              type="button"
              onClick={() => setFilterResponsibleDropdownOpen((o) => !o)}
              className="resp-filter-btn"
              aria-expanded={filterResponsibleDropdownOpen}
              aria-label="Filtrar por responsável"
            >
              {filterResponsible.length === 0 ? "Todos" : filterResponsible.length === 1 ? filterResponsible[0] : `${filterResponsible.length} selecionados`}
              <span style={{ color: "var(--text-dim)" }}>{filterResponsibleDropdownOpen ? "▲" : "▼"}</span>
            </button>
            {filterResponsibleDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 z-10 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] shadow-lg py-2 max-h-[220px] overflow-y-auto min-w-[180px]">
                <label className="col-ck flex px-3 py-1.5 hover:bg-[var(--bg-hover)] cursor-pointer">
                  <input type="checkbox" checked={filterResponsible.length === 0} onChange={() => setFilterResponsible([])} />
                  <span className="ml-2">Todos</span>
                </label>
                {extra?.byResponsible?.map((r) => (
                  <label key={r.name} className="col-ck flex px-3 py-1.5 hover:bg-[var(--bg-hover)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filterResponsible.includes(r.name)}
                      onChange={() => setFilterResponsible((prev) => (prev.includes(r.name) ? prev.filter((x) => x !== r.name) : [...prev, r.name]))}
                    />
                    <span className="ml-2">{r.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="resp-grid">
          {(() => {
            const list = !extra?.byResponsible?.length ? [] : filterResponsible.length > 0 ? extra.byResponsible.filter((r) => filterResponsible.includes(r.name)) : extra.byResponsible;
            const totalOpp = (extra?.byResponsible ?? []).reduce((s, r) => s + r.opportunities, 0);
            const sorted = [...list].sort((a, b) => b.sales - a.sales);
            const withRank = sorted.map((r, i) => {
              const hasSales = r.sales > 0;
              const rank = hasSales && i === 0 ? 1 : hasSales && i === 1 ? 2 : null;
              return { ...r, rank };
            });
            if (withRank.length === 0) {
              return <div className="col-span-full py-6 text-center text-[var(--text-dim)] text-sm">Nenhum dado.</div>;
            }
            return withRank.map((r) => {
              const pctTotal = totalOpp > 0 ? (r.opportunities / totalOpp) * 100 : 0;
              const convVal = r.opportunities > 0 ? r.conversionRate : null;
              return (
                <div
                  key={r.name}
                  className={`resp-card ${r.sales > 0 ? "has-sales" : ""} ${r.rank === 1 ? "rank-1" : ""} ${r.rank === 2 ? "rank-2" : ""}`}
                >
                  <div className="resp-head">
                    <span className="resp-rank">{r.rank === 1 ? "#1" : r.rank === 2 ? "#2" : "—"}</span>
                    <div className="resp-avatar" style={r.name === "Não atribuído" ? { fontSize: "13px" } : undefined}>{getInitials(r.name)}</div>
                    <div className="resp-info">
                      <div className="resp-name">{r.name}</div>
                      <div className="resp-role">—</div>
                    </div>
                  </div>
                  <div className="resp-metrics">
                    <div className="resp-metric">
                      <span className="rm-label">Oport.</span>
                      <span className="rm-val" style={{ color: "var(--text-primary)" }}>{r.opportunities}</span>
                    </div>
                    <div className="resp-metric">
                      <span className="rm-label">Calls</span>
                      <span className="rm-val dim">—</span>
                    </div>
                    <div className="resp-metric">
                      <span className="rm-label">Vendas</span>
                      <span className={`rm-val ${r.rank === 1 ? "" : r.rank === 2 ? "" : "dim"}`} style={r.sales > 0 ? (r.rank === 1 ? { color: "var(--danger)" } : r.rank === 2 ? { color: "var(--accent)" } : { color: "var(--text-primary)" }) : undefined}>{r.sales > 0 ? r.sales : "—"}</span>
                    </div>
                    <div className="resp-metric conv-metric">
                      <span className="rm-label">Tx. conv.</span>
                      <span className={`rm-val ${r.rank === 1 ? "conv-rank1" : r.rank === 2 ? "conv-rank2" : "dim"}`}>{convVal != null ? (r.rank === 1 ? "★ " : "") + convVal.toFixed(1) + "%" : "—"}</span>
                      <span className="rm-sub">vendas / oport.</span>
                    </div>
                  </div>
                  <div className="resp-oport">
                    <div className="resp-oport-meta">
                      <span className="resp-oport-label">% das oportunidades totais</span>
                      <span className="resp-oport-nums">{r.opportunities} <span>/ {totalOpp.toLocaleString("pt-BR")} · {pctTotal.toFixed(1)}%</span></span>
                    </div>
                    <div className="resp-track"><div className="resp-fill" style={{ width: `${Math.min(pctTotal, 100)}%` }} /></div>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* 4) UTMs — 3 tabelas com seleção de colunas */}
      <div className="sec-label"><span>Origem das oportunidades · UTMs</span></div>
      <div className="utm-three">
        <div className="utm-card">
          <div className="tbl-bar" style={{ padding: "10px 12px" }}>
            <span className="tbl-title" style={{ fontSize: ".72rem" }}>Campaign</span>
            <button
              type="button"
              className="tbl-cfg-btn"
              style={{ fontSize: "7.5px" }}
              onClick={() => setUtmColPanelOpen((o) => (o === "camp" ? null : "camp"))}
              aria-expanded={utmColPanelOpen === "camp"}
            >
              ⚙ Colunas
            </button>
          </div>
          <div className={`col-panel ${utmColPanelOpen === "camp" ? "open" : ""}`} style={{ padding: "8px 10px" }}>
            {[
              { id: "name", label: "Fonte" },
              { id: "leads", label: "Leads" },
              { id: "vendas", label: "Vendas" },
              { id: "fatur", label: "Fatur." },
              { id: "invest", label: "Invest." },
              { id: "agend", label: "Agend." },
              { id: "calls", label: "Calls" },
            ].map(({ id, label }) => (
              <label key={id} className="col-ck">
                <input type="checkbox" checked={utmCols.includes(id)} onChange={() => toggleUtmCol(id)} data-col={id} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="utm-table-body">
            <table className="compact-table utm-table">
              <thead>
                <tr>
                  {utmCols.map((c) => (
                    <th key={c}>{c === "name" ? "Campaign" : c === "leads" ? "Leads" : c === "vendas" ? "Vendas" : c === "fatur" ? "Fatur." : c === "invest" ? "Invest." : c === "agend" ? "Agend." : "Calls"}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(extra?.utmCampaign ?? []).slice(0, 10).map((row) => (
                  <tr key={row.name}>
                    {utmCols.map((col) => {
                      if (col === "name") return <td key={col} className="truncate max-w-[120px]" title={row.name}>{row.name || "—"}</td>;
                      if (col === "leads") return <td key={col} className="rate">{numOrDash(row.leads)}</td>;
                      if (col === "vendas") return <td key={col} className="num">{numOrDash(row.sales)}</td>;
                      if (col === "fatur") return <td key={col} className="money"><MoneyWithSmallCents value={row.revenue} /></td>;
                      if (col === "invest") return <td key={col} className="money"><MoneyWithSmallCents value={row.investment ?? 0} /></td>;
                      if (col === "agend") return <td key={col} className="num">{numOrDash(row.appointments ?? 0)}</td>;
                      if (col === "calls") return <td key={col} className="num">{numOrDash(row.callsRealized ?? 0)}</td>;
                      return null;
                    })}
                  </tr>
                ))}
                {(!extra?.utmCampaign || extra.utmCampaign.length === 0) && (
                  <tr><td colSpan={utmCols.length} className="text-[var(--text-dim)]">Nenhum dado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="utm-card">
          <div className="tbl-bar" style={{ padding: "10px 12px" }}>
            <span className="tbl-title" style={{ fontSize: ".72rem" }}>Medium</span>
            <button
              type="button"
              className="tbl-cfg-btn"
              style={{ fontSize: "7.5px" }}
              onClick={() => setUtmColPanelOpen((o) => (o === "med" ? null : "med"))}
              aria-expanded={utmColPanelOpen === "med"}
            >
              ⚙ Colunas
            </button>
          </div>
          <div className={`col-panel ${utmColPanelOpen === "med" ? "open" : ""}`} style={{ padding: "8px 10px" }}>
            {[
              { id: "name", label: "Fonte" },
              { id: "leads", label: "Leads" },
              { id: "vendas", label: "Vendas" },
              { id: "fatur", label: "Fatur." },
              { id: "invest", label: "Invest." },
              { id: "agend", label: "Agend." },
              { id: "calls", label: "Calls" },
            ].map(({ id, label }) => (
              <label key={id} className="col-ck">
                <input type="checkbox" checked={utmCols.includes(id)} onChange={() => toggleUtmCol(id)} data-col={id} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="utm-table-body">
            <table className="compact-table utm-table">
              <thead>
                <tr>
                  {utmCols.map((c) => (
                    <th key={c}>{c === "name" ? "Medium" : c === "leads" ? "Leads" : c === "vendas" ? "Vendas" : c === "fatur" ? "Fatur." : c === "invest" ? "Invest." : c === "agend" ? "Agend." : "Calls"}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(extra?.utmMedium ?? []).slice(0, 10).map((row) => (
                  <tr key={row.name}>
                    {utmCols.map((col) => {
                      if (col === "name") return <td key={col} className="truncate max-w-[120px]" title={row.name}>{row.name || "—"}</td>;
                      if (col === "leads") return <td key={col} className="rate">{numOrDash(row.leads)}</td>;
                      if (col === "vendas") return <td key={col} className="num">{numOrDash(row.sales)}</td>;
                      if (col === "fatur") return <td key={col} className="money"><MoneyWithSmallCents value={row.revenue} /></td>;
                      if (col === "invest") return <td key={col} className="money"><MoneyWithSmallCents value={row.investment ?? 0} /></td>;
                      if (col === "agend") return <td key={col} className="num">{numOrDash(row.appointments ?? 0)}</td>;
                      if (col === "calls") return <td key={col} className="num">{numOrDash(row.callsRealized ?? 0)}</td>;
                      return null;
                    })}
                  </tr>
                ))}
                {(!extra?.utmMedium || extra.utmMedium.length === 0) && (
                  <tr><td colSpan={utmCols.length} className="text-[var(--text-dim)]">Nenhum dado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="utm-card">
          <div className="tbl-bar" style={{ padding: "10px 12px" }}>
            <span className="tbl-title" style={{ fontSize: ".72rem" }}>Content</span>
            <button
              type="button"
              className="tbl-cfg-btn"
              style={{ fontSize: "7.5px" }}
              onClick={() => setUtmColPanelOpen((o) => (o === "cont" ? null : "cont"))}
              aria-expanded={utmColPanelOpen === "cont"}
            >
              ⚙ Colunas
            </button>
          </div>
          <div className={`col-panel ${utmColPanelOpen === "cont" ? "open" : ""}`} style={{ padding: "8px 10px" }}>
            {[
              { id: "name", label: "Fonte" },
              { id: "leads", label: "Leads" },
              { id: "vendas", label: "Vendas" },
              { id: "fatur", label: "Fatur." },
              { id: "invest", label: "Invest." },
              { id: "agend", label: "Agend." },
              { id: "calls", label: "Calls" },
            ].map(({ id, label }) => (
              <label key={id} className="col-ck">
                <input type="checkbox" checked={utmCols.includes(id)} onChange={() => toggleUtmCol(id)} data-col={id} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <div className="utm-table-body">
            <table className="compact-table utm-table">
              <thead>
                <tr>
                  {utmCols.map((c) => (
                    <th key={c}>{c === "name" ? "Content" : c === "leads" ? "Leads" : c === "vendas" ? "Vendas" : c === "fatur" ? "Fatur." : c === "invest" ? "Invest." : c === "agend" ? "Agend." : "Calls"}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(extra?.utmContent ?? []).slice(0, 10).map((row) => (
                  <tr key={row.name}>
                    {utmCols.map((col) => {
                      if (col === "name") return <td key={col} className="truncate max-w-[120px]" title={row.name}>{row.name || "—"}</td>;
                      if (col === "leads") return <td key={col} className="rate">{numOrDash(row.leads)}</td>;
                      if (col === "vendas") return <td key={col} className="num">{numOrDash(row.sales)}</td>;
                      if (col === "fatur") return <td key={col} className="money"><MoneyWithSmallCents value={row.revenue} /></td>;
                      if (col === "invest") return <td key={col} className="money"><MoneyWithSmallCents value={row.investment ?? 0} /></td>;
                      if (col === "agend") return <td key={col} className="num">{numOrDash(row.appointments ?? 0)}</td>;
                      if (col === "calls") return <td key={col} className="num">{numOrDash(row.callsRealized ?? 0)}</td>;
                      return null;
                    })}
                  </tr>
                ))}
                {(!extra?.utmContent || extra.utmContent.length === 0) && (
                  <tr><td colSpan={utmCols.length} className="text-[var(--text-dim)]">Nenhum dado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 5) Origem das oportunidades — com seleção de colunas */}
      <div className="sec-label"><span>Origem das oportunidades</span></div>
      <div className="card">
        <div className="tbl-bar">
          <span className="tbl-title">Por canal de origem</span>
          <button
            type="button"
            className="tbl-cfg-btn"
            onClick={() => setOrigemColPanelOpen((o) => !o)}
            aria-expanded={origemColPanelOpen}
          >
            ⚙ Colunas
          </button>
        </div>
        <div className={`col-panel ${origemColPanelOpen ? "open" : ""}`}>
          {[
            { id: "origem", label: "Origem" },
            { id: "oportunidades", label: "Oportunidades" },
            { id: "vendas", label: "Vendas" },
            { id: "fatur", label: "Fatur." },
            { id: "conversao", label: "Conversão" },
          ].map(({ id, label }) => (
            <label key={id} className="col-ck">
              <input
                type="checkbox"
                checked={origemCols.includes(id)}
                onChange={() => toggleOrigemCol(id)}
                data-col={id}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div className="tbl-overflow">
          <table className="compact-table">
            <thead>
              <tr>
                {origemCols.map((c) => (
                  <th key={c}>
                    {c === "origem" ? "Origem" : c === "oportunidades" ? "Oportunidades" : c === "vendas" ? "Vendas" : c === "fatur" ? "Faturamento" : "Conversão"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {extra?.bySource && extra.bySource.length > 0 ? (
                extra.bySource.map((row) => (
                  <tr key={row.source}>
                    {origemCols.map((col) => {
                      if (col === "origem") return <td key={col}>{row.source}</td>;
                      if (col === "oportunidades") return <td key={col} className="num">{numOrDash(row.opportunities)}</td>;
                      if (col === "vendas") return <td key={col} className="num">{numOrDash(row.sales)}</td>;
                      if (col === "fatur") return <td key={col} className="money"><MoneyWithSmallCents value={row.revenue} /></td>;
                      if (col === "conversao") return <td key={col} className="rate">{rateOrDash(row.conversion)}</td>;
                      return null;
                    })}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={origemCols.length} className="text-center text-[var(--text-dim)]">Nenhum dado.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Análise de campos personalizados — dividir por campo */}
      {extra?.splitByField && extra.splitByField.length > 0 && (
        <>
          <div className="sec-label"><span>Análise de campos personalizados</span></div>
          {splitSelectedFilter && (
            <div className="split-filter-chip">
              <span className="split-filter-label">Filtro:</span>
              <span className="split-filter-value">{splitSelectedFilter.label} = {splitSelectedFilter.value}</span>
              <button
                type="button"
                onClick={() => setSplitSelectedFilter(null)}
                className="split-filter-clear"
                aria-label="Limpar filtro"
              >
                Limpar
              </button>
            </div>
          )}
          <div className="two-panels">
            {extra.splitByField
              .filter((panel) => panel.dimId !== "revenue_range")
              .map((panel) => {
              const isRevenueRange = false;
              const badge = isRevenueRange ? "campo GHL" : `${panel.totalOpportunities.toLocaleString("pt-BR")} oport.`;
              const colors = ["var(--accent)", "var(--hi)", "var(--blue)", "var(--danger)"];
              const sortState = splitSortByPanel[panel.dimId] ?? { key: "revenue", dir: "desc" as const };
              const getSortVal = (row: typeof panel.rows[0]) => {
                const v = row[sortState.key as keyof typeof row];
                if (typeof v === "string") return v.toLowerCase();
                return Number(v) ?? 0;
              };
              const sortedRows = [...panel.rows].sort((a, b) => {
                const va = getSortVal(a);
                const vb = getSortVal(b);
                const cmp = typeof va === "string" ? (va as string).localeCompare(vb as string) : (va as number) - (vb as number);
                return sortState.dir === "desc" ? -cmp : cmp;
              });
              const totalRows = sortedRows.length;
              const totalPages = Math.max(1, Math.ceil(totalRows / SPLIT_PAGE_SIZE));
              const page = Math.min(splitPageByPanel[panel.dimId] ?? 0, totalPages - 1);
              const pageStart = page * SPLIT_PAGE_SIZE;
              const pageRows = sortedRows.slice(pageStart, pageStart + SPLIT_PAGE_SIZE);

              return (
                <div key={panel.dimId} className="panel split-panel">
                  <div className="panel-header split-panel-header">
                    <div className="split-panel-title-row">
                      <span className="panel-title">Por {panel.label.toLowerCase()}</span>
                      <span className={`panel-badge ${isRevenueRange ? "badge-purple" : "badge-teal"}`}>{badge}</span>
                    </div>
                    <div className="split-sort-in-panel">
                      <select
                        value={sortState.key}
                        onChange={(e) => {
                          setSplitSortByPanel((p) => ({ ...p, [panel.dimId]: { ...sortState, key: e.target.value } }));
                          setSplitPageByPanel((p) => ({ ...p, [panel.dimId]: 0 }));
                        }}
                        className="split-sort-select"
                        aria-label={`Ordenar por (${panel.label})`}
                      >
                        {SPLIT_SORT_OPTIONS.map((o) => (
                          <option key={o.id} value={o.id}>{o.label}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setSplitSortByPanel((p) => ({ ...p, [panel.dimId]: { ...sortState, dir: sortState.dir === "asc" ? "desc" : "asc" } }))}
                        className="split-sort-dir"
                        title={sortState.dir === "desc" ? "Decrescente" : "Crescente"}
                        aria-label={sortState.dir === "desc" ? "Decrescente" : "Crescente"}
                      >
                        {sortState.dir === "desc" ? "↓" : "↑"}
                      </button>
                    </div>
                  </div>
                  <div className="row-list">
                    {pageRows.map((row, idx) => {
                      const hasData = row.revenue > 0 || row.sales > 0;
                      const color = hasData ? colors[idx % colors.length] : "var(--text-dim)";
                      const colorDim = color === "var(--accent)" ? "var(--accent-dim)" : color === "var(--hi)" ? "var(--hi-dim)" : color === "var(--blue)" ? "rgba(79,110,247,0.1)" : "var(--danger-muted)";
                      const tagPct = panel.totalOpportunities > 0 && !isRevenueRange ? (row.opportunities / panel.totalOpportunities) * 100 : (row.sales > 0 && panel.rows.some((r) => r.sales > 0) ? (row.sales / panel.rows.filter((r) => r.sales > 0).reduce((s, r) => s + r.sales, 0)) * 100 : 0);
                      const tagLabel = isRevenueRange ? `${row.sales} vendas · ${row.pctRevenue.toFixed(1)}%` : `${row.opportunities} leads · ${tagPct.toFixed(1)}%`;
                      const isSelectedFilter = splitSelectedFilter?.dimId === panel.dimId && splitSelectedFilter?.value === row.value;
                      return (
                        <div
                          key={`${row.value}-${pageStart + idx}`}
                          className={`data-row split-data-row ${isSelectedFilter ? "split-data-row-selected" : ""}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            if (isSelectedFilter) setSplitSelectedFilter(null);
                            else setSplitSelectedFilter({ dimId: panel.dimId, value: row.value, label: panel.label });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              if (isSelectedFilter) setSplitSelectedFilter(null);
                              else setSplitSelectedFilter({ dimId: panel.dimId, value: row.value, label: panel.label });
                            }
                          }}
                          aria-pressed={isSelectedFilter}
                          aria-label={isSelectedFilter ? `Filtrar por ${row.value} (clique para desmarcar)` : `Filtrar por ${row.value}`}
                        >
                          <div className="row-top">
                            <span className={`row-name ${!hasData ? "muted" : ""}`}>{row.value}</span>
                            <span className="row-tag" style={{ background: hasData ? colorDim : "transparent", color, border: `1px solid ${hasData ? color : "var(--border)"}` }}>{tagLabel}</span>
                          </div>
                          <div className="row-bar-track">
                            <div className="row-bar-fill" style={{ width: `${Math.min(row.pctRevenue, 100)}%`, background: hasData ? `linear-gradient(90deg,${colorDim},${color})` : "rgba(255,255,255,0.04)" }} />
                          </div>
                          <div className="row-chips">
                            <div className="chip">
                              <span className="chip-label">Agend.</span>
                              <span className="chip-val" style={row.appointments > 0 ? { color: "var(--text-primary)" } : undefined}>{row.appointments > 0 ? row.appointments : "—"}</span>
                            </div>
                            <div className="chip">
                              <span className="chip-label">Calls</span>
                              <span className="chip-val" style={row.callsRealized > 0 ? { color: "var(--text-primary)" } : undefined}>{row.callsRealized > 0 ? row.callsRealized : "—"}</span>
                            </div>
                            <div className="chip">
                              <span className="chip-label">Vendas</span>
                              <span className="chip-val" style={row.sales > 0 ? { color } : undefined}>{row.sales > 0 ? row.sales : "—"}</span>
                            </div>
                            <div className="chip">
                              <span className="chip-label">Faturamento</span>
                              <span className={`chip-val ${row.revenue > 0 ? "" : "dim"}`} style={row.revenue > 0 ? { color } : undefined}>{row.revenue > 0 ? <MoneyWithSmallCents value={row.revenue} /> : "—"}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {totalPages > 1 && (
                    <div className="split-pagination">
                      <button
                        type="button"
                        disabled={page === 0}
                        onClick={() => setSplitPageByPanel((p) => ({ ...p, [panel.dimId]: page - 1 }))}
                        className="split-pagination-btn"
                        aria-label="Página anterior"
                      >
                        Anterior
                      </button>
                      <span className="split-pagination-info">
                        {page + 1} / {totalPages} <span className="split-pagination-total">({totalRows} itens)</span>
                      </span>
                      <button
                        type="button"
                        disabled={page >= totalPages - 1}
                        onClick={() => setSplitPageByPanel((p) => ({ ...p, [panel.dimId]: page + 1 }))}
                        className="split-pagination-btn"
                        aria-label="Próxima página"
                      >
                        Próxima
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
