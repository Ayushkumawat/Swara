import "server-only";
import { GoogleGenAI, Type } from "@google/genai";
import { getDb } from "./db";

/**
 * The non-live AI: post-call analysis and knowledge embeddings.
 *
 * Both run on cheap text models, entirely separate from the live voice socket.
 * Both also have deterministic fallbacks, because the post-call pipeline must
 * never lose a complaint — a call that fails to classify still lands in a
 * department queue via keywords, just possibly the wrong one, and a wrongly
 * routed complaint is recoverable in a way a dropped one is not.
 */

/** Primary and backup, tried in order. The `-latest` alias returns 503 under
 *  load spikes often enough that a second, pinned model is worth one more
 *  attempt before the keyword fallback takes over. */
const TEXT_MODELS = [
  process.env.GEMINI_TEXT_MODEL ?? "gemini-flash-latest",
  "gemini-3.6-flash",
];
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-001";

function client(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  return apiKey ? new GoogleGenAI({ apiKey }) : null;
}

export type CallAnalysis = {
  summary: string;
  intent: string;
  sentiment: "positive" | "neutral" | "declining" | "frustrated";
  outcome: "resolved" | "escalated" | "dropped";
  qaScore: number;
  departmentSlug: string | null;
  customerName: string | null;
  /** Work the call produced, in the department's terms, not the caller's. */
  actionItems: { title: string; detail: string; severity: "low" | "medium" | "high" | "critical" }[];
};

/**
 * Turns a transcript into the things the rest of the system runs on: a
 * two-line summary, an outcome, a QA score, and — the part the product is
 * really selling — which department owns the follow-up and what exactly they
 * should do. "AC not working in coach 3" must reach maintenance, not a general
 * inbox, without a human reading the transcript first.
 */
export async function analyzeCall(
  transcript: { role: string; text: string }[],
  departments: { slug: string; name: string; keywords: string[] }[],
  intents: string[],
): Promise<CallAnalysis | null> {
  const ai = client();
  const text = transcript
    .map((t) => `${t.role === "caller" ? "CALLER" : "AGENT"}: ${t.text}`)
    .join("\n");
  if (!text.trim()) return null;

  for (const model of ai ? TEXT_MODELS : []) {
    try {
      const deptList = departments.map((d) => `${d.slug} (${d.name})`).join(", ");
      const response = await ai!.models.generateContent({
        model,
        contents: [
          "You are scoring a completed customer-service phone call for an Indian business.",
          "The transcript may mix Hindi, English and Hinglish; write your summary in English.",
          "",
          `Departments that can own follow-up work: ${deptList}.`,
          "Pick department_slug only when the call actually produced work for one of them; otherwise null.",
          "Action items must be written for the department doing the work — location, what to check, by when — not a restatement of the caller's feelings.",
          "qa_score is 0-100: penalise the AGENT for inventing facts, ignoring the caller, or failing to confirm numbers; do not penalise the caller's mood.",
          "",
          "TRANSCRIPT:",
          text,
        ].join("\n"),
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              intent: { type: Type.STRING, enum: intents },
              sentiment: { type: Type.STRING, enum: ["positive", "neutral", "declining", "frustrated"] },
              outcome: { type: Type.STRING, enum: ["resolved", "escalated", "dropped"] },
              qa_score: { type: Type.NUMBER },
              department_slug: { type: Type.STRING, nullable: true },
              customer_name: { type: Type.STRING, nullable: true },
              action_items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    detail: { type: Type.STRING },
                    severity: { type: Type.STRING, enum: ["low", "medium", "high", "critical"] },
                  },
                  required: ["title", "detail", "severity"],
                },
              },
            },
            required: ["summary", "intent", "sentiment", "outcome", "qa_score", "action_items"],
          },
        },
      });

      const parsed = JSON.parse(response.text ?? "{}");
      const validSlugs = new Set(departments.map((d) => d.slug));
      return {
        summary: parsed.summary ?? "",
        intent: parsed.intent ?? "other",
        sentiment: parsed.sentiment ?? "neutral",
        outcome: parsed.outcome ?? "resolved",
        qaScore: Math.max(0, Math.min(100, Math.round(parsed.qa_score ?? 70))),
        departmentSlug: validSlugs.has(parsed.department_slug) ? parsed.department_slug : null,
        customerName: parsed.customer_name ?? null,
        actionItems: (parsed.action_items ?? []).slice(0, 5),
      };
    } catch (error) {
      console.error(`[ai] analysis on ${model} failed:`, String(error).slice(0, 300));
    }
  }

  // Keyword fallback: crude but never silent.
  const lower = text.toLowerCase();
  const dept = departments.find((d) => d.keywords.some((k) => lower.includes(k)));
  return {
    summary: transcript.slice(-4).map((t) => t.text).join(" ").slice(0, 200),
    intent: "other",
    sentiment: /frustrat|angry|worst|complaint/.test(lower) ? "frustrated" : "neutral",
    outcome: "resolved",
    qaScore: 70,
    departmentSlug: dept?.slug ?? null,
    customerName: null,
    actionItems: dept
      ? [{ title: "Review call follow-up", detail: "Auto-routed by keyword match; verify.", severity: "medium" }]
      : [],
  };
}

