import { Redis } from "@upstash/redis";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { HebrewCalendar } from "@hebcal/core";

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

function londonToday() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = t => +parts.find(p => p.type === t).value;
  return new Date(g("year"), g("month") - 1, g("day"));
}
// The parshiyos read in the coming year, in order, e.g. [["Vayera"], ..., ["Vayakhel","Pekudei"], ...]
// so the site can show the double parshiyos only in years they're read together.
const ymd = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
function upcomingEvents() {
  const start = londonToday(), end = new Date(start); end.setDate(end.getDate() + 400);
  return HebrewCalendar.calendar({ start, end, sedrot: true, il: false, noHolidays: true }).filter(e => e.parsha);
}
export function upcomingParshiyos() {
  try { return upcomingEvents().map(e => e.parsha); } catch (e) { return null; }
}
// the Shabbos date of each of those, e.g. "2026-10-31"
export function upcomingDates() {
  try { return upcomingEvents().map(e => ymd(e.getDate().greg())); } catch (e) { return null; }
}
export const todayYmd = () => ymd(londonToday());
// This week's parsha (outside Eretz Yisroel), e.g. ["Vayera"] or ["Vayakhel","Pekudei"]
export function weekParsha() {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const g = t => +parts.find(p => p.type === t).value;
    const start = new Date(g("year"), g("month") - 1, g("day"));
    const end = new Date(start); end.setDate(end.getDate() + 28);
    const ev = HebrewCalendar.calendar({ start, end, sedrot: true, il: false, noHolidays: true }).find(e => e.parsha);
    return ev ? ev.parsha : null;
  } catch (e) { return null; }
}

// Everything in the database (only used on the server).
export async function getState() {
  const [boys, pts, leins, posts] = await Promise.all([redis.hgetall("boys"), redis.hgetall("pts"), redis.hgetall("leins"), redis.hgetall("posts")]);
  const polls = Object.keys(posts || {}).filter(k => (posts[k].options || []).length);
  const vs = await Promise.all(polls.map(k => redis.hgetall("v:" + k)));
  const votes = {}; polls.forEach((k, i) => { votes[k] = vs[i] || {}; });
  return { boys: boys || {}, pts: pts || {}, leins: leins || {}, posts: posts || {}, votes, week: weekKey() };
}

/* ----- logins ----- */
export const cleanUser = u => String(u || "").trim().toLowerCase();
export const USER_OK = /^[a-z0-9_.-]{3,20}$/;
export function hashPw(pw) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(String(pw), salt, 32).toString("hex");
}
export function checkPw(pw, stored) {
  if (typeof stored !== "string" || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const a = scryptSync(String(pw), salt, 32), b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function newSession(boyId, boy) {
  const token = randomBytes(32).toString("hex");
  await redis.set("s:" + token, boyId + ":" + (boy.ver || 0), { ex: 60 * 60 * 12 });
  return token;
}
export async function sessionUser(token, boys) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  const v = await redis.get("s:" + token);
  if (typeof v !== "string") return null;
  const [id, ver] = v.split(":");
  const b = boys[id];
  return b && String(b.ver || 0) === ver && b.pw ? id : null;
}

// What a viewer is allowed to see: everyone sees names and points; only you see your own details.
export function publicState(s, me, admin) {
  const boys = {}, pts = {}, votes = {}, myVotes = {};
  for (const [id, b] of Object.entries(s.boys)) boys[id] = { name: b.name, claimed: !!b.pw, ...(admin ? { username: b.username || "" } : {}) };
  for (const [id, r] of Object.entries(s.pts)) pts[id] = admin || id === me ? r : { points: r.points || 0 };
  for (const [pid, v] of Object.entries(s.votes)) {
    const p = s.posts[pid]; const counts = (p.options || []).map(() => 0);
    Object.values(v).forEach(n => { if (counts[n] !== undefined) counts[n]++; });
    votes[pid] = counts;
    if (me && v[me] !== undefined) myVotes[pid] = Number(v[me]);
  }
  const leins = {};
  for (const [id, l] of Object.entries(s.leins)) leins[id] = l;
  const upcoming = upcomingParshiyos();
  return { boys, pts, leins, posts: s.posts, votes, myVotes, me: me || null, week: s.week, parsha: upcoming ? upcoming[0] : weekParsha(), upcoming, upcomingDates: upcomingDates(), today: todayYmd() };
}

export function isAdmin(code) {
  const real = process.env.ADMIN_CODE || "";
  return real.length > 0 && typeof code === "string" && code === real;
}
