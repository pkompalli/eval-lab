import { useState, useEffect } from 'react';
import supabase from './supabase';

const CRITERIA = [
  { key:"accuracy",  label:"Accuracy",   desc:"Clinical & factual correctness — no errors, outdated info, or misleading claims",              color:"#5aabf0" },
  { key:"clarity",   label:"Clarity",    desc:"Teaching effectiveness — structure, explanation quality & logical flow of concepts",            color:"#a78bfa" },
  { key:"retention", label:"Retention",  desc:"Memorability — hooks, patterns & anchors that aid recall under exam pressure",                  color:"#f0b34a" },
  { key:"examYield", label:"Exam-Yield", desc:"High-yield focus — prioritises what the target exam actually tests, right depth & format",      color:"#00c896" },
];

const C = {
  bg:"#07090d", surface:"#0d1117", s2:"#111820",
  b:"#1e2d40", bh:"#2a3f58",
  accent:"#00c896",
  text:"#e8f2ff", muted:"#7fa8cc", dim:"#3d5470",
  blue:"#6ab8f7", red:"#fc8585",
};

function initScores() {
  return Object.fromEntries(CRITERIA.map(c => [c.key, { score: '', comment: '' }]));
}

export default function BatchRatingView({ evalIds }) {
  // Parse "uuid:flip" strings — flip=1 means swap v1/v2 display for that eval
  const parsedIds = evalIds.map(s => {
    const [id, flip] = s.split(":");
    return { id, flip: flip === "1" };
  });

  const [evals,      setEvals]      = useState([]);
  const [activeType, setActiveType] = useState(null);
  const [idxByType,  setIdxByType]  = useState({});
  const [allScores,  setAllScores]  = useState({});
  const [raterName,  setRaterName]  = useState('');
  const [submitted,  setSubmitted]  = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [fetchErr,   setFetchErr]   = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr,  setSubmitErr]  = useState(null);

  useEffect(() => {
    supabase.from('evals')
      .select('id,topic,content_type,exam,blind')
      .in('id', parsedIds.map(p => p.id))
      .then(({ data, error }) => {
        if (error) { setFetchErr(error.message); setLoading(false); return; }
        // preserve URL order (already shuffled by sharer)
        const ordered = parsedIds.map(({ id }) => data.find(e => e.id === id)).filter(Boolean);
        setEvals(ordered);
        const init = {};
        ordered.forEach(e => { init[e.id] = { v1: initScores(), v2: initScores() }; });
        setAllScores(init);
        const types = [...new Set(ordered.map(e => e.content_type))];
        setActiveType(types[0] || null);
        setIdxByType(Object.fromEntries(types.map(t => [t, 0])));
        setLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setField = (evalId, ver, criterion, field, value) =>
    setAllScores(s => ({
      ...s,
      [evalId]: {
        ...s[evalId],
        [ver]: { ...s[evalId][ver], [criterion]: { ...s[evalId][ver][criterion], [field]: value } }
      }
    }));

  const isEvalValid = (e) => e && allScores[e.id] && CRITERIA.every(c => {
    const s1 = Number(allScores[e.id]?.v1[c.key]?.score);
    const s2 = Number(allScores[e.id]?.v2[c.key]?.score);
    return s1 >= 1 && s1 <= 10 && s2 >= 1 && s2 <= 10;
  });

  const types        = [...new Set(evals.map(e => e.content_type))];
  const typeEvals    = evals.filter(e => e.content_type === activeType);
  const currentIdx   = idxByType[activeType] ?? 0;
  const setCurrentIdx = (fn) => setIdxByType(prev => ({ ...prev, [activeType]: typeof fn === 'function' ? fn(prev[activeType] ?? 0) : fn }));
  const currentEval    = typeEvals[currentIdx];
  const currentFlip    = parsedIds.find(p => p.id === currentEval?.id)?.flip || false;
  const isCurrentValid = isEvalValid(currentEval);
  const isAllValid     = evals.length > 0 && evals.every(e => isEvalValid(e));
  const isLast         = currentIdx === typeEvals.length - 1;

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitErr(null);
    const rows = evals.map(e => {
      const flip = parsedIds.find(p => p.id === e.id)?.flip || false;
      // If flipped, user's "v1" input corresponds to actual v2_text and vice versa — unflip before storing
      const raw = allScores[e.id];
      const [dbV1, dbV2] = flip ? [raw.v2, raw.v1] : [raw.v1, raw.v2];
      return {
        eval_id:    e.id,
        rater_name: raterName.trim() || null,
        scores: {
          v1: Object.fromEntries(CRITERIA.map(c => [c.key, { score: Number(dbV1[c.key].score), comment: dbV1[c.key].comment }])),
          v2: Object.fromEntries(CRITERIA.map(c => [c.key, { score: Number(dbV2[c.key].score), comment: dbV2[c.key].comment }])),
        },
      };
    });
    const { error } = await supabase.from('human_ratings').insert(rows);
    if (error) { setSubmitErr(error.message); setSubmitting(false); }
    else setSubmitted(true);
  };

  // ── States ──────────────────────────────────────────────────────────
  if (loading) return (
    <Shell><span style={{color:C.muted,fontFamily:'monospace',fontSize:13}}>Loading evals...</span></Shell>
  );
  if (fetchErr) return (
    <Shell><span style={{color:C.red,fontFamily:'monospace',fontSize:13}}>Error: {fetchErr}</span></Shell>
  );
  if (submitted) return (
    <Shell>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:26,fontWeight:700,color:C.accent,marginBottom:8}}>
          All {evals.length} rating{evals.length !== 1 ? 's' : ''} submitted
        </div>
        <div style={{fontSize:14,color:C.muted}}>Thank you for your evaluation.</div>
      </div>
    </Shell>
  );
  if (!currentEval) return (
    <Shell><span style={{color:C.muted,fontFamily:'monospace',fontSize:13}}>No evals found.</span></Shell>
  );

  const scores = allScores[currentEval.id] || { v1: initScores(), v2: initScores() };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none}
        input[type=number]{-moz-appearance:textfield}
        input:focus,textarea:focus{outline:2px solid #00c89655}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#243650;border-radius:2px}
      `}</style>

      <div style={{minHeight:'100vh',background:C.bg,color:C.text,fontFamily:"'Sora',sans-serif",padding:'24px 16px 60px'}}>
        <div style={{maxWidth:900,margin:'0 auto'}}>

          {/* Header */}
          <div style={{marginBottom:20}}>
            <h1 style={{fontSize:22,fontWeight:700,letterSpacing:'-0.4px',marginBottom:12}}>
              Rate Medical Content
            </h1>

            {/* Type toggle — only shown when batch has both types */}
            {types.length > 1 && (
              <div style={{display:'flex',gap:6,marginBottom:12}}>
                {types.map(t => {
                  const tEvals   = evals.filter(e => e.content_type === t);
                  const tRated   = tEvals.filter(e => isEvalValid(e)).length;
                  const isActive = t === activeType;
                  return (
                    <button key={t} onClick={() => setActiveType(t)} style={{
                      padding:'5px 14px', borderRadius:6, fontSize:12, fontFamily:'monospace',
                      border:`1px solid ${isActive ? C.accent : C.b}`,
                      background:isActive ? 'rgba(0,200,150,0.08)' : 'transparent',
                      color:isActive ? C.accent : C.muted, cursor:'pointer',
                    }}>
                      {t === 'MCQ' ? 'MCQs' : 'Lessons'}
                      <span style={{marginLeft:6,color:tRated===tEvals.length?C.accent:C.dim}}>
                        {tRated}/{tEvals.length}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Progress dots */}
            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:10}}>
              {typeEvals.map((e, i) => {
                const isRated   = isEvalValid(e);
                const isCurrent = i === currentIdx;
                return (
                  <div key={e.id} onClick={() => setCurrentIdx(i)} style={{
                    width:   isCurrent ? 10 : 8,
                    height:  isCurrent ? 10 : 8,
                    borderRadius: '50%',
                    background:   isRated ? C.accent : isCurrent ? 'transparent' : C.dim,
                    border:       isCurrent ? `2px solid ${C.accent}` : 'none',
                    cursor:       'pointer',
                    transition:   'all 0.2s',
                    flexShrink:   0,
                  }}/>
                );
              })}
              <span style={{fontSize:12,fontFamily:'monospace',color:C.muted,marginLeft:4}}>
                Eval {currentIdx + 1} of {typeEvals.length}
              </span>
            </div>

            <div style={{display:'flex',gap:9,flexWrap:'wrap',alignItems:'center',marginBottom:8}}>
              <span style={{fontSize:15,color:C.text,fontWeight:600}}>{currentEval.topic}</span>
              <span style={{color:C.dim}}>·</span>
              <span style={{fontSize:12.5,color:C.accent,fontFamily:'monospace'}}>{currentEval.exam}</span>
              <span style={{color:C.dim}}>·</span>
              <span style={{fontSize:12.5,color:C.muted,fontFamily:'monospace'}}>{currentEval.content_type}</span>
            </div>
            <p style={{fontSize:13.5,color:C.muted,lineHeight:1.65}}>
              Read both versions carefully, then score each independently using the rubric below.
              You will not know which version was generated how — this is intentional.
            </p>
          </div>

          {/* Two content panels — order determined by per-link flip */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:20}}>
            {[
              { label:'VERSION 1', text: currentFlip ? currentEval.blind.v2_text : currentEval.blind.v1_text },
              { label:'VERSION 2', text: currentFlip ? currentEval.blind.v1_text : currentEval.blind.v2_text },
            ].map(({label,text}) => (
              <div key={label}>
                <div style={{fontSize:12,fontFamily:'monospace',color:C.blue,marginBottom:8,fontWeight:600,letterSpacing:'0.5px'}}>{label}</div>
                <div style={{background:C.surface,border:`1px solid ${C.b}`,borderRadius:8,padding:16,fontSize:14,lineHeight:1.85,color:C.text,whiteSpace:'pre-wrap',maxHeight:360,overflowY:'auto'}}>{text}</div>
              </div>
            ))}
          </div>

          {/* Rating table */}
          <div style={{background:C.surface,border:`1px solid ${C.b}`,borderRadius:10,overflow:'hidden',marginBottom:14}}>
            <div style={{padding:'12px 16px',borderBottom:`1px solid ${C.b}`,background:C.s2}}>
              <span style={{fontSize:14,fontWeight:600,color:C.text}}>Your Ratings</span>
              <span style={{fontSize:12.5,color:C.muted,marginLeft:10}}>Score 1–10 · comments optional</span>
            </div>

            {/* Table header */}
            <div style={{display:'grid',gridTemplateColumns:'140px 1fr 1fr',background:C.s2,borderBottom:`1px solid ${C.b}`}}>
              <div style={{padding:'11px 14px',borderRight:`1px solid ${C.b}`,fontSize:11,fontFamily:'monospace',color:C.muted,textTransform:'uppercase',letterSpacing:'0.5px'}}>Rubric</div>
              <div style={{padding:'11px 14px',borderRight:`1px solid ${C.b}`,fontSize:12,fontFamily:'monospace',color:C.blue,fontWeight:600}}>VERSION 1</div>
              <div style={{padding:'11px 14px',fontSize:12,fontFamily:'monospace',color:C.blue,fontWeight:600}}>VERSION 2</div>
            </div>

            {CRITERIA.map(({ key, label, desc, color }) => (
              <div key={key} style={{display:'grid',gridTemplateColumns:'140px 1fr 1fr',borderBottom:`1px solid ${C.b}`}}>
                <div style={{padding:'13px',borderRight:`1px solid ${C.b}`,background:C.s2,display:'flex',flexDirection:'column',gap:4,justifyContent:'center'}}>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <div style={{width:6,height:6,borderRadius:'50%',background:color,flexShrink:0}}/>
                    <span style={{fontSize:13.5,fontWeight:600,color:C.text}}>{label}</span>
                  </div>
                  <span style={{fontSize:11.5,color:C.muted,paddingLeft:12,lineHeight:1.4}}>{desc}</span>
                </div>
                {['v1','v2'].map((ver, i) => (
                  <div key={ver} style={{padding:'13px',borderRight:i===0?`1px solid ${C.b}`:'none'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                      <input
                        type="number" min="1" max="10"
                        value={scores[ver][key].score}
                        onChange={e => setField(currentEval.id, ver, key, 'score', e.target.value)}
                        placeholder="–"
                        style={{
                          width:54,padding:'6px 7px',borderRadius:6,textAlign:'center',
                          border:`1px solid ${scores[ver][key].score ? C.bh : C.b}`,
                          background:C.bg,color:C.text,fontSize:19,fontWeight:700,
                          fontFamily:'monospace',
                        }}
                      />
                      <div style={{flex:1,height:4,background:C.b,borderRadius:2,overflow:'hidden'}}>
                        <div style={{height:'100%',borderRadius:2,background:color,
                          width:`${(Number(scores[ver][key].score)||0)*10}%`,transition:'width 0.2s'}}/>
                      </div>
                      <span style={{fontSize:10,color:C.dim,fontFamily:'monospace'}}>/10</span>
                    </div>
                    <textarea
                      value={scores[ver][key].comment}
                      onChange={e => setField(currentEval.id, ver, key, 'comment', e.target.value)}
                      placeholder="Comment (optional)"
                      rows={2}
                      style={{width:'100%',background:C.bg,border:`1px solid ${C.b}`,borderRadius:6,
                        padding:'6px 9px',color:C.text,fontSize:11.5,resize:'none',lineHeight:1.5,
                        fontFamily:"'Sora',sans-serif"}}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* Navigation + submit row */}
          <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
            <button
              onClick={() => setCurrentIdx(i => Math.max(0, i - 1))}
              disabled={currentIdx === 0}
              style={{
                padding:'8px 18px',borderRadius:7,
                border:`1px solid ${C.b}`,background:'transparent',
                color:currentIdx===0?C.dim:C.text,
                fontSize:13,cursor:currentIdx===0?'not-allowed':'pointer',
              }}
            >← Previous</button>

            <div style={{flex:1}}/>

            <input
              type="text"
              value={raterName}
              onChange={e => setRaterName(e.target.value)}
              placeholder="Your name (optional)"
              style={{
                minWidth:180,padding:'8px 12px',borderRadius:7,
                border:`1px solid ${C.b}`,background:C.surface,color:C.text,
                fontSize:13,fontFamily:"'Sora',sans-serif",
              }}
            />

            {isLast ? (
              <button
                onClick={handleSubmit}
                disabled={!isAllValid || submitting}
                style={{
                  padding:'8px 24px',borderRadius:7,border:'none',
                  background:isAllValid&&!submitting ? C.accent : C.dim,
                  color:isAllValid&&!submitting ? '#000' : C.muted,
                  fontSize:13,fontWeight:700,
                  cursor:isAllValid&&!submitting ? 'pointer' : 'not-allowed',
                }}
              >{submitting ? 'Submitting...' : `Submit All ${evals.length} Rating${evals.length !== 1 ? 's' : ''} →`}</button>
            ) : (
              <button
                onClick={() => setCurrentIdx(i => Math.min(evals.length - 1, i + 1))}
                disabled={!isCurrentValid}
                title={!isCurrentValid ? 'Fill all 8 scores to continue' : ''}
                style={{
                  padding:'8px 18px',borderRadius:7,border:'none',
                  background:isCurrentValid ? C.accent : C.dim,
                  color:isCurrentValid ? '#000' : C.muted,
                  fontSize:13,fontWeight:700,
                  cursor:isCurrentValid ? 'pointer' : 'not-allowed',
                }}
              >Next Eval →</button>
            )}
          </div>

          {!isCurrentValid && (
            <div style={{fontSize:11,color:C.muted,marginTop:6,fontFamily:'monospace',textAlign:'right'}}>
              Fill all 8 scores (1–10) to continue.
            </div>
          )}
          {isLast && isCurrentValid && !isAllValid && (
            <div style={{fontSize:11,color:C.muted,marginTop:6,fontFamily:'monospace',textAlign:'right'}}>
              Some earlier evals have incomplete scores — go back and fill them to submit.
            </div>
          )}
          {submitErr && (
            <div style={{fontSize:11,color:C.red,marginTop:6,fontFamily:'monospace'}}>Error: {submitErr}</div>
          )}

        </div>
      </div>
    </>
  );
}

function Shell({ children }) {
  return (
    <div style={{minHeight:'100vh',background:'#07090d',color:'#dce8f5',
      display:'flex',alignItems:'center',justifyContent:'center',
      fontFamily:"'Sora',sans-serif"}}>
      {children}
    </div>
  );
}
