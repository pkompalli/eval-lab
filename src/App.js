import { useState, useCallback, useEffect } from "react";
import supabase from "./supabase";
import RatingView from "./RatingView";

// ─── Model catalogue ───────────────────────────────────────────────────
const MODELS = [
  { id:"claude-sonnet-4-20250514",  label:"Claude Sonnet 4",    provider:"anthropic" },
  { id:"claude-sonnet-4-6",         label:"Claude Sonnet 4.6",  provider:"anthropic" },
  { id:"claude-opus-4-6",           label:"Claude Opus 4.6",    provider:"anthropic" },
  { id:"claude-haiku-4-5-20251001", label:"Claude Haiku 4.5",   provider:"anthropic" },
  { id:"gpt-4o",                    label:"GPT-4o",             provider:"openai"    },
  { id:"gpt-4o-mini",               label:"GPT-4o Mini",        provider:"openai"    },
  { id:"gemini-2.0-flash",          label:"Gemini 2.0 Flash",   provider:"gemini"    },
  { id:"gemini-1.5-pro",            label:"Gemini 1.5 Pro",     provider:"gemini"    },
  { id:"gemini-1.5-flash",          label:"Gemini 1.5 Flash",   provider:"gemini"    },
];

const PROVIDER_COLORS = { anthropic:"#e07b39", openai:"#74aa9c", gemini:"#4285f4" };

function provColor(modelId) {
  const p = MODELS.find(m => m.id === modelId)?.provider;
  return PROVIDER_COLORS[p] || "#5a7390";
}

