import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The single timezone the app displays all dates/times in. The product
 * is targeted at the Vietnamese tennis-reporter market, so we hardcode
 * GMT+7 (Asia/Ho_Chi_Minh) regardless of the user's browser locale.
 * Change this constant to localize the app for a different market.
 */
export const APP_TIMEZONE = "Asia/Ho_Chi_Minh";

/**
 * Format a Date as a YYYY-MM-DD key, in the app's display timezone
 * (GMT+7). This is what gets sent to the Tennis API as the `Date=`
 * query param and what the dashboard uses to pick a "day".
 *
 * If the user is in a different browser timezone, we still want the
 * day boundaries to be in Vietnam time. E.g. at 23:30 UTC on 2026-07-31
 * (= 06:30 GMT+2 on 2026-08-01), the user is in a new day locally
 * but the API should still be queried for Vietnam's 2026-07-31.
 */
export function formatDateKey(date: Date): string {
  // en-CA gives "YYYY-MM-DD" output. Combined with the timezone
  // option, this gives the YYYY-MM-DD the date falls on in GMT+7.
  return date.toLocaleDateString("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * Parse a YYYY-MM-DD date key into a Date object that, when displayed
 * in the app's timezone (GMT+7), shows that calendar date.
 *
 * Implementation: create the Date at midnight UTC of the given date.
 * At display time (in GMT+7), that instant is 07:00 GMT+7 on the
 * same date, so `formatDateVi(parseDateKey("2026-07-31"))` shows
 * "Thứ Sáu, 31/07/2026" regardless of the browser's local timezone.
 */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function timeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "vừa xong";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

/**
 * Format a Date as HH:MM in the app's timezone (GMT+7).
 */
export function formatTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: APP_TIMEZONE,
  });
}

/**
 * Format a Date as a long Vietnamese date string in the app's timezone.
 * Example: "Thứ sáu, 31/07/2026"
 */
export function formatDateVi(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: APP_TIMEZONE,
  });
}

/**
 * Short date in the app's timezone. Example: "31/07"
 */
export function formatDateShort(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: APP_TIMEZONE,
  });
}

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
