import { useState, useCallback, useEffect } from "react";
import supabase from "./supabase";
import RatingView from "./RatingView";
import BatchRatingView from "./BatchRatingView";

// ─── Model catalogue (via OpenRouter) ─────────────────────────────────
const MODELS = [
  { id:"anthropic/claude-sonnet-4-5",   label:"Claude Sonnet 4.5",   provider:"anthropic" },
  { id:"anthropic/claude-sonnet-4-6",   label:"Claude Sonnet 4.6",   provider:"anthropic" },
  { id:"anthropic/claude-opus-4-6",     label:"Claude Opus 4.6",     provider:"anthropic" },
  { id:"anthropic/claude-haiku-4-5",    label:"Claude Haiku 4.5",    provider:"anthropic" },
  { id:"openai/gpt-5.4",                label:"GPT-5.4",             provider:"openai"    },
  { id:"openai/gpt-4.1",                label:"GPT-4.1",             provider:"openai"    },
  { id:"openai/gpt-4.1-mini",           label:"GPT-4.1 Mini",        provider:"openai"    },
  { id:"openai/gpt-4.1-nano",           label:"GPT-4.1 Nano",        provider:"openai"    },
  { id:"openai/gpt-4o",                 label:"GPT-4o",              provider:"openai"    },
  { id:"openai/gpt-4o-mini",            label:"GPT-4o Mini",         provider:"openai"    },
  { id:"openai/o3",                     label:"o3",                  provider:"openai"    },
  { id:"openai/o4-mini",                label:"o4 Mini",             provider:"openai"    },
  { id:"google/gemini-3.1-pro-preview",   label:"Gemini 3.1 Pro",      provider:"google"    },
  { id:"google/gemini-3.0-flash",       label:"Gemini Flash 3",      provider:"google"    },
  { id:"google/gemini-3.0-flash-lite",  label:"Gemini Flash 3 Lite", provider:"google"    },
  { id:"google/gemini-2.5-pro",         label:"Gemini 2.5 Pro",      provider:"google"    },
  { id:"google/gemini-2.5-flash",       label:"Gemini 2.5 Flash",    provider:"google"    },
  { id:"google/gemini-2.0-flash-001",   label:"Gemini 2.0 Flash",    provider:"google"    },
  { id:"google/gemini-2.0-flash-lite",  label:"Gemini 2.0 Flash Lite",provider:"google"   },
];

const PROVIDER_COLORS = { anthropic:"#e07b39", openai:"#74aa9c", google:"#4285f4" };

function provColor(modelId) {
  const p = MODELS.find(m => m.id === modelId)?.provider;
  return PROVIDER_COLORS[p] || "#5a7390";
}

