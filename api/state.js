import { getState, publicState, sessionUser, isAdmin } from "../lib/shared.js";

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");
    const s = await getState();
    const me = await sessionUser(req.headers["x-token"], s.boys);
    res.status(200).json(publicState(s, me, isAdmin(req.headers["x-code"])));
  } catch (e) {
    res.status(500).json({ error: "Couldn't load the points. Try again soon." });
  }
}
