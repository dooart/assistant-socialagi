import { DateTime } from "luxon";

export function formatISOToNaturalTime(isoString: string, userLocale = "en-US") {
  const date = new Date(isoString);

  const formatter = new Intl.DateTimeFormat(userLocale, {
    hour: "numeric",
    minute: "2-digit",
  });
  return formatter.format(date);
}

export function getLocalUserTimezone() {
  return DateTime.local().zoneName ?? DateTime.utc().zoneName ?? "UTC";
}

export function getLocalUserIsoTimeWithTz() {
  return DateTime.local().toISO() ?? DateTime.utc().toISO() ?? new Date().toISOString();
}

export function getLocalWeekDay(): string {
  return DateTime.local().toFormat("cccc");
}
