/**
 * Logs para fluxos de sincronização (GHL, etc.). Aparecem nos logs do servidor (ex.: Vercel).
 */
const PREFIX = "[GHL Sync]";

export const syncLog = {
  info: (msg: string, data?: Record<string, unknown>) => {
    if (data) console.log(PREFIX, msg, data);
    else console.log(PREFIX, msg);
  },
  error: (msg: string, err?: unknown, data?: Record<string, unknown>) => {
    const errMsg = err instanceof Error ? err.message : err != null ? String(err) : undefined;
    const errStack = err instanceof Error ? err.stack : undefined;
    console.error(PREFIX, msg, { ...data, error: errMsg, stack: errStack });
  },
};
