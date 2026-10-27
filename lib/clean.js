// Keeps only safe formatting from pasted Google Docs content (no scripts, links or styles).
const ALLOWED = new Set(["p", "br", "b", "i", "u", "h3", "h4", "ul", "ol", "li", "img"]);
const IMG_OK = /^(https:\/\/[a-z0-9.-]*(googleusercontent\.com|ggpht\.com)\/[^"'<>\s]+|\/api\/img\?id=[a-z0-9]+|data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$/i;
const esc = t => t.replace(/&(?!(#\d+|#x[0-9a-f]+|[a-z]+);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function cleanHtml(html) {
  html = String(html || "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  return html.split(/(<[^>]*>)/).map(part => {
    if (!part.startsWith("<")) return esc(part);
    const m = part.match(/^<\s*(\/?)\s*([a-z0-9]+)/i);
    if (!m) return "";
    const close = m[1], tag = m[2].toLowerCase();
    if (!ALLOWED.has(tag)) return "";
    if (tag === "img") {
      if (close) return "";
      const src = (part.match(/\ssrc\s*=\s*"([^"]*)"/i) || part.match(/\ssrc\s*=\s*'([^']*)'/i) || [])[1] || "";
      const s = src.replace(/&amp;/g, "&");
      return IMG_OK.test(s) ? `<img src="${s.replace(/&/g, "&amp;")}" alt="">` : "";
    }
    if (tag === "br") return close ? "" : "<br>";
    return `<${close}${tag}>`;
  }).join("").trim();
}

export const imgSrcs = html => [...html.matchAll(/<img src="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, "&"));
