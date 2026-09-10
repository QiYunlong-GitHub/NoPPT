export { cn } from './cn';
export { storage } from './storage';
export * from './security';

export function getBeijingTime(): Date {
  const now = new Date();
  const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcTime + 8 * 3600000);
}

export function formatBeijingTime(date?: Date, includeSeconds: boolean = true): string {
  const d = date || getBeijingTime();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  let result = `${year}-${month}-${day} ${hours}:${minutes}`;
  if (includeSeconds) {
    result += `:${seconds}`;
  }
  return result;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);

  if (minutes > 0) {
    return `${minutes}分${seconds % 60}秒`;
  } else if (seconds > 0) {
    return `${seconds}.${Math.floor((ms % 1000) / 100)}秒`;
  } else {
    return `${ms}毫秒`;
  }
}

export function formatClockTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const tenths = Math.floor((ms % 1000) / 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}
