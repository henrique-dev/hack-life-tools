/** Local date and time as YYYYMMDD_HHMMSS, for file names. */
export function timestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(message)), ms)));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
