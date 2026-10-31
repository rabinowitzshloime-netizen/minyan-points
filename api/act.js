import { redis, getState, isAdmin, weekKey, RULES, PARTS, WEEK_MAX, BONUS, PRIZE_AT, publicState, sessionUser, newSession, hashPw, checkPw, cleanUser, USER_OK, upcomingDates, todayYmd } from "../lib/shared.js";
import { cleanHtml, imgSrcs, cutHtml } from "../lib/clean.js";
import { vapid, subKey, pushAll, smsAll, cleanPhone, smsReady } from "../lib/notify.js";

const ADMIN_USER = cleanUser(process.env.ADMIN_USER || "admin");
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
    let me = await sessionUser(b.token, s.boys);
    const mustLogIn = () => me || no("Please log in again.");
    const checkNew = async () => {
      const username = cleanUser(b.username), password = String(b.password || "");
      if (!USER_OK.test(username)) no("Usernames need 3 to 20 letters or numbers, no spaces.");
      if (username === ADMIN_USER) no("Someone already has that username. Try another one.");
      if (password.length < 4) no("Make your password at least 4 characters.");
      if (password.length > 64) no("That password is too long.");
      return { username, password };
    };
    const takeName = async (username, bid) => {
      const ok = await redis.hsetnx("unames", username, bid);
      if (!ok) no("Someone already has that username. Try another one.");
    };

    switch (b.action) {
      /* ----- anyone ----- */
      case "signup": {
        const name = String(b.name || "").trim().slice(0, 30);
        if (!name) no("Type your name first.");
        if (Object.keys(s.boys).length >= 300) no("The list is full. Ask the admin.");
        const { username, password } = await checkNew();
        const bid = id();
        await takeName(username, bid);
        const rec = { name, username, pw: hashPw(password), ver: 0 };
        await redis.hset("boys", { [bid]: rec });
        s.boys[bid] = rec;
        out.token = await newSession(bid, rec); me = bid;
        break;
      }
      case "claim": {
        const old = boy(b.boyId);
        if (old.pw) no("That name already has a login. Ask the admin if it's yours.");
        const { username, password } = await checkNew();
        await takeName(username, b.boyId);
        const rec = { ...old, username, pw: hashPw(password), ver: (old.ver || 0) + 1 };
        await redis.hset("boys", { [b.boyId]: rec });
        s.boys[b.boyId] = rec;
        out.token = await newSession(b.boyId, rec); me = b.boyId;
        break;
      }
      case "login": {
        const username = cleanUser(b.username);
        const failKey = "fail:" + username;
        const fails = Number(await redis.get(failKey)) || 0;
        if (fails >= 10) no("Too many wrong tries. Wait 15 minutes, or ask the admin.");
        if (username === ADMIN_USER) {
          if (!isAdmin(String(b.password || ""))) { await redis.incr(failKey); await redis.expire(failKey, 900); no("Wrong username or password."); }
          await redis.del(failKey);
          out.admin = true; b.code = String(b.password); me = null;
          break;
        }
        const bid = await redis.hget("unames", username);
        const rec = bid && s.boys[bid];
        if (!rec || !checkPw(b.password || "", rec.pw)) {
          await redis.incr(failKey); await redis.expire(failKey, 900);
          no("Wrong username or password.");
        }
        await redis.del(failKey);
        out.token = await newSession(bid, rec); me = bid;
        break;
      }
      case "logout": {
        if (typeof b.token === "string" && /^[a-f0-9]{64}$/.test(b.token)) await redis.del("s:" + b.token);
        me = null;
        break;
      }
      case "signLein": {
        b.boyId = mustLogIn();
        if (!PARTS.includes(b.part)) no("Pick a part.");
        const parsha = String(b.parsha || "").slice(0, 40);
        // which Shabbos it's for, so next year's reading of the same parsha is free again
        const dates = upcomingDates() || [];
        const date = dates.includes(b.date) ? b.date : "";
        const taken = Object.values(s.leins).some(l => l.parsha === parsha && l.part === b.part && (!l.date || !date || l.date === date));
        if (taken) no("Someone already took that part.");
        await redis.hset("leins", { [id()]: { boyId: b.boyId, parsha, part: b.part, date, awarded: false } });
        // tidy up bookings from more than 2 months ago
        const cutoff = new Date(todayYmd()); cutoff.setDate(cutoff.getDate() - 60);
        const old = Object.keys(s.leins).filter(k => s.leins[k].date && new Date(s.leins[k].date) < cutoff);
        if (old.length) await redis.hdel("leins", ...old);
        break;
      }
      case "dropLein": {
        b.boyId = mustLogIn();
        const l = s.leins[b.leinId];
        if (!l || l.boyId !== b.boyId || l.awarded) no("You can't remove that one.");
        await redis.hdel("leins", b.leinId);
        break;
      }
      case "vote": {
        b.boyId = mustLogIn();
        const p = s.posts[b.postId] || no("That vote isn't there anymore.");
        const n = Number(b.choice);
        if (!Number.isInteger(n) || n < 0 || n >= (p.options || []).length) no("Pick an answer.");
        await redis.hset("v:" + b.postId, { [b.boyId]: n });
        break;
      }
      /* ----- notifications ----- */
      case "pushKey": { out.key = (await vapid()).publicKey; break; }
      case "pushSub": {
        mustLogIn();
        const sub = b.sub || {};
        if (typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) no("Couldn't turn on notifications.");
        const clean = { endpoint: sub.endpoint.slice(0, 1000), keys: { p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) } };
        await redis.hset("push", { [subKey(clean.endpoint)]: { sub: clean, boyId: me } });
        break;
      }
      case "pushUnsub": {
        if (typeof b.endpoint === "string") await redis.hdel("push", subKey(b.endpoint));
        break;
      }
      case "setPhone": {
        mustLogIn();
        if (!b.phone) { await redis.hdel("phone", me); break; }
        const n = cleanPhone(b.phone);
        if (!n) no("That doesn't look like a phone number. Try like 07700 900123.");
        await redis.hset("phone", { [me]: n });
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
        // a boy just reached a gift card: tell only him
        const prizeCheck = async (bid, before, after) => {
          if (Math.floor(after / PRIZE_AT) <= Math.floor(before / PRIZE_AT)) return;
          const site = "https://" + (req.headers["x-forwarded-host"] || req.headers.host || "lubavitch-boys-minyan.vercel.app");
          try {
            await pushAll({ title: "🎁 You won a £10 Amazon gift card!", body: `Mazel tov ${s.boys[bid].name}! You got ${after} points. Ask the admin for your gift card.`, url: "/", tag: "prize-" + bid }, bid);
            await smsAll(`Mazel tov ${s.boys[bid].name}! You got ${after} points on Minyan Points and won a £10 Amazon gift card. Ask the admin for it. ${site}`, bid);
          } catch (e) {}
        };
        const give = async (bid, key) => {
          boy(bid);
          const r = rec(bid), done = r.week === wk ? (r.done || []) : [];
          if (done.includes(key)) no(`${s.boys[bid].name} already got this point for Shabbos.`);
          if (done.length >= WEEK_MAX) no(`${s.boys[bid].name} already has ${WEEK_MAX} points for Shabbos.`);
          await redis.hset("pts", { [bid]: { ...r, points: (r.points || 0) + 1, week: wk, done: [...done, key] } });
          await prizeCheck(bid, r.points || 0, (r.points || 0) + 1);
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
          case "bonus": { boy(b.boyId); const r = rec(b.boyId); await redis.hset("pts", { [b.boyId]: { ...r, points: (r.points || 0) + BONUS } }); await prizeCheck(b.boyId, r.points || 0, (r.points || 0) + BONUS); break; }
          case "minus": {
            boy(b.boyId); const r = rec(b.boyId);
            if (!r.points) no("They have 0 points.");
            // also undo the last thing ticked this Shabbos, so the right one can be given instead
            const done = r.week === wk ? [...(r.done || [])] : [];
            const undone = done.pop();
            await redis.hset("pts", { [b.boyId]: { ...r, points: r.points - 1, ...(undone ? { done } : {}) } });
            out.undone = undone || null;
            // taking back a leining point puts that leining back on the "waiting for points" list
            if (undone === "lein") {
              const lk = Object.keys(s.leins).filter(k => s.leins[k].boyId === b.boyId && s.leins[k].awarded)
                .sort((x, y) => (s.leins[y].date || "").localeCompare(s.leins[x].date || ""))[0];
              if (lk) await redis.hset("leins", { [lk]: { ...s.leins[lk], awarded: false } });
            }
            break;
          }
          case "markGiven": { boy(b.boyId); const r = rec(b.boyId); await redis.hset("pts", { [b.boyId]: { ...r, given: (r.given || 0) + 1 } }); break; }
          case "resetLogin": {
            const old = boy(b.boyId);
            if (old.username) await redis.hdel("unames", old.username);
            await redis.hset("boys", { [b.boyId]: { name: old.name, ver: (old.ver || 0) + 1 } });
            break;
          }
          case "removeBoy": {
            const old = boy(b.boyId);
            await redis.hdel("phone", b.boyId);
            const subs = (await redis.hgetall("push")) || {};
            const hisSubs = Object.keys(subs).filter(k => subs[k].boyId === b.boyId);
            if (hisSubs.length) await redis.hdel("push", ...hisSubs);
            if (old.username) await redis.hdel("unames", old.username);
            await redis.hdel("boys", b.boyId);
            await redis.hdel("pts", b.boyId);
            const mine = Object.keys(s.leins).filter(k => s.leins[k].boyId === b.boyId);
            if (mine.length) await redis.hdel("leins", ...mine);
            break;
          }
          case "resetAll": { await redis.del("pts"); break; }
          case "addPost": {
            const kinds = ["trip", "event", "news", "important"];
            const kind = kinds.includes(b.kind) ? b.kind : "news";
            const title = String(b.title || "").trim().slice(0, 80);
            const body = String(b.body || "").trim().slice(0, 3000);
            const link = "";
            const options = (Array.isArray(b.options) ? b.options : []).map(o => String(o || "").trim().slice(0, 60)).filter(Boolean).slice(0, 8);
            if (options.length === 1) no("A vote needs at least 2 answers.");
            let html = cutHtml(cleanHtml(cutHtml(b.html, 80000)), 40000);
            const inline = (Array.isArray(b.inline) ? b.inline : []).slice(0, 10);
            const okPic = d => typeof d === "string" && d.length < 900000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(d);
            const img = typeof b.image === "string" ? b.image : "";
            if (img && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img) || img.length > 900000)) no("That picture is too big or not a picture. Try a smaller one.");
            const when = /^\d{4}-\d{2}-\d{2}$/.test(b.when || "") ? b.when : "";
            if (!title) no("Give the post a title.");
            if (Object.keys(s.posts).length >= 100) no("Too many posts. Delete some old ones first.");
            const pid = id();
            if (img) await redis.hset("img", { [pid]: img });
            // copy pictures from the pasted Google Doc so they keep working
            let n = 0;
            for (const src of imgSrcs(html).slice(0, 10)) {
              const key = pid + "x" + (n++);
              let local = "";
              try {
                if (src.startsWith("inline:")) { const d = inline[Number(src.slice(7))]; if (okPic(d)) local = d; }
                else if (src.startsWith("https://")) {
                  const r = await fetch(src);
                  const type = (r.headers.get("content-type") || "").split(";")[0];
                  const buf = Buffer.from(await r.arrayBuffer());
                  if (r.ok && /^image\/(png|jpeg|webp)$/.test(type) && buf.length < 650000) local = `data:${type};base64,${buf.toString("base64")}`;
                }
              } catch (e) {}
              const safe = src.replace(/&/g, "&amp;");
              if (local) { await redis.hset("img", { [key]: local }); html = html.split(`src="${safe}"`).join(`src="/api/img?id=${key}"`); }
              else html = html.split(`<img src="${safe}" alt="">`).join("");
            }
            await redis.hset("posts", { [pid]: { kind, title, body: html ? "" : body, html, when, link, options, hasImg: !!img, imgs: n, at: Date.now() } });
            // tell the boys
            const KIND = { trip: "🚌 Trip", event: "🎉 Event", news: "📢 News", important: "⚠️ Important" }[kind];
            const whenTxt = when ? new Date(when + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "";
            const site = "https://" + (req.headers["x-forwarded-host"] || req.headers.host || "lubavitch-boys-minyan.vercel.app");
            out.sent = { app: 0, sms: 0, smsReady: smsReady() };
            if (b.notify !== false) out.sent.app = await pushAll({ title: `${KIND}: ${title}`, body: (whenTxt ? whenTxt + " · " : "") + (options.length > 1 ? "Vote now in the app 🗳️" : "Tap to read it"), url: "/#news", tag: pid });
            if (b.sms !== false) {
              const text = `Minyan Points ${KIND}: ${title}${whenTxt ? " (" + whenTxt + ")" : ""}. ${options.length > 1 ? "Vote" : "Read more"}: ${site}`.slice(0, 300);
              out.sent.sms = await smsAll(text);
            }
            break;
          }
          case "deletePost": {
            if (!s.posts[b.postId]) no("That post isn't there anymore.");
            const old = s.posts[b.postId];
            await redis.hdel("posts", b.postId);
            await redis.hdel("img", b.postId, ...Array.from({ length: old.imgs || 0 }, (_, i) => b.postId + "x" + i));
            await redis.del("v:" + b.postId);
            break;
          }
          default: no("Unknown action.");
        }
      }
    }
    out.state = publicState(await getState(), me, isAdmin(b.code));
    res.status(200).json(out);
  } catch (e) {
    if (e instanceof Oops) return res.status(400).json({ error: e.message });
    res.status(500).json({ error: "Couldn't save. Try again soon." });
  }
}
