import webpush from "web-push";
import { createHash } from "node:crypto";
import { redis } from "./shared.js";

/* ---------- app notifications (free) ---------- */
// The keys are made once and kept in the database, so nothing needs setting up on Vercel.
export async function vapid() {
  let k = await redis.get("vapid");
  if (typeof k === "string") k = JSON.parse(k);
  if (!k || !k.publicKey) {
    k = webpush.generateVAPIDKeys();
    await redis.set("vapid", JSON.stringify(k));
  }
  return k;
}
export const subKey = endpoint => createHash("sha256").update(String(endpoint)).digest("hex").slice(0, 32);

export async function pushAll(payload) {
  const k = await vapid();
  webpush.setVapidDetails("mailto:noreply@lubavitch-boys-minyan.vercel.app", k.publicKey, k.privateKey);
  const subs = (await redis.hgetall("push")) || {};
  let sent = 0;
  await Promise.all(Object.entries(subs).map(async ([key, v]) => {
    try { await webpush.sendNotification(v.sub, JSON.stringify(payload), { TTL: 60 * 60 * 48 }); sent++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await redis.hdel("push", key); }
  }));
  return sent;
}

/* ---------- text messages (Twilio, costs money) ---------- */
// Needs 3 settings on Vercel: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
export const smsReady = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);

// UK numbers: 07700 900123 -> +447700900123
export function cleanPhone(p) {
  let n = String(p || "").replace(/[\s\-().]/g, "");
  if (n.startsWith("00")) n = "+" + n.slice(2);
  if (/^0\d{10}$/.test(n)) n = "+44" + n.slice(1);
  return /^\+\d{10,15}$/.test(n) ? n : "";
}

export async function smsAll(text) {
  if (!smsReady()) return 0;
  const phones = (await redis.hgetall("phone")) || {};
  const sid = process.env.TWILIO_ACCOUNT_SID, auth = Buffer.from(sid + ":" + process.env.TWILIO_AUTH_TOKEN).toString("base64");
  const nums = [...new Set(Object.values(phones).filter(Boolean))];
  let sent = 0;
  // send 8 at a time
  for (let i = 0; i < nums.length; i += 8) {
    await Promise.all(nums.slice(i, i + 8).map(async to => {
      try {
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: "POST",
          headers: { Authorization: "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM, Body: text }),
        });
        if (r.ok) sent++;
      } catch (e) {}
    }));
  }
  return sent;
}