/** Department for a complaint registered mid-call, when there is no full
 *  transcript yet. Keywords first, `support` as the catch-all. */
export function classifyDepartment(
  orgId: string,
  textToClassify: string,
): { id: string; slug: string; name: string } {
  const rows = getDb()
    .prepare("SELECT id, slug, name, keywords FROM departments WHERE org_id=?")
    .all(orgId) as { id: string; slug: string; name: string; keywords: string }[];
  const lower = textToClassify.toLowerCase();

  let best: { row: (typeof rows)[0]; hits: number } | null = null;
  for (const row of rows) {
    const hits = (JSON.parse(row.keywords) as string[]).filter((k) => lower.includes(k)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { row, hits };
  }
  const chosen = best?.row ?? rows.find((r) => r.slug === "support") ?? rows[0];
  return { id: chosen.id, slug: chosen.slug, name: chosen.name };
}

/* ── embeddings ─────────────────────────────────────────────────────────── */

export async function embed(texts: string[]): Promise<Float32Array[] | null> {
  const ai = client();
  if (!ai) return null;
  try {
    const response = await ai.models.embedContent({
      model: EMBED_MODEL,
      contents: texts,
    });
    return (response.embeddings ?? []).map((e) => Float32Array.from(e.values ?? []));
  } catch (error) {
    console.error("[ai] embedding failed:", error);
    return null;
  }
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Ingests a document into the knowledge base: chunk, embed, store. Embedding
 * failure downgrades to keyword-searchable chunks rather than rejecting the
 * upload — the tenant's FAQ being findable by term match today beats being
 * findable by similarity never.
 */
export async function ingestKnowledgeDoc(
  orgId: string,
  name: string,
  kind: "pdf" | "url" | "csv" | "text",
  text: string,
): Promise<{ id: string; chunks: number }> {
  const db = getDb();
  const { uid, nowIso } = await import("./db");

  // Paragraph-aligned chunks around ~1200 chars. Splitting mid-sentence makes
  // both the embedding and whatever the agent reads aloud worse.
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + p.length > 1200) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) chunks.push(current);

  const vectors = await embed(chunks);

  const docId = uid("doc");
  const sizeKb = Math.max(1, Math.round(Buffer.byteLength(text, "utf8") / 1024));
  db.prepare(
    "INSERT INTO knowledge_docs (id, org_id, name, kind, size_label, status, updated_at) VALUES (?, ?, ?, ?, ?, 'indexed', ?)",
  ).run(docId, orgId, name, kind, `${sizeKb} KB`, nowIso());

  const insert = db.prepare(
    "INSERT INTO knowledge_chunks (doc_id, seq, content, embedding) VALUES (?, ?, ?, ?)",
  );
  chunks.forEach((content, i) => {
    const vector = vectors?.[i];
    insert.run(docId, i, content, vector ? Buffer.from(vector.buffer) : null);
  });

  return { id: docId, chunks: chunks.length };
}

/**
 * Knowledge search backing the agent's `search_knowledge` tool. Embedding
 * similarity when vectors exist, term overlap otherwise — an agent that says
 * "I can't find that" beats one whose tool errors mid-call.
 */
export async function searchKnowledge(orgId: string, query: string, limit = 4) {
  const db = getDb();
  const chunks = db
    .prepare(
      `SELECT c.id, c.content, c.embedding, k.name doc FROM knowledge_chunks c
       JOIN knowledge_docs k ON k.id=c.doc_id WHERE k.org_id=?`,
    )
    .all(orgId) as { id: number; content: string; embedding: Buffer | null; doc: string }[];
  if (chunks.length === 0) return [];

  const withVectors = chunks.filter((c) => c.embedding);
  if (withVectors.length > 0) {
    const [queryVector] = (await embed([query])) ?? [];
    if (queryVector) {
      return withVectors
        .map((c) => ({
          doc: c.doc,
          content: c.content,
          score: cosine(queryVector, new Float32Array(c.embedding!.buffer, c.embedding!.byteOffset, c.embedding!.byteLength / 4)),
        }))
        .sort((x, y) => y.score - x.score)
        .slice(0, limit);
    }
  }

  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  return chunks
    .map((c) => ({
      doc: c.doc,
      content: c.content,
      score: terms.filter((t) => c.content.toLowerCase().includes(t)).length,
    }))
    .filter((c) => c.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}
