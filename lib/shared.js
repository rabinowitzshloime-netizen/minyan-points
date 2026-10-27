import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

export const RULES = ["time", "daven", "join", "lein"];
export const PARTS = ["rishon","sheni","shlishi","revii","chamishi","shishi","shevii","maftir","haftorah"];
export const WEEK_MAX = 4, BONUS = 3;

// The most recent Shabbos (UK time). Points given Motzei Shabbos to Friday count for it.
export function weekKey() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = t => +parts.find(p => p.type === t).value;
  const d = new Date(Date.UTC(g("year"), g("month") - 1, g("day")));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7));
  return d.toISOString().slice(0, 10);
}

export async function getState() {
  const [boys, pts, leins] = await Promise.all([redis.hgetall("boys"), redis.hgetall("pts"), redis.hgetall("leins")]);
  return { boys: boys || {}, pts: pts || {}, leins: leins || {}, week: weekKey() };
}

export function isAdmin(code) {
  const real = process.env.ADMIN_CODE || "";
  return real.length > 0 && typeof code === "string" && code === real;
}