// ─── LLM caller ────────────────────────────────────────────────────────
async function callLLM(modelId, system, user, label = "", maxTokens = 600) {
  const model = MODELS.find(m => m.id === modelId);
  if (!model) throw new Error(`${label}: unknown model ${modelId}`);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 55000);

  let url, body;
  if (model.provider === "anthropic") {
    url = "/api/claude";
    body = { model: modelId, max_tokens: maxTokens, system, messages: [{ role:"user", content:user }] };
  } else if (model.provider === "openai") {
    url = "/api/openai";
    body = { model: modelId, max_tokens: maxTokens, messages: [{ role:"system", content:system }, { role:"user", content:user }] };
  } else {
    url = "/api/gemini";
    body = {
      model: modelId,
      contents: [{ role:"user", parts:[{ text:user }] }],
      systemInstruction: { parts:[{ text:system }] },
      generationConfig: { maxOutputTokens: maxTokens },
    };
  }

  let res;
  try {
    res = await fetch(url, { method:"POST", signal:ctrl.signal, headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
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

  if (model.provider === "anthropic") {
    if (!data.content?.[0]?.text) throw new Error(`${label}: empty response`);
    return data.content[0].text;
  }
  if (model.provider === "openai") {
    if (!data.choices?.[0]?.message?.content) throw new Error(`${label}: empty response`);
    return data.choices[0].message.content;
  }
  if (!data.candidates?.[0]?.content?.parts?.[0]?.text) throw new Error(`${label}: empty response`);
  return data.candidates[0].content.parts[0].text;
}

// ─── Helpers ───────────────────────────────────────────────────────────
function cap(s, n = 1400) { return s?.length > n ? s.slice(0, n) + "\n...[trimmed]" : s || ""; }

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
  { key:"quality",       label:"Quality",    color:"#5aabf0" },
  { key:"usefulness",    label:"Usefulness", color:"#a78bfa" },
  { key:"absorption",    label:"Absorption", color:"#f0b34a" },
  { key:"examReadiness", label:"Exam-Ready", color:"#00c896" },
];

const C = {
  bg:"#07090d", surface:"#0d1117", s2:"#111820",
  b:"#1a2535", bh:"#243650",
  accent:"#00c896", abg:"rgba(0,200,150,0.08)",
  text:"#dce8f5", muted:"#5a7390", dim:"#2d4057",
  blue:"#5aabf0", warn:"#f0b34a", purple:"#a78bfa", red:"#f87171",
};

const STEPS = [
  { key:"genA",        label:"Step 1 · Version A generate",   color:C.blue   },
  { key:"genBDraft",   label:"Step 2 · Version B draft",      color:C.accent },
  { key:"validate",    label:"Step 3a · Validator",           color:C.warn   },
  { key:"adversarial", label:"Step 3b · Adversarial review",  color:C.purple },
  { key:"genBFinal",   label:"Step 3c · Synthesize final B",  color:C.accent },
  { key:"eval",        label:"Step 4 · Score both versions",  color:C.purple },
];

// ─── ModelSelect ───────────────────────────────────────────────────────
function ModelSelect({ label, value, onChange, disabled }) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      <div style={{display:"flex",alignItems:"center",gap:5}}>
        <div style={{width:6,height:6,borderRadius:"50%",background:provColor(value),flexShrink:0}}/>
        <span style={{fontSize:10,color:C.muted,fontFamily:"monospace",textTransform:"uppercase",letterSpacing:"0.5px"}}>{label}</span>
      </div>
      <select value={value} onChange={e=>onChange(e.target.value)} disabled={disabled} style={{
        padding:"5px 8px",borderRadius:6,border:`1px solid ${C.b}`,background:C.bg,
        color:C.text,fontSize:11.5,cursor:disabled?"not-allowed":"pointer",fontFamily:"'Sora',sans-serif",
      }}>
        <optgroup label="Anthropic">{MODELS.filter(m=>m.provider==="anthropic").map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>
        <optgroup label="OpenAI">{MODELS.filter(m=>m.provider==="openai").map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>
        <optgroup label="Google">{MODELS.filter(m=>m.provider==="gemini").map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</optgroup>
      </select>
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────
export default function App() {

  // ── Hash routing: delegate to RatingView if URL is #rate/<uuid> ──
  const [ratingEvalId, setRatingEvalId] = useState(() => {
    const h = window.location.hash;
    return h.startsWith("#rate/") ? h.slice(6) : null;
  });
  useEffect(() => {
    const handler = () => {
      const h = window.location.hash;
      setRatingEvalId(h.startsWith("#rate/") ? h.slice(6) : null);
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  // ── State ─────────────────────────────────────────────────────────
  const [topic, setTopic]   = useState("");
  const [ct, setCt]         = useState("Lesson");
  const [exam, setExam]     = useState("UKMLA");

  const [modelA,    setModelA]    = useState("claude-sonnet-4-20250514");
  const [modelGenB, setModelGenB] = useState("claude-sonnet-4-20250514");
  const [modelVal,  setModelVal]  = useState("claude-sonnet-4-20250514");
  const [modelAdv,  setModelAdv]  = useState("claude-sonnet-4-20250514");

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

  // Human ratings
  const [humanRatings, setHumanRatings]       = useState({});  // { [supabaseId]: [ratings] } for history tab
  const [scoresHumanRatings, setScoresHumanRatings] = useState([]);  // for current scores tab
  const [sharedEval, setSharedEval]           = useState(null); // { supabaseId, v1IsVA } for current view

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
    setSharedEval(null); setCurrentEntryId(null); setTab("pipeline");

    const type = ct.toLowerCase();
    const prompt = ct==="Lesson"
      ? `Write an exam-ready lesson on "${topic}" for ${exam}. Key concepts, clinical pearls, nuances. Max 200 words.`
      : `Write a single-best-answer MCQ on "${topic}" for ${exam}. Clinical stem, 5 options, correct answer, brief explanation. Max 200 words.`;

    try {
      lg("Step 1: Generating Version A...");
      stp("genA","running");
      const vA = await callLLM(modelA, `You are a medical educator creating ${exam} study material.`, prompt, "Gen-A");
      stp("genA","complete"); res("vA", vA); lg("✓ Version A ready");

      lg("Step 2: Generating Version B draft...");
      stp("genBDraft","running");
      const draft = await callLLM(modelGenB, `You are an expert ${exam} medical educator.`, prompt, "Gen-B");
      stp("genBDraft","complete"); res("draft", draft); lg("✓ Version B draft ready");

      lg("Step 3a: Running validator...");
      stp("validate","running");
      const valCritique = await callLLM(
        modelVal,
        `You are a medical accuracy validator for ${exam}. Identify factual errors, flattened distinctions, and outdated guidance.`,
        `Validate this ${type} for ${exam}:\n\n${cap(draft)}\n\nList up to 3 specific issues, one bullet each. Be concise.`,
        "Validate"
      );
      stp("validate","complete"); res("valCritique", valCritique); lg("✓ Validator done");

      lg("Step 3b: Running adversarial review...");
      stp("adversarial","running");
      const advCritique = await callLLM(
        modelAdv,
        `You are an adversarial reviewer for ${exam} medical content. Find gaps, missing exam-tested nuances, and false confidence.`,
        `Adversarially critique this ${type} for ${exam}:\n\n${cap(draft)}\n\nList up to 3 gaps or issues, one bullet each. Be concise.`,
        "Adversarial"
      );
      stp("adversarial","complete"); res("advCritique", advCritique); lg("✓ Adversarial review done");

      lg("Step 3c: Synthesizing final Version B...");
      stp("genBFinal","running");
      const vB = await callLLM(
        modelGenB,
        `You are an expert ${exam} medical educator. Revise content based on critiques to produce the best possible study material.`,
        `Original ${type}:\n${cap(draft,800)}\n\nValidator critique:\n${cap(valCritique,400)}\n\nAdversarial critique:\n${cap(advCritique,400)}\n\nWrite an improved final version addressing all issues. Max 200 words.`,
        "Synthesis"
      );
      stp("genBFinal","complete"); res("vB", vB); lg("✓ Final Version B ready");

      lg("Step 4: Scoring both versions...");
      stp("eval","running");
      const evalRaw = await callLLM(
        modelGenB,
        `You are a rigorous medical education evaluator. Return ONLY valid JSON — no markdown, no backticks, nothing else.`,
        `Score two ${type}s on "${topic}" for ${exam}.

VERSION A:
${cap(vA,1000)}

VERSION B:
${cap(vB,1000)}

Score each criterion 1-10. Use the full range — be discriminating.

Criteria:
- quality: factual accuracy, clinical correctness, depth of coverage
- usefulness: practical study value and relevance for ${exam}
- absorption: clarity, structure, and memorability
- examReadiness: alignment with ${exam} question patterns and high-yield focus

For each score write 2-3 sentences of SPECIFIC feedback:
- Quote exact phrases or specific content from the text
- Name the specific fact, concept, or clinical detail that is correct/wrong/missing
- Compare against what ${exam} actually tests

Return ONLY this JSON:
{"vA":{"quality":{"score":6,"feedback":"2-3 specific sentences with quotes."},"usefulness":{"score":6,"feedback":"..."},"absorption":{"score":7,"feedback":"..."},"examReadiness":{"score":6,"feedback":"..."}},"vB":{"quality":{"score":9,"feedback":"..."},"usefulness":{"score":9,"feedback":"..."},"absorption":{"score":8,"feedback":"..."},"examReadiness":{"score":9,"feedback":"..."}},"winner":"B","summary":"2 sentence comparison"}`,
        "Eval", 2000
      );
      let scores;
      try { scores = JSON.parse(evalRaw.replace(/```json\n?|```/g,"").trim()); }
      catch { throw new Error(`Score parse failed. Raw: "${evalRaw.slice(0,200)}"`); }
      stp("eval","complete"); res("scores", scores); lg("✓ Complete");

      const entry = {
        id: Date.now(),
        timestamp: new Date().toISOString(),
        topic, contentType: ct, exam,
        models: { vA: modelA, genB: modelGenB, validator: modelVal, adversarial: modelAdv },
        results: { vA, vB, valCritique, advCritique, scores },
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
    { id:"scores",    label: sc ? `Scores · ${totA} vs ${totB}` : "Scores", off: !sc },
  ];

  const stepModels = {
    genA: modelA, genBDraft: modelGenB, validate: modelVal,
    adversarial: modelAdv, genBFinal: modelGenB, eval: modelGenB,
  };

  const running = phase === "running";

  // ── Hash routing: early exit after all hooks ───────────────────
  if (ratingEvalId) return <RatingView evalId={ratingEvalId} />;

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

          <div style={{marginBottom:20}}>
            <h1 style={{fontSize:17,fontWeight:700,letterSpacing:"-0.3px",marginBottom:4}}>
              <span style={{color:C.blue}}>Single Model</span>
              <span style={{color:C.muted,margin:"0 8px",fontWeight:400}}>vs</span>
              <span style={{color:C.accent}}>Reviewed Pipeline</span>
            </h1>
            <p style={{fontSize:12,color:C.muted}}>6 sequential steps · quality · usefulness · absorption · exam-readiness</p>
          </div>

          {/* Input card */}
          <div style={{background:C.surface,border:`1px solid ${C.b}`,borderRadius:10,padding:15,marginBottom:12}}>
            <textarea value={topic} onChange={e=>setTopic(e.target.value)} disabled={running}
              placeholder="Topic — e.g. Rate control in atrial fibrillation, Cushing's syndrome..."
              rows={2} style={{width:"100%",background:C.bg,border:`1px solid ${C.b}`,borderRadius:7,padding:"9px 12px",color:C.text,fontSize:13,resize:"none",marginBottom:10,lineHeight:1.6}}/>

            <div style={{display:"flex",flexWrap:"wrap",gap:7,alignItems:"center",marginBottom:12}}>
              {["Lesson","MCQ"].map(t=>(
                <button key={t} onClick={()=>setCt(t)} disabled={running} style={{
                  padding:"5px 12px",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",
                  border:`1px solid ${ct===t?C.accent:C.b}`,background:ct===t?C.abg:"transparent",color:ct===t?C.accent:C.muted,
                }}>{t}</button>
              ))}
              <select value={exam} onChange={e=>setExam(e.target.value)} disabled={running} style={{
                padding:"5px 10px",borderRadius:6,border:`1px solid ${C.b}`,background:C.bg,color:C.text,fontSize:12,cursor:"pointer",
              }}>
                {EXAMS.map(e=><option key={e}>{e}</option>)}
              </select>
              <button onClick={ping} disabled={pinging||running} style={{
                padding:"5px 12px",borderRadius:6,border:`1px solid ${C.b}`,background:"transparent",
                color:C.muted,fontSize:11,fontFamily:"monospace",cursor:"pointer",
              }}>{pinging?"pinging...":"test API"}</button>
              <button onClick={run} disabled={running||!topic.trim()} style={{
                marginLeft:"auto",padding:"8px 20px",borderRadius:7,border:"none",
                background:running||!topic.trim()?C.dim:C.accent,
                color:running||!topic.trim()?C.muted:"#000",
                fontSize:12.5,fontWeight:700,cursor:running||!topic.trim()?"not-allowed":"pointer",
              }}>{running?"Running...":"Run Eval →"}</button>
            </div>

            <div style={{borderTop:`1px solid ${C.b}`,paddingTop:10}}>
              <div style={{fontSize:9,fontFamily:"monospace",color:C.dim,textTransform:"uppercase",letterSpacing:"1px",marginBottom:8}}>Model Selection</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10}}>
                <ModelSelect label="Version A"  value={modelA}    onChange={setModelA}    disabled={running}/>
                <ModelSelect label="Gen-B"       value={modelGenB} onChange={setModelGenB} disabled={running}/>
                <ModelSelect label="Validator"   value={modelVal}  onChange={setModelVal}  disabled={running}/>
                <ModelSelect label="Adversarial" value={modelAdv}  onChange={setModelAdv}  disabled={running}/>
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
                  padding:"7px 13px",
                  border:`1px solid ${tab===id?C.b:"transparent"}`,
                  borderBottom:tab===id?`1px solid ${C.surface}`:"1px solid transparent",
                  background:tab===id?C.surface:"transparent",
                  color:off?C.dim:tab===id?C.text:C.muted,
                  fontSize:12,fontWeight:600,cursor:off?"not-allowed":"pointer",
                  borderRadius:"6px 6px 0 0",fontFamily:"monospace",
                }}>{label}</button>
              ))}
            </div>

            <div style={{background:C.surface,border:`1px solid ${C.b}`,borderTop:"none",borderRadius:"0 8px 8px 8px",padding:18,minHeight:200}}>

              {/* ── History ── */}
              {tab==="history"&&(
                <div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                    <span style={{fontSize:11,fontFamily:"monospace",color:C.muted}}>
                      {history.length} eval{history.length!==1?"s":""} · click to restore · Share to get a blind rating link
                    </span>
                    {history.length>0&&(
                      <button onClick={()=>{
                        if(window.confirm("Clear all eval history?")) {
                          setHistory([]); localStorage.removeItem(HISTORY_KEY);
                        }
                      }} style={{fontSize:10,fontFamily:"monospace",color:C.muted,background:"transparent",border:`1px solid ${C.b}`,padding:"3px 9px",borderRadius:5,cursor:"pointer"}}>
                        clear all
                      </button>
                    )}
                  </div>

                  {history.length===0 ? (
                    <div style={{fontSize:12,fontFamily:"monospace",color:C.dim,textAlign:"center",padding:"40px 0"}}>
                      No eval history yet — run an eval to start.
                    </div>
                  ) : (
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      {history.map(entry => {
                        const tA = entry.results.scores ? totalScore(entry.results.scores.vA) : null;
                        const tB = entry.results.scores ? totalScore(entry.results.scores.vB) : null;
                        const winner = entry.results.scores?.winner;
                        const ratings = entry.supabaseId ? (humanRatings[entry.supabaseId] || []) : [];
                        const hAvg = ratings.length ? avgHumanScores(ratings, entry.v1IsVA) : null;

                        return (
                          <div key={entry.id} className="hist-card" onClick={()=>restoreEval(entry)} style={{
                            background:C.s2,border:`1px solid ${C.b}`,borderRadius:8,
                            padding:"12px 14px",cursor:"pointer",position:"relative",transition:"border-color 0.15s",
                          }}>
                            <button onClick={e=>{e.stopPropagation();deleteEntry(entry.id);}} style={{
                              position:"absolute",top:8,right:10,background:"transparent",border:"none",
                              color:C.muted,cursor:"pointer",fontSize:16,lineHeight:1,padding:"2px 5px",
                            }}>×</button>

                            <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:5,paddingRight:24}}>
                              {entry.topic.length>80 ? entry.topic.slice(0,80)+"…" : entry.topic}
                            </div>

                            <div style={{display:"flex",gap:7,alignItems:"center",marginBottom:8,flexWrap:"wrap"}}>
                              <span style={{fontSize:11,color:C.accent,fontFamily:"monospace"}}>{entry.exam}</span>
                              <span style={{color:C.dim,fontSize:10}}>·</span>
                              <span style={{fontSize:11,color:C.muted,fontFamily:"monospace"}}>{entry.contentType}</span>
                              <span style={{color:C.dim,fontSize:10}}>·</span>
                              <span style={{fontSize:11,color:C.dim,fontFamily:"monospace"}}>{new Date(entry.timestamp).toLocaleString()}</span>
                            </div>

                            <div style={{display:"flex",gap:5,marginBottom:tA!==null?8:0,flexWrap:"wrap"}}>
                              {[
                                {label:"V-A",  id:entry.models.vA},
                                {label:"Gen-B", id:entry.models.genB},
                                {label:"Val",   id:entry.models.validator},
                                {label:"Adv",   id:entry.models.adversarial},
                              ].map(({label,id})=>(
                                <div key={label} style={{display:"flex",alignItems:"center",gap:4,background:C.bg,border:`1px solid ${C.b}`,borderRadius:4,padding:"2px 7px",fontSize:10,fontFamily:"monospace"}}>
                                  <div style={{width:5,height:5,borderRadius:"50%",background:provColor(id)}}/>
                                  <span style={{color:C.dim}}>{label}:</span>
                                  <span style={{color:C.muted}}>{MODELS.find(m=>m.id===id)?.label||id}</span>
                                </div>
                              ))}
                            </div>

                            {tA!==null&&(
                              <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:8,flexWrap:"wrap"}}>
                                <span style={{fontSize:11,fontFamily:"monospace",color:C.dim}}>AI:</span>
                                <span style={{fontSize:12,fontFamily:"monospace",color:C.blue}}>A {tA}/40</span>
                                <span style={{fontSize:12,fontFamily:"monospace",color:C.accent}}>B {tB}/40</span>
                                <span style={{fontSize:11,fontFamily:"monospace",color:winner==="B"?C.accent:winner==="A"?C.blue:C.muted}}>
                                  {winner==="B"?"B wins":winner==="A"?"A wins":"tie"} · Δ{Math.abs(tB-tA)}
                                </span>
                              </div>
                            )}

                            {/* Human ratings row */}
                            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",paddingTop:8,borderTop:`1px solid ${C.b}`}}>
                              <div style={{fontSize:11,fontFamily:"monospace",color:C.muted,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                                {ratings.length > 0 ? (
                                  <>
                                    <span style={{color:C.warn}}>{ratings.length} human rating{ratings.length!==1?"s":""}</span>
                                    {hAvg&&<>
                                      <span style={{color:C.dim}}>·</span>
                                      <span>A avg <span style={{color:C.blue}}>{hAvg.totA.toFixed(0)}/40</span></span>
                                      <span>B avg <span style={{color:C.accent}}>{hAvg.totB.toFixed(0)}/40</span></span>
                                    </>}
                                  </>
                                ) : (
                                  <span style={{color:C.dim}}>{entry.supabaseId ? "no ratings yet" : "not shared"}</span>
                                )}
                              </div>
                              <button onClick={async e => {
                                e.stopPropagation();
                                await shareEval(entry);
                              }} style={{
                                padding:"3px 10px",borderRadius:5,flexShrink:0,
                                border:`1px solid ${copiedId===entry.id?C.accent:C.b}`,
                                background:"transparent",
                                color:copiedId===entry.id?C.accent:C.muted,
                                fontSize:10,fontFamily:"monospace",cursor:"pointer",
                              }}>
                                {shareLoading===entry.id?"sharing…":copiedId===entry.id?"✓ link copied":entry.supabaseId?"copy link":"share →"}
                              </button>
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
                          <span style={{fontSize:12.5,color:s==="pending"?C.dim:C.text,fontFamily:"monospace",flex:1}}>{label}</span>
                          <span style={{fontSize:10,color:provColor(mId),fontFamily:"monospace",opacity:0.75,marginRight:4}}>
                            {MODELS.find(m=>m.id===mId)?.label}
                          </span>
                          {s==="running"&&<span style={{fontSize:10,color,fontFamily:"monospace",animation:"blink 1.2s infinite"}}>processing</span>}
                          {s==="complete"&&<span style={{color:C.accent,fontSize:12}}>✓</span>}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{background:C.bg,border:`1px solid ${C.b}`,borderRadius:7,padding:10,maxHeight:150,overflowY:"auto"}}>
                    {log.length===0
                      ?<div style={{fontSize:11,fontFamily:"monospace",color:C.dim}}>Waiting...</div>
                      :log.map((l,i)=>(
                        <div key={i} style={{fontSize:11,fontFamily:"monospace",lineHeight:2,
                          color:l.includes("✗")?C.red:l.includes("✓")?C.accent:C.muted}}>{l}</div>
                      ))}
                  </div>
                </div>
              )}

              {/* ── Content ── */}
              {tab==="content"&&R.vA&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                  {[
                    {label:"VERSION A · Single Model",color:C.blue, text:R.vA},
                    {label:"VERSION B · Reviewed",    color:C.accent,text:R.vB||R.draft},
                  ].map(({label,color,text})=>(
                    <div key={label}>
                      <div style={{fontSize:10,fontFamily:"monospace",color,marginBottom:7,fontWeight:600}}>{label}</div>
                      <div style={{background:C.bg,border:`1px solid ${C.b}`,borderRadius:7,padding:13,fontSize:12.5,lineHeight:1.8,color:C.text,whiteSpace:"pre-wrap",maxHeight:400,overflowY:"auto"}}>{text}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Critiques ── */}
              {tab==="critiques"&&(
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  {[
                    {label:"Validator Critique", sub:"Accuracy & guideline issues",color:C.warn,  text:R.valCritique},
                    {label:"Adversarial Critique",sub:"Gaps & false confidence",   color:C.purple,text:R.advCritique},
                  ].filter(x=>x.text).map(({label,sub,color,text})=>(
                    <div key={label} style={{background:C.bg,border:`1px solid ${C.b}`,borderRadius:8}}>
                      <div style={{padding:"10px 13px",borderBottom:`1px solid ${C.b}`,display:"flex",gap:8,alignItems:"center"}}>
                        <div style={{width:7,height:7,borderRadius:"50%",background:color}}/>
                        <div>
                          <div style={{fontSize:12.5,fontWeight:600,color:C.text}}>{label}</div>
                          <div style={{fontSize:11,color:C.muted}}>{sub}</div>
                        </div>
                      </div>
                      <div style={{padding:"12px 13px",fontSize:12.5,lineHeight:1.8,color:C.text,whiteSpace:"pre-wrap",maxHeight:240,overflowY:"auto"}}>{text}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Scores ── */}
              {tab==="scores"&&sc&&(()=>{
                const humanAvg = sharedEval ? avgHumanScores(scoresHumanRatings, sharedEval.v1IsVA) : null;
                const currentEntry = history.find(e => e.id === currentEntryId);

                return (
                  <div>
                    {/* Share prompt if not yet shared */}
                    {!sharedEval && currentEntry && (
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                        background:`rgba(90,171,240,0.06)`,border:`1px solid ${C.bh}`,
                        borderRadius:7,padding:"9px 13px",marginBottom:14}}>
                        <span style={{fontSize:12,color:C.muted}}>Share this eval for blind human rating</span>
                        <button onClick={()=>shareEval(currentEntry)} style={{
                          padding:"5px 14px",borderRadius:6,border:`1px solid ${C.blue}`,background:"transparent",
                          color:C.blue,fontSize:11.5,fontWeight:600,cursor:"pointer",fontFamily:"'Sora',sans-serif",
                        }}>
                          {shareLoading===currentEntry.id ? "Sharing…" : copiedId===currentEntry.id ? "✓ Link copied" : "Share →"}
                        </button>
                      </div>
                    )}

                    {sc.summary&&(
                      <div style={{background:C.abg,border:"1px solid #00c89633",borderRadius:7,padding:"10px 13px",marginBottom:14,fontSize:12.5,color:C.text,lineHeight:1.65}}>
                        {sc.summary}
                      </div>
                    )}

                    {/* AI Scores table */}
                    <div style={{fontSize:10,fontFamily:"monospace",color:C.muted,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:6}}>AI Scores</div>
                    <ScoreTable sc={sc} totA={totA} totB={totB} />

                    {/* Human ratings section */}
                    {sharedEval && (
                      <div style={{marginTop:20}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                          <div style={{display:"flex",alignItems:"center",gap:10}}>
                            <span style={{fontSize:10,fontFamily:"monospace",color:C.muted,textTransform:"uppercase",letterSpacing:"0.5px"}}>Human Ratings</span>
                            {scoresHumanRatings.length > 0 && (
                              <span style={{fontSize:11,fontFamily:"monospace",color:C.warn}}>
                                {scoresHumanRatings.length} rater{scoresHumanRatings.length!==1?"s":""}
                              </span>
                            )}
                          </div>
                          <button onClick={refreshScoresRatings} style={{fontSize:10,fontFamily:"monospace",color:C.muted,background:"transparent",border:`1px solid ${C.b}`,padding:"2px 8px",borderRadius:5,cursor:"pointer"}}>
                            refresh
                          </button>
                        </div>

                        {scoresHumanRatings.length === 0 ? (
                          <div style={{fontSize:12,fontFamily:"monospace",color:C.dim,padding:"16px 0"}}>
                            No human ratings yet.
                            {" "}<span style={{color:C.muted}}>Share link:</span>
                            {" "}<code style={{fontSize:11,color:C.blue,wordBreak:"break-all"}}>
                              {window.location.origin}/#rate/{sharedEval.supabaseId}
                            </code>
                          </div>
                        ) : (
                          <>
                            {/* Aggregate table */}
                            <HumanScoreTable avg={humanAvg} />

                            {/* Individual raters */}
                            <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:5}}>
                              {scoresHumanRatings.map((r, i) => {
                                const vaKey = sharedEval.v1IsVA ? "v1" : "v2";
                                const vbKey = sharedEval.v1IsVA ? "v2" : "v1";
                                const tA = CRITERIA.reduce((s,c)=>s+(r.scores?.[vaKey]?.[c.key]?.score||0),0);
                                const tB = CRITERIA.reduce((s,c)=>s+(r.scores?.[vbKey]?.[c.key]?.score||0),0);
                                return (
                                  <div key={i} style={{fontSize:11,fontFamily:"monospace",color:C.muted,
                                    background:C.s2,border:`1px solid ${C.b}`,borderRadius:5,
                                    padding:"7px 11px",display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
                                    <span style={{color:C.text,minWidth:80}}>{r.rater_name || `Rater ${i+1}`}</span>
                                    <span>A: <span style={{color:C.blue}}>{tA}/40</span></span>
                                    <span>B: <span style={{color:C.accent}}>{tB}/40</span></span>
                                    <span style={{color:tB>tA?C.accent:tA>tB?C.blue:C.muted,fontSize:10}}>
                                      {tB>tA?"B preferred":tA>tB?"A preferred":"tie"} · Δ{Math.abs(tB-tA)}
                                    </span>
                                    <span style={{marginLeft:"auto",color:C.dim,fontSize:10}}>
                                      {new Date(r.created_at).toLocaleString()}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}
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

// ─── Reusable score table (AI) ─────────────────────────────────────────
function ScoreTable({ sc, totA, totB }) {
  return (
    <div style={{borderRadius:8,border:`1px solid ${C.b}`,overflow:"hidden",marginBottom:4}}>
      <div style={{display:"grid",gridTemplateColumns:"130px 1fr 1fr",background:C.s2,borderBottom:`1px solid ${C.b}`}}>
        <div style={{padding:"10px 13px",borderRight:`1px solid ${C.b}`,fontSize:10,fontFamily:"monospace",color:C.dim,textTransform:"uppercase",letterSpacing:"0.5px"}}>Rubric</div>
        <div style={{padding:"10px 13px",borderRight:`1px solid ${C.b}`,fontSize:10,fontFamily:"monospace",color:C.blue,fontWeight:600}}>VERSION A · Single Model</div>
        <div style={{padding:"10px 13px",fontSize:10,fontFamily:"monospace",color:C.accent,fontWeight:600}}>VERSION B · Reviewed</div>
      </div>
      {CRITERIA.map(({key,label,color})=>{
        const a=sc.vA?.[key], b=sc.vB?.[key];
        if(!a||!b) return null;
        const diff=b.score-a.score;
        return(
          <div key={key} style={{display:"grid",gridTemplateColumns:"130px 1fr 1fr",borderBottom:`1px solid ${C.b}`}}>
            <div style={{padding:"13px",borderRight:`1px solid ${C.b}`,background:C.s2,display:"flex",flexDirection:"column",gap:5,justifyContent:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:color,flexShrink:0}}/>
                <span style={{fontSize:12,fontWeight:600,color:C.text}}>{label}</span>
              </div>
              {diff!==0&&<span style={{fontSize:10,fontFamily:"monospace",paddingLeft:12,color:diff>0?C.accent:C.blue}}>
                {diff>0?`+${diff} → B`:`+${Math.abs(diff)} → A`}
              </span>}
            </div>
            {[{d:a,c:C.blue,br:true},{d:b,c:C.accent,br:false}].map(({d,c,br},i)=>(
              <div key={i} style={{padding:"13px",borderRight:br?`1px solid ${C.b}`:"none"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <span style={{fontSize:22,fontWeight:700,color:c,fontFamily:"monospace",lineHeight:1}}>{d.score}</span>
                  <div style={{flex:1,height:4,background:C.b,borderRadius:2,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${d.score*10}%`,background:c,borderRadius:2,transition:"width 1s ease 0.4s"}}/>
                  </div>
                  <span style={{fontSize:10,color:C.muted,fontFamily:"monospace"}}>/10</span>
                </div>
                {d.feedback&&<div style={{fontSize:12,color:C.text,lineHeight:1.7,opacity:0.85}}>{d.feedback}</div>}
              </div>
            ))}
          </div>
        );
      })}
      <div style={{display:"grid",gridTemplateColumns:"130px 1fr 1fr",background:C.s2}}>
        <div style={{padding:"11px 13px",borderRight:`1px solid ${C.b}`,fontSize:10,fontFamily:"monospace",color:C.dim,textTransform:"uppercase",letterSpacing:"0.5px",display:"flex",alignItems:"center"}}>Total</div>
        <div style={{padding:"11px 13px",borderRight:`1px solid ${C.b}`,display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:22,fontWeight:700,color:C.blue,fontFamily:"monospace"}}>{totA}</span>
          <span style={{fontSize:10,color:C.muted,fontFamily:"monospace"}}>/40</span>
        </div>
        <div style={{padding:"11px 13px",display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:22,fontWeight:700,color:C.accent,fontFamily:"monospace"}}>{totB}</span>
          <span style={{fontSize:10,color:C.muted,fontFamily:"monospace"}}>/40</span>
          <span style={{marginLeft:"auto",fontSize:11,fontFamily:"monospace",color:totB>totA?C.accent:totA>totB?C.blue:C.muted}}>
            {totB>totA?"B wins":totA>totB?"A wins":"tie"} · Δ{Math.abs(totB-totA)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Human avg score table ─────────────────────────────────────────────
function HumanScoreTable({ avg }) {
  if (!avg) return null;
  return (
    <div style={{borderRadius:8,border:`1px solid ${C.b}`,overflow:"hidden"}}>
      <div style={{display:"grid",gridTemplateColumns:"130px 1fr 1fr",background:C.s2,borderBottom:`1px solid ${C.b}`}}>
        <div style={{padding:"10px 13px",borderRight:`1px solid ${C.b}`,fontSize:10,fontFamily:"monospace",color:C.dim,textTransform:"uppercase",letterSpacing:"0.5px"}}>Rubric</div>
        <div style={{padding:"10px 13px",borderRight:`1px solid ${C.b}`,fontSize:10,fontFamily:"monospace",color:C.blue,fontWeight:600}}>VERSION A · avg</div>
        <div style={{padding:"10px 13px",fontSize:10,fontFamily:"monospace",color:C.accent,fontWeight:600}}>VERSION B · avg</div>
      </div>
      {CRITERIA.map(({key,label,color})=>{
        const a=avg.vA[key], b=avg.vB[key];
        const diff=Math.round((b-a)*10)/10;
        return(
          <div key={key} style={{display:"grid",gridTemplateColumns:"130px 1fr 1fr",borderBottom:`1px solid ${C.b}`}}>
            <div style={{padding:"11px 13px",borderRight:`1px solid ${C.b}`,background:C.s2,display:"flex",alignItems:"center",gap:6}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:color}}/>
              <span style={{fontSize:12,fontWeight:600,color:C.text}}>{label}</span>
              {diff!==0&&<span style={{fontSize:9,fontFamily:"monospace",marginLeft:4,color:diff>0?C.accent:C.blue}}>
                {diff>0?`+${diff}→B`:`+${Math.abs(diff)}→A`}
              </span>}
            </div>
            {[{v:a,c:C.blue,br:true},{v:b,c:C.accent,br:false}].map(({v,c,br},i)=>(
              <div key={i} style={{padding:"11px 13px",borderRight:br?`1px solid ${C.b}`:"none",display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:19,fontWeight:700,color:c,fontFamily:"monospace"}}>{v.toFixed(1)}</span>
                <div style={{flex:1,height:4,background:C.b,borderRadius:2,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${v*10}%`,background:c,borderRadius:2}}/>
                </div>
                <span style={{fontSize:10,color:C.muted,fontFamily:"monospace"}}>/10</span>
              </div>
            ))}
          </div>
        );
      })}
      <div style={{display:"grid",gridTemplateColumns:"130px 1fr 1fr",background:C.s2}}>
        <div style={{padding:"10px 13px",borderRight:`1px solid ${C.b}`,fontSize:10,fontFamily:"monospace",color:C.dim,textTransform:"uppercase",letterSpacing:"0.5px",display:"flex",alignItems:"center"}}>Avg Total</div>
        <div style={{padding:"10px 13px",borderRight:`1px solid ${C.b}`,display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:19,fontWeight:700,color:C.blue,fontFamily:"monospace"}}>{avg.totA.toFixed(1)}</span>
          <span style={{fontSize:10,color:C.muted,fontFamily:"monospace"}}>/40</span>
        </div>
        <div style={{padding:"10px 13px",display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:19,fontWeight:700,color:C.accent,fontFamily:"monospace"}}>{avg.totB.toFixed(1)}</span>
          <span style={{fontSize:10,color:C.muted,fontFamily:"monospace"}}>/40</span>
          <span style={{marginLeft:"auto",fontSize:11,fontFamily:"monospace",
            color:avg.totB>avg.totA?C.accent:avg.totA>avg.totB?C.blue:C.muted}}>
            {avg.totB>avg.totA?"B preferred":avg.totA>avg.totB?"A preferred":"tie"} · Δ{Math.abs(avg.totB-avg.totA).toFixed(1)}
          </span>
        </div>
      </div>
    </div>
  );
}
