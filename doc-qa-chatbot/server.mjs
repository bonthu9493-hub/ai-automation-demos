// Document Q&A chatbot — zero dependencies in free mode.
// Free mode: finds the most relevant passages in your documents (keyword search, runs offline).
// AI mode (optional, paid per use): set ANTHROPIC_API_KEY and `npm install @anthropic-ai/sdk`.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

// ---------- documents & search ----------
const STOP = new Set("a an the and or of to in on for is are was were be by with at as it this that from what how do does can i you your we our".split(" "));
const tokenize = (s) => s.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => !STOP.has(w)) ?? [];

let chunks = []; // { source, text, terms }

function addDocument(source, text) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let buf = "";
  const flush = () => { if (buf) chunks.push({ source, text: buf, terms: tokenize(buf) }); buf = ""; };
  for (const p of paras) {
    if ((buf + "\n\n" + p).length > 700) flush();
    buf = buf ? buf + "\n\n" + p : p;
  }
  flush();
}

function loadDocsFolder() {
  const dir = path.join(here, "docs");
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (/\.(txt|md)$/i.test(f)) addDocument(f, fs.readFileSync(path.join(dir, f), "utf8"));
  }
}

// BM25 ranking
function search(query, k = 3) {
  const q = tokenize(query);
  if (!q.length || !chunks.length) return [];
  const N = chunks.length;
  const avgLen = chunks.reduce((s, c) => s + c.terms.length, 0) / N;
  const df = new Map();
  for (const t of new Set(q)) df.set(t, chunks.filter((c) => c.terms.includes(t)).length);
  return chunks
    .map((c) => {
      let score = 0;
      for (const t of q) {
        const tf = c.terms.filter((x) => x === t).length;
        if (!tf) continue;
        const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
        score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * c.terms.length / avgLen));
      }
      return { ...c, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// Free-mode answer: the sentences from the top passages that best match the question.
function extractiveAnswer(question, hits) {
  const q = new Set(tokenize(question));
  const sentences = hits
    .flatMap((h) => h.text.split(/(?<=[.!?])\s+|\n+/))
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
  const scored = sentences.map((s) => ({ s, n: tokenize(s).filter((w) => q.has(w)).length }));
  const best = Math.max(0, ...scored.map((x) => x.n));
  return scored
    .filter((x) => x.n > 0 && x.n >= best * 0.6)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((x) => x.s)
    .join(" ");
}

// ---------- optional AI mode ----------
let client = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    client = new Anthropic();
  } catch {
    console.warn("ANTHROPIC_API_KEY is set but @anthropic-ai/sdk is not installed. Run: npm install @anthropic-ai/sdk");
  }
}

async function aiAnswer(question, hits) {
  const context = hits.map((h, i) => `<passage index="${i + 1}" source="${h.source}">\n${h.text}\n</passage>`).join("\n");
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: "low" },
    system: "Answer the user's question using only the passages provided. If the passages don't contain the answer, say you don't know. Keep answers short and cite passage numbers like [1].",
    messages: [{ role: "user", content: `${context}\n\nQuestion: ${question}` }],
  });
  if (response.stop_reason === "refusal") return "Sorry, I can't help with that question.";
  return response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

// ---------- HTTP ----------
const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "Content-Type": type });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
};

const readBody = (req) => new Promise((resolve, reject) => {
  let data = "";
  req.on("data", (c) => { data += c; if (data.length > 2_000_000) req.destroy(); });
  req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch (e) { reject(e); } });
  req.on("error", reject);
});

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      return send(res, 200, fs.readFileSync(path.join(here, "public", "index.html"), "utf8"), "text/html; charset=utf-8");
    }
    if (req.method === "GET" && req.url === "/api/status") {
      return send(res, 200, { aiEnabled: !!client, model: client ? MODEL : null, sources: [...new Set(chunks.map((c) => c.source))], chunks: chunks.length });
    }
    if (req.method === "POST" && req.url === "/api/docs") {
      const { name, text } = await readBody(req);
      if (!text?.trim()) return send(res, 400, { error: "No text provided" });
      addDocument(name?.trim() || `pasted-${Date.now()}`, text);
      return send(res, 200, { ok: true, chunks: chunks.length });
    }
    if (req.method === "POST" && req.url === "/api/ask") {
      const { question } = await readBody(req);
      if (!question?.trim()) return send(res, 400, { error: "Ask a question" });
      const hits = search(question);
      if (!hits.length) return send(res, 200, { answer: "I couldn't find anything about that in the documents.", sources: [] });
      const answer = client ? await aiAnswer(question, hits) : extractiveAnswer(question, hits);
      return send(res, 200, { answer, mode: client ? "ai" : "free", sources: hits.map((h) => ({ source: h.source, excerpt: h.text.slice(0, 240) })) });
    }
    send(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: err.message });
  }
});

loadDocsFolder();
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") console.error(`Port ${PORT} is busy. Try another, e.g. in PowerShell: $env:PORT = '${PORT + 1}'; node server.mjs`);
  else console.error(err);
  process.exit(1);
});
server.listen(PORT, () => {
  console.log(`Doc Q&A chatbot on http://localhost:${PORT}  (${client ? `AI mode: ${MODEL}` : "free mode"}, ${chunks.length} passages loaded)`);
});
