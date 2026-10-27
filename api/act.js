import { redis, getState, isAdmin, weekKey, RULES, PARTS, WEEK_MAX, BONUS } from "../lib/shared.js";

const id = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
class Oops extends Error {}
const no = msg => { throw new Oops(msg); };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const out = {};
  try {
    const s = await getState();
    const boy = bid => s.boys[bid] || no("That name isn't on the list.");

    switch (b.action) {
      /* ----- anyone ----- */
      case "addBoy": {
        const name = String(b.name || "").trim().slice(0, 30);
        if (!name) no("Type your name first.");
        if (Object.keys(s.boys).length >= 300) no("The list is full. Ask the admin.");
        out.id = id();
        await redis.hset("boys", { [out.id]: { name } });
        break;
      }
      case "signLein": {
        boy(b.boyId);
        if (!PARTS.includes(b.part)) no("Pick a part.");
        const parsha = String(b.parsha || "").slice(0, 40);
        const taken = Object.values(s.leins).some(l => l.parsha === parsha && l.part === b.part);
        if (taken) no("Someone already took that part.");
        await redis.hset("leins", { [id()]: { boyId: b.boyId, parsha, part: b.part, awarded: false } });
        break;
      }
      case "dropLein": {
        const l = s.leins[b.leinId];
        if (!l || l.boyId !== b.boyId || l.awarded) no("You can't remove that one.");
        await redis.hdel("leins", b.leinId);
        break;
      }
      case "checkCode": {
        if (!isAdmin(b.code)) no("Wrong code.");
        break;
      }

      /* ----- admin only ----- */
      default: {
        if (!isAdmin(b.code)) return res.status(401).json({ error: "Wrong admin code." });
        const wk = weekKey();
        const rec = bid => s.pts[bid] || { points: 0, week: "", done: [], given: 0 };
        const give = async (bid, key) => {
          boy(bid);
          const r = rec(bid), done = r.week === wk ? (r.done || []) : [];
          if (done.includes(key)) no(`${s.boys[bid].name} already got this point for Shabbos.`);
          if (done.length >= WEEK_MAX) no(`${s.boys[bid].name} already has ${WEEK_MAX} points for Shabbos.`);
          await redis.hset("pts", { [bid]: { ...r, points: (r.points || 0) + 1, week: wk, done: [...done, key] } });
        };
        switch (b.action) {
          case "give":
            if (!RULES.includes(b.key) || b.key === "lein") no("Pick a rule.");
            await give(b.boyId, b.key); break;
          case "awardLein": {
            const l = s.leins[b.leinId] || no("That leining isn't there anymore.");
            if (l.awarded) no("Already given.");
            await give(l.boyId, "lein");
            await redis.hset("leins", { [b.leinId]: { ...l, awarded: true } });
            break;
          }
          case "bonus": { boy(b.boyId); const r = rec(b.boyId); await redis.hset("pts", { [b.boyId]: { ...r, points: (r.points || 0) + BONUS } }); break; }
          case "minus": { boy(b.boyId); const r = rec(b.boyId); if (!r.points) no("They have 0 points."); await redis.hset("pts", { [b.boyId]: { ...r, points: r.points - 1 } }); break; }
          case "markGiven": { boy(b.boyId); const r = rec(b.boyId); await redis.hset("pts", { [b.boyId]: { ...r, given: (r.given || 0) + 1 } }); break; }
          case "removeBoy": {
            boy(b.boyId);
            await redis.hdel("boys", b.boyId);
            await redis.hdel("pts", b.boyId);
            const mine = Object.keys(s.leins).filter(k => s.leins[k].boyId === b.boyId);
            if (mine.length) await redis.hdel("leins", ...mine);
            break;
          }
          case "resetAll": { await redis.del("pts"); break; }
          default: no("Unknown action.");
        }
      }
    }
    out.state = await getState();
    res.status(200).json(out);
  } catch (e) {
    if (e instanceof Oops) return res.status(400).json({ error: e.message });
    res.status(500).json({ error: "Couldn't save. Try again soon." });
  }
}
