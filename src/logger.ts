/** Minimal structured logger. Swap for pino in deployment. */
type Level = 'debug' | 'info' | 'warn' | 'error';
const emit = (level: Level, obj: unknown, msg?: string) => {
  const line = { level, at: new Date().toISOString(), msg: msg ?? '', ...(typeof obj === 'object' && obj ? obj : { value: obj }) };
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(JSON.stringify(line));
};
export const logger = {
  debug: (o: unknown, m?: string) => emit('debug', o, m),
  info:  (o: unknown, m?: string) => emit('info', o, m),
  warn:  (o: unknown, m?: string) => emit('warn', o, m),
  error: (o: unknown, m?: string) => emit('error', o, m),
};