// ─── LLM caller (via OpenRouter) ──────────────────────────────────────
async function callLLM(modelId, system, user, label = "", maxTokens = 600) {
  if (!MODELS.find(m => m.id === modelId)) throw new Error(`${label}: unknown model ${modelId}`);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 55000);

  const body = {
    model: modelId,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user   },
    ],
  };

  let res;
  try {
    res = await fetch("/api/openrouter", { method:"POST", signal:ctrl.signal, headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
  } catch(e) {
    clearTimeout(t);
    if (e.name === "AbortError") throw new Error(`${label}: timed out`);
    throw new Error(`${label}: network error — ${e.message}`);
  }
  clearTimeout(t);

  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`${label}: bad JSON (HTTP ${res.status})`); }
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} — ${data?.error?.message || "unknown"}`);

  if (!data.choices?.[0]?.message?.content) throw new Error(`${label}: empty response`);
  return data.choices[0].message.content;
}

// ─── Helpers ───────────────────────────────────────────────────────────
function cap(s, n = 3000) { return s?.length > n ? s.slice(0, n) + "\n...[trimmed]" : s || ""; }



function totalScore(v) { return CRITERIA.reduce((s, c) => s + (v?.[c.key]?.score || 0), 0); }

function avgHumanScores(ratings, v1IsVA) {
  if (!ratings?.length) return null;
  const vaKey = v1IsVA ? "v1" : "v2";
  const vbKey = v1IsVA ? "v2" : "v1";
  const avg = (key) => Object.fromEntries(
    CRITERIA.map(c => {
      const sum = ratings.reduce((s, r) => s + (r.scores?.[key]?.[c.key]?.score || 0), 0);
      return [c.key, Math.round((sum / ratings.length) * 10) / 10];
    })
  );
  const vA = avg(vaKey), vB = avg(vbKey);
  return {
    vA, vB,
    totA: Math.round(CRITERIA.reduce((s, c) => s + vA[c.key], 0) * 10) / 10,
    totB: Math.round(CRITERIA.reduce((s, c) => s + vB[c.key], 0) * 10) / 10,
  };
}

// ─── Persistence ───────────────────────────────────────────────────────
const HISTORY_KEY = "evallab_history";
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}
function saveToHistory(entry) {
  const updated = [entry, ...loadHistory()].slice(0, 50);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
}
function updateInHistory(id, patch) {
  const updated = loadHistory().map(e => e.id === id ? { ...e, ...patch } : e);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  return updated;
}

// ─── Constants ─────────────────────────────────────────────────────────
const EXAMS = ["UKMLA","NEET PG","INI-CET","USMLE Step 1","USMLE Step 2CK","FMGE"];

const CRITERIA = [
  { key:"accuracy",  label:"Accuracy",   color:"#5aabf0", desc:"Clinical & factual correctness — no errors, outdated info, or misleading claims" },
  { key:"clarity",   label:"Clarity",    color:"#a78bfa", desc:"Teaching effectiveness — structure, explanation quality & logical flow of concepts" },
  { key:"retention", label:"Retention",  color:"#f0b34a", desc:"Memorability — hooks, patterns & anchors that aid recall under exam pressure" },
  { key:"examYield", label:"Exam-Yield", color:"#00c896", desc:"High-yield focus — prioritises what the target exam actually tests, right depth & format" },
];

const C = {
  bg:"#07090d", surface:"#0d1117", s2:"#111820",
  b:"#1e2d40", bh:"#2a3f58",
  accent:"#00c896", abg:"rgba(0,200,150,0.08)",
  text:"#e8f2ff", muted:"#7fa8cc", dim:"#3d5470",
  blue:"#6ab8f7", warn:"#f5c066", purple:"#b89cfb", red:"#fc8585",
};

const STEPS = [
  { key:"genA",        label:"Step 1 · Generate",              color:C.blue   },
  { key:"validate",    label:"Step 2 · Validator revision",    color:C.warn   },
  { key:"adversarial", label:"Step 3 · Adversarial revision",  color:C.purple },
  { key:"eval",        label:"Step 4 · Score both versions",   color:C.purple },
];

// ─── ModelSelect ───────────────────────────────────────────────────────
function ModelSelect({ label, value, onChange, disabled }) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      <div style={{display:"flex",alignItems:"center",gap:5}}>
        <div style={{width:7,height:7,borderRadius:"50%",background:provColor(value),flexShrink:0}}/>
        <span style={{fontSize:11,color:C.muted,fontFamily:"monospace",textTransform:"uppercase",letterSpacing:"0.5px"}}>{label}</span>
      </div>
      <select value={value} onChange={e=>onChange(e.target.value)} disabled={disabled} style={{
        padding:"6px 10px",borderRadius:6,border:`1px solid ${C.b}`,background:C.bg,
        color:C.text,fontSize:13,cursor:disabled?"not-allowed":"pointer",fontFamily:"'Sora',sans-serif",
      }}>
        <optgroup label="Anthropic">{MODELS.filter(m=>m.provider==="anthropic").map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>
        <optgroup label="OpenAI">{MODELS.filter(m=>m.provider==="openai").map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>
        <optgroup label="Google">{MODELS.filter(m=>m.provider==="google").map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>
      </select>
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────
export default function App() {

  // ── Hash routing: delegate to RatingView (#rate/) or BatchRatingView (#batch/) ──
  const [ratingEvalId, setRatingEvalId] = useState(() => {
    const h = window.location.hash;
    return h.startsWith("#rate/") ? h.slice(6) : null;
  });
  const [batchEvalIds, setBatchEvalIds] = useState(() => {
    const h = window.location.hash;
    return h.startsWith("#batch/") ? h.slice(7).split(",") : null;
  });
  useEffect(() => {
    const handler = () => {
      const h = window.location.hash;
      setRatingEvalId(h.startsWith("#rate/") ? h.slice(6) : null);
      setBatchEvalIds(h.startsWith("#batch/") ? h.slice(7).split(",") : null);
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  // ── State ─────────────────────────────────────────────────────────
  const [topic, setTopic]   = useState("");
  const [ct, setCt]         = useState("Lesson");
  const [exam, setExam]     = useState("UKMLA");

  const [modelA,    setModelA]    = useState("openai/gpt-5.4");
  const [modelGenB, setModelGenB] = useState("openai/gpt-4.1-mini");
  const [modelVal,  setModelVal]  = useState("anthropic/claude-sonnet-4-6");
  const [modelAdv,  setModelAdv]  = useState("anthropic/claude-sonnet-4-6");

  const [phase, setPhase]     = useState("idle");
  const [tab, setTab]         = useState("history");
  const [steps, setSteps]     = useState({});
  const [log, setLog]         = useState([]);
  const [R, setR]             = useState({});
  const [err, setErr]         = useState(null);
  const [pinging, setPing]    = useState(false);

  const [history, setHistory]   = useState([]);
  const [currentEntryId, setCurrentEntryId] = useState(null);  // id of the last completed eval

  // Sharing state
  const [shareLoading, setShareLoading] = useState(null);  // entry.id being shared
  const [copiedId, setCopiedId]         = useState(null);  // entry.id whose link was just copied

  // Select mode (batch share)
  const [selectMode,   setSelectMode]   = useState(false);
  const [selectedIds,  setSelectedIds]  = useState(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchCopied,  setBatchCopied]  = useState(false);

  // Human ratings
  const [humanRatings, setHumanRatings]       = useState({});
  const [scoresHumanRatings, setScoresHumanRatings] = useState([]);
  const [sharedEval, setSharedEval]           = useState(null);
  const [ratingView, setRatingView]           = useState("ai"); // "ai" | "h0","h1",... | "avg"

  useEffect(() => { setHistory(loadHistory()); }, []);

  // Fetch human ratings for history tab entries that have supabaseIds
  useEffect(() => {
    if (tab !== "history") return;
    const ids = history.filter(e => e.supabaseId).map(e => e.supabaseId);
    if (!ids.length) return;
    supabase.from("human_ratings").select("eval_id,scores,rater_name,created_at")
      .in("eval_id", ids)
      .then(({ data }) => {
        if (!data) return;
        const grouped = {};
        data.forEach(r => {
          if (!grouped[r.eval_id]) grouped[r.eval_id] = [];
          grouped[r.eval_id].push(r);
        });
        setHumanRatings(prev => ({ ...prev, ...grouped }));
      });
  }, [tab, history]);

  // Fetch human ratings for the currently viewed eval (scores tab)
  useEffect(() => {
    if (!sharedEval?.supabaseId) { setScoresHumanRatings([]); return; }
    supabase.from("human_ratings").select("*")
      .eq("eval_id", sharedEval.supabaseId)
      .order("created_at", { ascending: true })
      .then(({ data }) => setScoresHumanRatings(data || []));
  }, [sharedEval]);

  const lg  = (m) => setLog(l => [...l, `[${new Date().toLocaleTimeString()}] ${m}`]);
  const stp = (k,v) => setSteps(p=>({...p,[k]:v}));
  const res = (k,v) => setR(p=>({...p,[k]:v}));

  const ping = async () => {
    setPing(true); setErr(null);
    try {
      const r = await callLLM(modelA, "You are a test.", "Reply with just: OK", "ping");
      setErr(`✓ API OK — got: "${r.slice(0,60)}"`);
    } catch(e) { setErr(e.message); }
    setPing(false);
  };

  const restoreEval = (entry) => {
    setTopic(entry.topic);
    setCt(entry.contentType);
    setExam(entry.exam);
    setModelA(entry.models.vA);
    setModelGenB(entry.models.genB);
    setModelVal(entry.models.validator);
    setModelAdv(entry.models.adversarial);
    setR(entry.results);
    setSteps({}); setLog([]); setErr(null);
    setCurrentEntryId(entry.id);
    setSharedEval(entry.supabaseId ? { supabaseId: entry.supabaseId, v1IsVA: entry.v1IsVA } : null);
    setRatingView("ai");
    setPhase("done");
    setTab("scores");
  };

  const deleteEntry = (id) => {
    const updated = history.filter(e => e.id !== id);
    setHistory(updated);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  };

  // Push eval to Supabase and copy share link to clipboard
  const shareEval = async (entry) => {
    if (!process.env.REACT_APP_SUPABASE_URL || !process.env.REACT_APP_SUPABASE_ANON_KEY) {
      setErr("Share failed: REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY are not set in .env — add them and restart the dev server.");
      return;
    }
    setShareLoading(entry.id);
    try {
      let supabaseId = entry.supabaseId;
      let v1IsVA     = entry.v1IsVA;

      if (!supabaseId) {
        v1IsVA = Math.random() > 0.5;
        const { data, error } = await supabase.from("evals").insert({
          local_id:     String(entry.id),
          topic:        entry.topic,
          content_type: entry.contentType,
          exam:         entry.exam,
          models:       entry.models,
          blind: {
            v1_text:  v1IsVA ? entry.results.vA : entry.results.vB,
            v2_text:  v1IsVA ? entry.results.vB : entry.results.vA,
            v1_is_vA: v1IsVA,
          },
          ai_scores:    entry.results.scores,
          full_results: entry.results,
        }).select("id").single();

        if (error) throw error;
        supabaseId = data.id;

        // Persist supabaseId + blinding back to localStorage
        const updated = updateInHistory(entry.id, { supabaseId, v1IsVA });
        setHistory(updated);

        // If this is the currently viewed eval, set sharedEval
        if (entry.id === currentEntryId) setSharedEval({ supabaseId, v1IsVA });
      }

      const url = `${window.location.origin}/#rate/${supabaseId}`;
      await navigator.clipboard.writeText(url);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId(id => id === entry.id ? null : id), 2500);
    } catch(e) {
      setErr("Share failed: " + (e?.message || e?.details || JSON.stringify(e) || "unknown error"));
    }
    setShareLoading(null);
  };

  // Push selected evals to Supabase and copy batch link to clipboard
  const shareBatch = async () => {
    if (!process.env.REACT_APP_SUPABASE_URL || !process.env.REACT_APP_SUPABASE_ANON_KEY) {
      setErr("Share failed: REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY are not set in .env — add them and restart the dev server.");
      return;
    }
    setBatchLoading(true);
    try {
      const selectedEntries = history.filter(e => selectedIds.has(e.id));
      let updatedHistory = [...history];

      // Ensure all selected evals are uploaded; collect {entry, supabaseId} pairs
      const pairs = [];
      for (const entry of selectedEntries) {
        if (entry.supabaseId) {
          pairs.push({ entry, supabaseId: entry.supabaseId });
        } else {
          const v1IsVA = Math.random() > 0.5;
          const { data, error } = await supabase.from("evals").insert({
            local_id:     String(entry.id),
            topic:        entry.topic,
            content_type: entry.contentType,
            exam:         entry.exam,
            models:       entry.models,
            blind: {
              v1_text:  v1IsVA ? entry.results.vA : entry.results.vB,
              v2_text:  v1IsVA ? entry.results.vB : entry.results.vA,
              v1_is_vA: v1IsVA,
            },
            ai_scores:    entry.results.scores,
            full_results: entry.results,
          }).select("id").single();

          if (error) throw error;
          const supabaseId = data.id;
          pairs.push({ entry, supabaseId });
          updatedHistory = updatedHistory.map(e => e.id === entry.id ? { ...e, supabaseId, v1IsVA } : e);
        }
      }

      localStorage.setItem(HISTORY_KEY, JSON.stringify(updatedHistory));
      setHistory(updatedHistory);

      // Randomize: shuffle eval order + flip v1/v2 display independently per eval
      const shuffled = [...pairs].sort(() => Math.random() - 0.5);
      const parts = shuffled.map(({ supabaseId }) => `${supabaseId}:${Math.random() > 0.5 ? 1 : 0}`);

      const url = `${window.location.origin}/#batch/${parts.join(",")}`;
      await navigator.clipboard.writeText(url);
      setBatchCopied(true);
      setTimeout(() => setBatchCopied(false), 2500);
    } catch(e) {
      setErr("Batch share failed: " + (e?.message || e?.details || JSON.stringify(e) || "unknown error"));
    }
    setBatchLoading(false);
  };

  const refreshScoresRatings = () => {
    if (!sharedEval?.supabaseId) return;
    supabase.from("human_ratings").select("*")
      .eq("eval_id", sharedEval.supabaseId)
      .order("created_at", { ascending: true })
      .then(({ data }) => setScoresHumanRatings(data || []));
  };

  // ── Run eval pipeline ─────────────────────────────────────────────
  const run = useCallback(async () => {
    if (!topic.trim() || phase==="running") return;
    setPhase("running"); setErr(null); setLog([]); setR({}); setSteps({});
    setSharedEval(null); setCurrentEntryId(null); setRatingView("ai"); setTab("pipeline");

    const type = ct.toLowerCase();
    const genPrompt = ct==="Lesson"
      ? `Write an exam-ready lesson on "${topic}" for ${exam}.\nStructure: (1) core concept / mechanism, (2) key clinical features or decision points, (3) management or approach, (4) high-yield distinctions and pitfalls.\nTarget length: 200–250 words. No padding.`
      : `Write a single-best-answer MCQ on "${topic}" for ${exam}.\nInclude: a clinical stem (3–4 sentences, realistic scenario), 5 answer choices (one correct, four plausible distractors), the correct answer, and a 3–4 sentence explanation covering why the answer is correct and why each distractor is wrong.\nTarget length: 250–300 words.`;

    // Helper: parse CRITIQUE / REVISED sections from a single review call
    function parseReview(raw, original) {
      const marker = /^REVISED:\s*/im;
      const match = marker.exec(raw);
      if (!match) return { critique: raw.trim(), revised: original };
      const critique = raw.slice(0, match.index).replace(/^CRITIQUE:\s*/i, "").trim();
      const revised  = raw.slice(match.index + match[0].length).trim();
      return { critique, revised: revised || original };
    }

    try {
      lg("Step 1: Generating Version A...");
      stp("genA","running");
      const vA = await callLLM(
        modelA,
        `You are a medical educator creating ${exam} study material. Write clearly, accurately, and at the right depth for the exam level.`,
        genPrompt, "Gen-A", 2000
      );
      stp("genA","complete"); res("vA", vA); res("draft", vA);
      lg(`✓ Version A ready (${vA.length} chars)`);

      lg("Step 2: Validator review...");
      stp("validate","running");
      const valRaw = await callLLM(
        modelVal,
        `You are a medical accuracy reviewer for ${exam}.
Your job is not to improve the content — it is to find genuine errors.
Only flag an issue if you are confident it is factually wrong, clinically outdated, or actively misleading in a way that could cause a student to answer a question incorrectly.
Style preferences, formatting choices, and minor completeness are not issues.
Rules for revision:
- Make the minimum edit needed to fix each flagged issue
- Do not change any sentence, phrase, or structure not directly related to the critique
- The result should feel like the same document with targeted corrections, not a rewrite
- If a critique point is ambiguous or the fix would risk making the content worse, leave that part unchanged`,
        `Review this ${type} for ${exam}:\n\n${vA}\n\nRespond in exactly this format:\nCRITIQUE: <list genuine factual errors one per line, or "Accurate." if none>\nREVISED:\n<the corrected ${type}, or the original unchanged if no corrections needed>`,
        "Validate", 3000
      );
      const { critique: valCritique, revised: valRevised } = parseReview(valRaw, vA);
      const valChanged = valRevised.trim() !== vA.trim();
      stp("validate","complete"); res("valCritique", valCritique); res("valRevised", valRevised);
      lg(`✓ Validator done — ${valChanged ? `revised (${valRevised.length} chars)` : "no changes"}`);

      lg("Step 3: Adversarial review...");
      stp("adversarial","running");
      const advRaw = await callLLM(
        modelAdv,
        `You are an adversarial reviewer for ${exam} medical content.
Your job is to find gaps that would cause a student to answer a question incorrectly — not to make the content more comprehensive.
Only flag a gap if: (a) it is directly tested on ${exam}, AND (b) its absence could lead to a wrong answer. Do not flag nice-to-haves, minor omissions, or anything a student could reasonably infer.
Rules for revision:
- Add or adjust only what the critique identifies as a critical gap
- Do not restructure, reformat, or rewrite sections unrelated to the gap
- Integrate additions naturally into the existing flow — do not append a list at the end
- The result should feel like the same document with targeted additions, not a rewrite
- If integrating a gap would disrupt clarity more than it helps, leave that part unchanged`,
        `Review this ${type} for ${exam}:\n\n${valRevised}\n\nRespond in exactly this format:\nCRITIQUE: <list critical gaps one per line, or "Complete." if none>\nREVISED:\n<the strengthened ${type}, or the original unchanged if no additions needed>`,
        "Adversarial", 3000
      );
      const { critique: advCritique, revised: vB } = parseReview(advRaw, valRevised);
      const advChanged = vB.trim() !== valRevised.trim();
      stp("adversarial","complete"); res("advCritique", advCritique); res("vB", vB);
      lg(`✓ Adversarial done — ${advChanged ? `revised (${vB.length} chars)` : "no changes"}`);

      lg("Step 4: Scoring both versions...");
      stp("eval","running");
      // Blind the scorer: randomly assign vA/vB to v1/v2
      const scorerFlip = Math.random() > 0.5;
      const [v1text, v2text] = scorerFlip ? [vB, vA] : [vA, vB];
      const evalRaw = await callLLM(
        modelGenB,
        `You are a rigorous medical education evaluator. Return ONLY valid JSON — no markdown, no backticks, nothing else.
Evaluation principles:
- Relevant clinical context (contraindications, caveats, decision criteria) is educational value — do not penalise completeness
- Conciseness is only a virtue when nothing important is omitted
- Do not penalise formatting differences (bullets vs prose, caps vs italics) unless one genuinely aids learning more than the other`,
        `Score two ${type}s on "${topic}" for ${exam}.

VERSION 1:
${cap(v1text,3000)}

VERSION 2:
${cap(v2text,3000)}

Criteria:
- accuracy: factual correctness — errors, outdated info, misleading claims
- clarity: teaching effectiveness — structure, explanation quality, logical flow
- retention: memorability — hooks, patterns, anchors for recall under exam pressure
- examYield: right content for what ${exam} actually tests, at the right depth

For each criterion:
1. Compare versions directly — which is better and by how much? (negligible / minor / moderate / significant)
2. Write 1–2 sentences of specific feedback per version — name exact facts, gaps, or phrases
3. Score so the gap matches the quality gap; a version with real issues must not score 9+

Return ONLY this JSON:
{"v1":{"accuracy":{"feedback":"...","score":6},"clarity":{"feedback":"...","score":6},"retention":{"feedback":"...","score":7},"examYield":{"feedback":"...","score":6}},"v2":{"accuracy":{"feedback":"...","score":9},"clarity":{"feedback":"...","score":9},"retention":{"feedback":"...","score":8},"examYield":{"feedback":"...","score":9}},"winner":"1 or 2","summary":"one sentence"}`,
        "Eval", 3000
      );
      let rawScores;
      try { rawScores = JSON.parse(evalRaw.replace(/```json\n?|```/g,"").trim()); }
      catch { throw new Error(`Score parse failed. Raw: "${evalRaw.slice(0,200)}"`); }
      // Unblind: map v1/v2 back to vA/vB
      const scores = {
        vA: scorerFlip ? rawScores.v2 : rawScores.v1,
        vB: scorerFlip ? rawScores.v1 : rawScores.v2,
        winner: rawScores.winner === "1"
          ? (scorerFlip ? "B" : "A")
          : (scorerFlip ? "A" : "B"),
        summary: rawScores.summary,
      };
      stp("eval","complete"); res("scores", scores); lg("✓ Complete");

      const entry = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        topic, contentType: ct, exam,
        models: { vA: modelA, genB: modelGenB, validator: modelVal, adversarial: modelAdv },
        results: { vA, valRevised, vB, valCritique, advCritique, scores },
      };
      saveToHistory(entry);
      setHistory(loadHistory());
      setCurrentEntryId(entry.id);
      setPhase("done"); setTab("scores");

    } catch(e) {
      setErr(e.message); setPhase("error");
      lg(`✗ ${e.message}`);
    }
  }, [topic, ct, exam, phase, modelA, modelGenB, modelVal, modelAdv]);

  // ── Derived values ────────────────────────────────────────────────
  const sc   = R.scores;
  const totA = sc ? totalScore(sc.vA) : 0;
  const totB = sc ? totalScore(sc.vB) : 0;

  const tabs = [
    { id:"history",   label:`History${history.length ? ` (${history.length})` : ""}` },
    { id:"pipeline",  label:"Pipeline",  off: phase==="idle" },
    { id:"content",   label:"Content",   off: !R.vA },
    { id:"critiques", label:"Critiques", off: !R.valCritique },
    { id:"scores",    label: sc ? `Ratings · ${totA} vs ${totB}` : "Ratings", off: !sc },
  ];

  const stepModels = {
    genA: modelA, validate: modelVal, adversarial: modelAdv, eval: modelGenB,
  };

  const running = phase === "running";

  // ── Hash routing: early exit after all hooks ───────────────────
  if (ratingEvalId) return <RatingView evalId={ratingEvalId} />;
  if (batchEvalIds) return <BatchRatingView evalIds={batchEvalIds} />;

  // ── Render ────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.2}}
        textarea:focus{outline:2px solid #00c89655}
        select option,select optgroup{background:#0d1117}
        .hist-card:hover{border-color:#243650!important}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#243650;border-radius:2px}
      `}</style>

      <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'Sora',sans-serif",padding:"24px 16px 60px"}}>
        <div style={{maxWidth:820,margin:"0 auto"}}>

          <div style={{marginBottom:24}}>
            <h1 style={{fontSize:22,fontWeight:700,letterSpacing:"-0.5px",marginBottom:6}}>
              <span style={{color:C.blue}}>Single Model</span>
              <span style={{color:C.dim,margin:"0 10px",fontWeight:400}}>vs</span>
              <span style={{color:C.accent}}>Reviewed Pipeline</span>
            </h1>
            <p style={{fontSize:13.5,color:C.muted}}>4 sequential steps · accuracy · clarity · retention · exam-yield</p>
          </div>

          {/* Input card */}
          <div style={{background:C.surface,border:`1px solid ${C.b}`,borderRadius:10,padding:18,marginBottom:14}}>
            <textarea value={topic} onChange={e=>setTopic(e.target.value)} disabled={running}
              placeholder="Topic — e.g. Rate control in atrial fibrillation, Cushing's syndrome..."
              rows={2} style={{width:"100%",background:C.bg,border:`1px solid ${C.b}`,borderRadius:7,padding:"10px 14px",color:C.text,fontSize:14.5,resize:"none",marginBottom:12,lineHeight:1.7}}/>

            <div style={{display:"flex",flexWrap:"wrap",gap:7,alignItems:"center",marginBottom:12}}>
              {["Lesson","MCQ"].map(t=>(
                <button key={t} onClick={()=>setCt(t)} disabled={running} style={{
                  padding:"6px 15px",borderRadius:6,fontSize:13,fontWeight:600,cursor:"pointer",
                  border:`1px solid ${ct===t?C.accent:C.b}`,background:ct===t?C.abg:"transparent",color:ct===t?C.accent:C.muted,
                }}>{t}</button>
              ))}
              <select value={exam} onChange={e=>setExam(e.target.value)} disabled={running} style={{
                padding:"6px 12px",borderRadius:6,border:`1px solid ${C.b}`,background:C.bg,color:C.text,fontSize:13,cursor:"pointer",
              }}>
                {EXAMS.map(e=><option key={e}>{e}</option>)}
              </select>
              <button onClick={ping} disabled={pinging||running} style={{
                padding:"6px 13px",borderRadius:6,border:`1px solid ${C.b}`,background:"transparent",
                color:C.muted,fontSize:12,fontFamily:"monospace",cursor:"pointer",
              }}>{pinging?"pinging...":"test API"}</button>
              <button onClick={run} disabled={running||!topic.trim()} style={{
                marginLeft:"auto",padding:"9px 24px",borderRadius:7,border:"none",
                background:running||!topic.trim()?C.dim:C.accent,
                color:running||!topic.trim()?C.muted:"#000",
                fontSize:13.5,fontWeight:700,cursor:running||!topic.trim()?"not-allowed":"pointer",
              }}>{running?"Running...":"Run Eval →"}</button>
            </div>

            <div style={{borderTop:`1px solid ${C.b}`,paddingTop:12}}>
              <div style={{fontSize:10.5,fontFamily:"monospace",color:C.muted,textTransform:"uppercase",letterSpacing:"1px",marginBottom:10}}>Model Selection</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12}}>
                <ModelSelect label="Generator"   value={modelA}    onChange={setModelA}    disabled={running}/>
                <ModelSelect label="Validator"   value={modelVal}  onChange={setModelVal}  disabled={running}/>
                <ModelSelect label="Adversarial" value={modelAdv}  onChange={setModelAdv}  disabled={running}/>
                <ModelSelect label="Scorer"      value={modelGenB} onChange={setModelGenB} disabled={running}/>
              </div>
            </div>
          </div>

          {err&&(
            <div style={{
              background:err.startsWith("✓")?"rgba(0,200,150,0.08)":"rgba(248,113,113,0.09)",
              border:`1px solid ${err.startsWith("✓")?"#00c89655":"#f8717155"}`,
              borderRadius:7,padding:"10px 13px",marginBottom:12,
              color:err.startsWith("✓")?C.accent:C.red,fontSize:12,lineHeight:1.6,fontFamily:"monospace",
            }}>{err}</div>
          )}

          {/* Tabs */}
          <div>
            <div style={{display:"flex",gap:2,borderBottom:`1px solid ${C.b}`}}>
              {tabs.map(({id,label,off})=>(
                <button key={id} onClick={()=>!off&&setTab(id)} style={{
                  padding:"9px 16px",
                  border:`1px solid ${tab===id?C.b:"transparent"}`,
                  borderBottom:tab===id?`1px solid ${C.surface}`:"1px solid transparent",
                  background:tab===id?C.surface:"transparent",
                  color:off?C.dim:tab===id?C.text:C.muted,
                  fontSize:13,fontWeight:600,cursor:off?"not-allowed":"pointer",
                  borderRadius:"6px 6px 0 0",fontFamily:"monospace",
                }}>{label}</button>
              ))}
            </div>

            <div style={{background:C.surface,border:`1px solid ${C.b}`,borderTop:"none",borderRadius:"0 8px 8px 8px",padding:18,minHeight:200}}>

              {/* ── History ── */}
              {tab==="history"&&(
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:10,flexWrap:"wrap"}}>
                    {selectMode ? (
                      <span style={{fontSize:12.5,fontFamily:"monospace",color:C.muted}}>
                        Select evals for a batch rating link
                      </span>
                    ) : (
                      <span style={{fontSize:12.5,fontFamily:"monospace",color:C.muted}}>
                        {history.length} eval{history.length!==1?"s":""} · click to restore · Share for blind ratings
                      </span>
                    )}
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      {selectMode ? (
                        <>
                          <button onClick={shareBatch} disabled={selectedIds.size===0||batchLoading} style={{
                            fontSize:12,fontFamily:"monospace",padding:"4px 12px",borderRadius:5,
                            cursor:selectedIds.size===0||batchLoading?"not-allowed":"pointer",
                            border:`1px solid ${batchCopied?C.accent:selectedIds.size>0?C.accent:C.b}`,
                            background:batchCopied?"rgba(0,200,150,0.1)":"transparent",
                            color:batchCopied?C.accent:selectedIds.size>0?C.accent:C.dim,
                          }}>
                            {batchLoading?"sharing…":batchCopied?"✓ link copied":`Share batch (${selectedIds.size}) →`}
                          </button>
                          <button onClick={()=>{setSelectMode(false);setSelectedIds(new Set());}} style={{
                            fontSize:12,fontFamily:"monospace",color:C.muted,background:"transparent",
                            border:`1px solid ${C.b}`,padding:"4px 10px",borderRadius:5,cursor:"pointer",
                          }}>Done</button>
                        </>
                      ) : (
                        <>
                          {history.length>0&&(
                            <button onClick={()=>{setSelectMode(true);setSelectedIds(new Set());}} style={{
                              fontSize:12,fontFamily:"monospace",color:C.muted,background:"transparent",
                              border:`1px solid ${C.b}`,padding:"4px 10px",borderRadius:5,cursor:"pointer",
                            }}>Select</button>
                          )}
                          {history.length>0&&(
                            <button onClick={()=>{
                              if(window.confirm("Clear all eval history?")) {
                                setHistory([]); localStorage.removeItem(HISTORY_KEY);
                              }
                            }} style={{fontSize:10,fontFamily:"monospace",color:C.muted,background:"transparent",border:`1px solid ${C.b}`,padding:"3px 9px",borderRadius:5,cursor:"pointer"}}>
                              clear all
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {history.length===0 ? (
                    <div style={{fontSize:12,fontFamily:"monospace",color:C.dim,textAlign:"center",padding:"40px 0"}}>
                      No eval history yet — run an eval to start.
                    </div>
                  ) : (
                    <div style={{display:"flex",flexDirection:"column",gap:16}}>
                      {["Lesson","MCQ"].map(ct => {
                        const group = history.filter(e => e.contentType === ct);
                        if (!group.length) return null;
                        return (
                          <div key={ct}>
                            <div style={{fontSize:11,fontFamily:"monospace",color:C.muted,textTransform:"uppercase",letterSpacing:"1px",marginBottom:8,paddingBottom:6,borderBottom:`1px solid ${C.b}`}}>
                              {ct === "MCQ" ? "MCQs" : "Lessons"} · {group.length}
                            </div>
                            <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      {group.map(entry => {
                        const tA = entry.results.scores ? totalScore(entry.results.scores.vA) : null;
                        const tB = entry.results.scores ? totalScore(entry.results.scores.vB) : null;
                        const ratings = entry.supabaseId ? (humanRatings[entry.supabaseId] || []) : [];

                        return (
                          <div key={entry.id} className="hist-card"
                            onClick={() => {
                              if (selectMode) {
                                setSelectedIds(prev => {
                                  const next = new Set(prev);
                                  if (next.has(entry.id)) next.delete(entry.id);
                                  else next.add(entry.id);
                                  return next;
                                });
                              } else {
                                restoreEval(entry);
                              }
                            }}
                            style={{
                              background:C.s2,
                              border:`1px solid ${selectMode&&selectedIds.has(entry.id)?C.accent:C.b}`,
                              borderRadius:8,padding:"12px 14px",cursor:"pointer",
                              position:"relative",transition:"border-color 0.15s",
                            }}>

                            {/* Top-right: checkmark badge in select mode, × delete button otherwise */}
                            {selectMode ? (
                              <div style={{
                                position:"absolute",top:8,right:10,
                                width:20,height:20,borderRadius:"50%",
                                background:selectedIds.has(entry.id)?C.accent:C.dim,
                                display:"flex",alignItems:"center",justifyContent:"center",
                                fontSize:11,color:selectedIds.has(entry.id)?"#000":C.bg,
                                flexShrink:0,
                              }}>
                                {selectedIds.has(entry.id)?"✓":""}
                              </div>
                            ) : (
                              <button onClick={e=>{e.stopPropagation();deleteEntry(entry.id);}} style={{
                                position:"absolute",top:8,right:10,background:"transparent",border:"none",
                                color:C.muted,cursor:"pointer",fontSize:16,lineHeight:1,padding:"2px 5px",
                              }}>×</button>
                            )}

                            <div style={{fontSize:15,fontWeight:600,color:C.text,marginBottom:7,paddingRight:24}}>
                              {entry.topic.length>80 ? entry.topic.slice(0,80)+"…" : entry.topic}
                            </div>

                            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
                              <span style={{fontSize:12,color:C.accent,fontFamily:"monospace"}}>{entry.exam}</span>
                              <span style={{color:C.dim,fontSize:11}}>·</span>
                              <span style={{fontSize:12,color:C.muted,fontFamily:"monospace"}}>{entry.contentType}</span>
                              <span style={{color:C.dim,fontSize:11}}>·</span>
                              <span style={{fontSize:12,color:C.dim,fontFamily:"monospace"}}>{new Date(entry.timestamp).toLocaleString()}</span>
                            </div>

                            <div style={{display:"flex",gap:5,marginBottom:tA!==null?8:0,flexWrap:"wrap"}}>
                              {[
                                {label:"Gen",    id:entry.models.vA},
                                {label:"Val",    id:entry.models.validator},
                                {label:"Adv",    id:entry.models.adversarial},
                                {label:"Scorer", id:entry.models.genB},
                              ].map(({label,id})=>(
                                <div key={label} style={{display:"flex",alignItems:"center",gap:5,background:C.bg,border:`1px solid ${C.b}`,borderRadius:4,padding:"3px 9px",fontSize:11,fontFamily:"monospace"}}>
                                  <div style={{width:6,height:6,borderRadius:"50%",background:provColor(id)}}/>
                                  <span style={{color:C.dim}}>{label}:</span>
                                  <span style={{color:C.muted}}>{MODELS.find(m=>m.id===id)?.label||id}</span>
                                </div>
                              ))}
                            </div>

                            {/* Bottom action bar — hidden in select mode */}
                            {!selectMode&&(
                              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",paddingTop:8,borderTop:`1px solid ${C.b}`,gap:8}}>
                                <button onClick={e=>{e.stopPropagation();restoreEval(entry);}} style={{
                                  padding:"5px 14px",borderRadius:6,flexShrink:0,
                                  border:`1px solid ${C.b}`,background:C.bg,
                                  color:C.text,fontSize:12,fontFamily:"monospace",cursor:"pointer",
                                  display:"flex",alignItems:"center",gap:8,
                                }}>
                                  <span style={{fontWeight:600}}>Scoring</span>
                                  {tA!==null&&<>
                                    <span style={{color:C.dim}}>·</span>
                                    <span style={{color:C.blue}}>A {tA}</span>
                                    <span style={{color:C.accent}}>B {tB}</span>
                                    {ratings.length>0&&<><span style={{color:C.dim}}>·</span><span style={{color:C.warn}}>{ratings.length}H</span></>}
                                  </>}
                                </button>
                                <button onClick={async e => {
                                  e.stopPropagation();
                                  await shareEval(entry);
                                }} style={{
                                  padding:"4px 12px",borderRadius:5,flexShrink:0,
                                  border:`1px solid ${copiedId===entry.id?C.accent:C.b}`,
                                  background:"transparent",
                                  color:copiedId===entry.id?C.accent:C.muted,
                                  fontSize:11.5,fontFamily:"monospace",cursor:"pointer",
                                }}>
                                  {shareLoading===entry.id?"sharing…":copiedId===entry.id?"✓ link copied":entry.supabaseId?"copy link":"share →"}
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Pipeline ── */}
              {tab==="pipeline"&&phase!=="idle"&&(
                <div>
                  <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>
                    {STEPS.map(({key,label,color})=>{
                      const s = steps[key]||"pending";
                      const mId = stepModels[key];
                      return(
                        <div key={key} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:7,
                          background:s==="running"?`${color}11`:"transparent",
                          border:`1px solid ${s!=="pending"?C.bh:C.b}`,transition:"all 0.2s"}}>
                          <div style={{width:8,height:8,borderRadius:"50%",flexShrink:0,
                            background:s==="complete"?C.accent:s==="running"?color:C.dim}}/>
                          <span style={{fontSize:14,color:s==="pending"?C.dim:C.text,fontFamily:"monospace",flex:1}}>{label}</span>
                          <span style={{fontSize:12,color:provColor(mId),fontFamily:"monospace",opacity:0.85,marginRight:4}}>
                            {MODELS.find(m=>m.id===mId)?.label}
                          </span>
                          {s==="running"&&<span style={{fontSize:11.5,color,fontFamily:"monospace",animation:"blink 1.2s infinite"}}>processing</span>}
                          {s==="complete"&&<span style={{color:C.accent,fontSize:14}}>✓</span>}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{background:C.bg,border:`1px solid ${C.b}`,borderRadius:7,padding:10,maxHeight:150,overflowY:"auto"}}>
                    {log.length===0
                      ?<div style={{fontSize:12.5,fontFamily:"monospace",color:C.dim}}>Waiting...</div>
                      :log.map((l,i)=>(
                        <div key={i} style={{fontSize:12.5,fontFamily:"monospace",lineHeight:2,
                          color:l.includes("✗")?C.red:l.includes("✓")?C.accent:C.muted}}>{l}</div>
                      ))}
                  </div>
                </div>
              )}

              {/* ── Content ── */}
              {tab==="content"&&R.vA&&(
                <ContentTab vA={R.vA} draft={R.draft} valRevised={R.valRevised} vB={R.vB} />
              )}

              {/* ── Critiques ── */}
              {tab==="critiques"&&(
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  {[
                    {label:"Validator Critique",   sub: R.valRevised && R.valRevised !== R.vA ? "Factual errors found → revised" : "No factual errors found",  color:C.warn,   text:R.valCritique},
                    {label:"Adversarial Critique", sub: R.vB && R.vB !== R.valRevised ? "Gaps found → revised" : "No critical gaps found",                           color:C.purple, text:R.advCritique},
                  ].filter(x=>x.text).map(({label,sub,color,text})=>(
                    <div key={label} style={{background:C.bg,border:`1px solid ${C.b}`,borderRadius:8}}>
                      <div style={{padding:"10px 13px",borderBottom:`1px solid ${C.b}`,display:"flex",gap:8,alignItems:"center"}}>
                        <div style={{width:7,height:7,borderRadius:"50%",background:color}}/>
                        <div>
                          <div style={{fontSize:14,fontWeight:600,color:C.text}}>{label}</div>
                          <div style={{fontSize:12.5,color:C.muted}}>{sub}</div>
                        </div>
                      </div>
                      <div style={{padding:"14px 16px",fontSize:13.5,lineHeight:1.85,color:C.text,whiteSpace:"pre-wrap",maxHeight:260,overflowY:"auto"}}>{text}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Ratings ── */}
              {tab==="scores"&&sc&&(()=>{
                const currentEntry = history.find(e => e.id === currentEntryId);

                // Build dropdown options
                const ratingOptions = [{ id:"ai", label:"🤖 AI Evaluation" }];
                if (sharedEval) {
                  scoresHumanRatings.forEach((r,i) =>
                    ratingOptions.push({ id:`h${i}`, label:`👤 ${r.rater_name||`Rater ${i+1}`}` })
                  );
                  if (scoresHumanRatings.length > 0)
                    ratingOptions.push({ id:"avg", label:`📊 Human Average (${scoresHumanRatings.length})` });
                }

                // Normalise selected view into { vA, vB } where each criterion has { score, text }
                let tableData = null;
                if (ratingView === "ai") {
                  tableData = {
                    vA: Object.fromEntries(CRITERIA.map(c=>[c.key,{score:sc.vA[c.key].score, text:sc.vA[c.key].feedback||null}])),
                    vB: Object.fromEntries(CRITERIA.map(c=>[c.key,{score:sc.vB[c.key].score, text:sc.vB[c.key].feedback||null}])),
                  };
                } else if (ratingView==="avg" && sharedEval) {
                  const avg = avgHumanScores(scoresHumanRatings, sharedEval.v1IsVA);
                  if (avg) tableData = {
                    vA: Object.fromEntries(CRITERIA.map(c=>[c.key,{score:avg.vA[c.key], text:null}])),
                    vB: Object.fromEntries(CRITERIA.map(c=>[c.key,{score:avg.vB[c.key], text:null}])),
                  };
                } else if (ratingView.startsWith("h") && sharedEval) {
                  const r = scoresHumanRatings[parseInt(ratingView.slice(1))];
                  if (r) {
                    const vaKey = sharedEval.v1IsVA ? "v1" : "v2";
                    const vbKey = sharedEval.v1IsVA ? "v2" : "v1";
                    tableData = {
                      vA: Object.fromEntries(CRITERIA.map(c=>[c.key,{score:r.scores[vaKey][c.key].score, text:r.scores[vaKey][c.key].comment||null}])),
                      vB: Object.fromEntries(CRITERIA.map(c=>[c.key,{score:r.scores[vbKey][c.key].score, text:r.scores[vbKey][c.key].comment||null}])),
                    };
                  }
                }

                return (
                  <div>
                    {/* Share / copy link bar */}
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                      background:`rgba(90,171,240,0.05)`,border:`1px solid ${C.b}`,
                      borderRadius:7,padding:"9px 14px",marginBottom:16}}>
                      <span style={{fontSize:13,color:C.muted}}>
                        {sharedEval ? "Blind rating link" : "Share this eval for blind human rating"}
                      </span>
                      <button onClick={()=>shareEval(currentEntry||history.find(e=>e.supabaseId===sharedEval?.supabaseId))} style={{
                        padding:"5px 14px",borderRadius:6,border:`1px solid ${C.blue}`,background:"transparent",
                        color:C.blue,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'Sora',sans-serif",flexShrink:0,
                      }}>
                        {shareLoading ? "Sharing…" : copiedId ? "✓ Link copied" : sharedEval ? "Copy link" : "Share →"}
                      </button>
                    </div>

                    {/* Summary (AI view only) */}
                    {ratingView==="ai" && sc.summary && (
                      <div style={{background:C.abg,border:"1px solid #00c89633",borderRadius:7,padding:"12px 16px",marginBottom:16,fontSize:14,color:C.text,lineHeight:1.7}}>
                        {sc.summary}
                      </div>
                    )}

                    {/* View selector */}
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                      <select value={ratingView} onChange={e=>setRatingView(e.target.value)} style={{
                        padding:"7px 12px",borderRadius:7,border:`1px solid ${C.b}`,background:C.bg,
                        color:C.text,fontSize:13,fontFamily:"'Sora',sans-serif",cursor:"pointer",
                      }}>
                        {ratingOptions.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                      {sharedEval && (
                        <button onClick={refreshScoresRatings} style={{
                          fontSize:12,fontFamily:"monospace",color:C.muted,background:"transparent",
                          border:`1px solid ${C.b}`,padding:"6px 12px",borderRadius:6,cursor:"pointer",
                        }}>refresh</button>
                      )}
                      {sharedEval && scoresHumanRatings.length === 0 && (
                        <span style={{fontSize:12,fontFamily:"monospace",color:C.dim}}>No human ratings yet</span>
                      )}
                    </div>

                    {/* Unified table */}
                    {tableData
                      ? <UnifiedScoreTable data={tableData} />
                      : <div style={{fontSize:13,color:C.dim,fontFamily:"monospace",padding:"20px 0"}}>No data for selected view.</div>
                    }
                  </div>
                );
              })()}

            </div>
          </div>

        </div>
      </div>
    </>
  );
}

// ─── Content tab: Version A vs Version B evolution ─────────────────────
function ContentTab({ vA, draft, valRevised, vB }) {
  const stages = [
    { key:"valRevised", label:"After Validator",   text:valRevised },
    { key:"vB",         label:"After Adversarial", text:vB         },
  ].filter(s => s.text);

  const [activeStage, setActiveStage] = useState(stages[stages.length - 1]?.key);
  const activeText = stages.find(s => s.key === activeStage)?.text || vB || draft;

  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      {/* Version A */}
      <div>
        <div style={{fontSize:12,fontFamily:"monospace",color:C.blue,marginBottom:8,fontWeight:600}}>VERSION A · Single Model</div>
        <div style={{background:C.bg,border:`1px solid ${C.b}`,borderRadius:7,padding:15,fontSize:14,lineHeight:1.85,color:C.text,whiteSpace:"pre-wrap",maxHeight:460,overflowY:"auto"}}>{vA}</div>
      </div>

      {/* Version B with stage toggle */}
      <div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <div style={{fontSize:12,fontFamily:"monospace",color:C.accent,fontWeight:600}}>VERSION B · Reviewed</div>
          {stages.length > 1 && (
            <div style={{display:"flex",gap:4}}>
              {stages.map(s => (
                <button key={s.key} onClick={() => setActiveStage(s.key)} style={{
                  fontSize:10.5,fontFamily:"monospace",padding:"3px 9px",borderRadius:4,cursor:"pointer",
                  border:`1px solid ${activeStage===s.key ? C.accent : C.b}`,
                  background:activeStage===s.key ? "rgba(0,200,150,0.1)" : "transparent",
                  color:activeStage===s.key ? C.accent : C.muted,
                }}>{s.label}</button>
              ))}
            </div>
          )}
        </div>
        <div style={{background:C.bg,border:`1px solid ${activeStage==="vB"?C.accent:activeStage==="valRevised"?C.warn:C.b}`,borderRadius:7,padding:15,fontSize:14,lineHeight:1.85,color:C.text,whiteSpace:"pre-wrap",maxHeight:460,overflowY:"auto"}}>{activeText}</div>
      </div>
    </div>
  );
}

// ─── Unified score table (AI + individual human + human avg) ───────────
function UnifiedScoreTable({ data }) {
  const fmt = v => {
    const n = Number(v);
    return Number.isInteger(n) ? n : n.toFixed(1);
  };
  const totA = CRITERIA.reduce((s,c) => s + Number(data.vA[c.key]?.score||0), 0);
  const totB = CRITERIA.reduce((s,c) => s + Number(data.vB[c.key]?.score||0), 0);
  const totDiff = totB - totA;

  return (
    <div style={{borderRadius:8,border:`1px solid ${C.b}`,overflow:"hidden"}}>
      {/* Header */}
      <div style={{display:"grid",gridTemplateColumns:"150px 1fr 1fr",background:C.s2,borderBottom:`1px solid ${C.b}`}}>
        <div style={{padding:"11px 14px",borderRight:`1px solid ${C.b}`,fontSize:11,fontFamily:"monospace",color:C.muted,textTransform:"uppercase",letterSpacing:"0.5px"}}>Rubric</div>
        <div style={{padding:"11px 14px",borderRight:`1px solid ${C.b}`,fontSize:12,fontFamily:"monospace",color:C.blue,fontWeight:600}}>VERSION A · Single Model</div>
        <div style={{padding:"11px 14px",fontSize:12,fontFamily:"monospace",color:C.accent,fontWeight:600}}>VERSION B · Reviewed</div>
      </div>

      {/* Criterion rows */}
      {CRITERIA.map(({key,label,color,desc}) => {
        const a = data.vA[key], b = data.vB[key];
        if (!a || !b) return null;
        const diff = Number(b.score) - Number(a.score);
        const absDiff = Math.abs(diff);
        return (
          <div key={key} style={{display:"grid",gridTemplateColumns:"150px 1fr 1fr",borderBottom:`1px solid ${C.b}`}}>
            <div style={{padding:"13px 14px",borderRight:`1px solid ${C.b}`,background:C.s2,display:"flex",flexDirection:"column",gap:5,justifyContent:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:color,flexShrink:0}}/>
                <span style={{fontSize:13,fontWeight:600,color:C.text}}>{label}</span>
              </div>
              <span style={{fontSize:11,color:C.muted,lineHeight:1.4,paddingLeft:12}}>{desc}</span>
              {diff!==0 && <span style={{fontSize:10.5,fontFamily:"monospace",paddingLeft:12,color:diff>0?C.accent:C.blue}}>
                {diff>0?`+${fmt(absDiff)} → B`:`+${fmt(absDiff)} → A`}
              </span>}
            </div>
            {[{d:a,c:C.blue,br:true},{d:b,c:C.accent,br:false}].map(({d,c,br},i) => (
              <div key={i} style={{padding:"13px 14px",borderRight:br?`1px solid ${C.b}`:"none"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:d.text?10:0}}>
                  <span style={{fontSize:24,fontWeight:700,color:c,fontFamily:"monospace",lineHeight:1}}>{fmt(d.score)}</span>
                  <div style={{flex:1,height:4,background:C.b,borderRadius:2,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${Number(d.score)*10}%`,background:c,borderRadius:2,transition:"width 0.4s ease"}}/>
                  </div>
                  <span style={{fontSize:11,color:C.muted,fontFamily:"monospace"}}>/10</span>
                </div>
                {d.text && <div style={{fontSize:13.5,color:C.text,lineHeight:1.75,opacity:0.9}}>{d.text}</div>}
              </div>
            ))}
          </div>
        );
      })}

      {/* Total row */}
      <div style={{display:"grid",gridTemplateColumns:"150px 1fr 1fr",background:C.s2}}>
        <div style={{padding:"12px 14px",borderRight:`1px solid ${C.b}`,fontSize:11,fontFamily:"monospace",color:C.muted,textTransform:"uppercase",letterSpacing:"0.5px",display:"flex",alignItems:"center"}}>Total</div>
        <div style={{padding:"12px 14px",borderRight:`1px solid ${C.b}`,display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:24,fontWeight:700,color:C.blue,fontFamily:"monospace"}}>{fmt(totA)}</span>
          <span style={{fontSize:11,color:C.muted,fontFamily:"monospace"}}>/40</span>
        </div>
        <div style={{padding:"12px 14px",display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:24,fontWeight:700,color:C.accent,fontFamily:"monospace"}}>{fmt(totB)}</span>
          <span style={{fontSize:11,color:C.muted,fontFamily:"monospace"}}>/40</span>
          <span style={{marginLeft:"auto",fontSize:12,fontFamily:"monospace",color:totDiff>0?C.accent:totDiff<0?C.blue:C.muted}}>
            {totDiff>0?"B wins":totDiff<0?"A wins":"tie"} · Δ{fmt(Math.abs(totDiff))}
          </span>
        </div>
      </div>
    </div>
  );
}
