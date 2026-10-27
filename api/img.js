import { redis } from "../lib/shared.js";

// Serves a post's picture: /api/img?id=POST_ID
export default async function handler(req, res) {
  const id = String(req.query.id || "");
  if (!/^[a-z0-9]{1,40}$/.test(id)) return res.status(400).end();
  try {
    const d = await redis.hget("img", id);
    const m = typeof d === "string" && d.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) return res.status(404).end();
    res.setHeader("Content-Type", m[1]);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.status(200).send(Buffer.from(m[2], "base64"));
  } catch (e) {
    res.status(500).end();
  }
}
