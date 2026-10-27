import { getState } from "../lib/shared.js";

export default async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(await getState());
  } catch (e) {
    res.status(500).json({ error: "Couldn't load the points. Try again soon." });
  }
}
