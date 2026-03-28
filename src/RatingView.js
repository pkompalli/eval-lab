import { useState, useEffect } from 'react';
import supabase from './supabase';

const CRITERIA = [
  { key:"quality",       label:"Quality",     desc:"Factual accuracy & clinical correctness", color:"#5aabf0" },
  { key:"usefulness",    label:"Usefulness",  desc:"Practical study value for the exam",       color:"#a78bfa" },
  { key:"absorption",    label:"Absorption",  desc:"Clarity, structure & memorability",        color:"#f0b34a" },
  { key:"examReadiness", label:"Exam-Ready",  desc:"Alignment with exam patterns & high-yield",color:"#00c896" },
];

const C = {
  bg:"#07090d", surface:"#0d1117", s2:"#111820",
  b:"#1a2535", bh:"#243650",
  accent:"#00c896",
  text:"#dce8f5", muted:"#5a7390", dim:"#2d4057",
  blue:"#5aabf0", red:"#f87171",
};

function initScores() {
  return Object.fromEntries(CRITERIA.map(c => [c.key, { score: '', comment: '' }]));
}

export default function RatingView({ evalId }) {
  const [evalData, setEvalData]   = useState(null);
  const [raterName, setRaterName] = useState('');
  const [scores, setScores]       = useState({ v1: initScores(), v2: initScores() });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [fetchErr, setFetchErr]   = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState(null);

  useEffect(() => {
    supabase
      .from('evals')
      .select('id,topic,content_type,exam,blind')
      .eq('id', evalId)
      .single()
      .then(({ data, error }) => {
        if (error) setFetchErr(error.message);
        else setEvalData(data);
        setLoading(false);
      });
  }, [evalId]);

  const setField = (ver, criterion, field, value) =>
    setScores(s => ({
      ...s,
      [ver]: { ...s[ver], [criterion]: { ...s[ver][criterion], [field]: value } }
    }));

  const isValid = CRITERIA.every(c => {
    const s1 = Number(scores.v1[c.key]?.score);
    const s2 = Number(scores.v2[c.key]?.score);
    return s1 >= 1 && s1 <= 10 && s2 >= 1 && s2 <= 10;
  });

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitErr(null);
    const parsed = {
      v1: Object.fromEntries(CRITERIA.map(c => [c.key, { score: Number(scores.v1[c.key].score), comment: scores.v1[c.key].comment }])),
      v2: Object.fromEntries(CRITERIA.map(c => [c.key, { score: Number(scores.v2[c.key].score), comment: scores.v2[c.key].comment }])),
    };
    const { error } = await supabase.from('human_ratings').insert({
      eval_id: evalId,
      rater_name: raterName.trim() || null,
      scores: parsed,
    });
    if (error) { setSubmitErr(error.message); setSubmitting(false); }
    else setSubmitted(true);
  };

  // ── Loading / Error / Done states ──────────────────────────────
  if (loading) return (
    <Shell><span style={{color:C.muted,fontFamily:'monospace',fontSize:13}}>Loading eval...</span></Shell>
  );
  if (fetchErr) return (
    <Shell><span style={{color:C.red,fontFamily:'monospace',fontSize:13}}>Error: {fetchErr}</span></Shell>
  );
  if (submitted) return (
    <Shell>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:26,fontWeight:700,color:C.accent,marginBottom:8}}>Ratings submitted</div>
        <div style={{fontSize:14,color:C.muted}}>Thank you for your evaluation.</div>
      </div>
    </Shell>
  );

  // ── Main rating page ────────────────────────────────────────────
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
            <h1 style={{fontSize:17,fontWeight:700,letterSpacing:'-0.3px',marginBottom:7}}>
              Rate Medical Content
            </h1>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:6}}>
              <span style={{fontSize:13,color:C.text,fontWeight:600}}>{evalData.topic}</span>
              <span style={{color:C.dim}}>·</span>
              <span style={{fontSize:11,color:C.accent,fontFamily:'monospace'}}>{evalData.exam}</span>
              <span style={{color:C.dim}}>·</span>
              <span style={{fontSize:11,color:C.muted,fontFamily:'monospace'}}>{evalData.content_type}</span>
            </div>
            <p style={{fontSize:12,color:C.dim,lineHeight:1.6}}>
              Read both versions carefully, then score each independently using the rubric below.
              You will not know which version was generated how — this is intentional.
            </p>
          </div>

          {/* Two content panels */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:20}}>
            {[
              { label:'VERSION 1', text: evalData.blind.v1_text },
              { label:'VERSION 2', text: evalData.blind.v2_text },
            ].map(({label,text}) => (
              <div key={label}>
                <div style={{fontSize:10,fontFamily:'monospace',color:C.blue,marginBottom:7,fontWeight:600,letterSpacing:'0.5px'}}>{label}</div>
                <div style={{background:C.surface,border:`1px solid ${C.b}`,borderRadius:8,padding:14,fontSize:12.5,lineHeight:1.8,color:C.text,whiteSpace:'pre-wrap',maxHeight:320,overflowY:'auto'}}>{text}</div>
              </div>
            ))}
          </div>

          {/* Rating table */}
          <div style={{background:C.surface,border:`1px solid ${C.b}`,borderRadius:10,overflow:'hidden',marginBottom:14}}>
            <div style={{padding:'12px 16px',borderBottom:`1px solid ${C.b}`,background:C.s2}}>
              <span style={{fontSize:12.5,fontWeight:600,color:C.text}}>Your Ratings</span>
              <span style={{fontSize:11,color:C.muted,marginLeft:10}}>Score 1–10 · comments optional</span>
            </div>

            {/* Table header */}
            <div style={{display:'grid',gridTemplateColumns:'140px 1fr 1fr',background:C.s2,borderBottom:`1px solid ${C.b}`}}>
              <div style={{padding:'9px 13px',borderRight:`1px solid ${C.b}`,fontSize:10,fontFamily:'monospace',color:C.dim,textTransform:'uppercase',letterSpacing:'0.5px'}}>Rubric</div>
              <div style={{padding:'9px 13px',borderRight:`1px solid ${C.b}`,fontSize:10,fontFamily:'monospace',color:C.blue,fontWeight:600}}>VERSION 1</div>
              <div style={{padding:'9px 13px',fontSize:10,fontFamily:'monospace',color:C.blue,fontWeight:600}}>VERSION 2</div>
            </div>

            {CRITERIA.map(({ key, label, desc, color }) => (
              <div key={key} style={{display:'grid',gridTemplateColumns:'140px 1fr 1fr',borderBottom:`1px solid ${C.b}`}}>
                {/* Criterion label */}
                <div style={{padding:'13px',borderRight:`1px solid ${C.b}`,background:C.s2,display:'flex',flexDirection:'column',gap:4,justifyContent:'center'}}>
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <div style={{width:6,height:6,borderRadius:'50%',background:color,flexShrink:0}}/>
                    <span style={{fontSize:12,fontWeight:600,color:C.text}}>{label}</span>
                  </div>
                  <span style={{fontSize:10,color:C.dim,paddingLeft:12,lineHeight:1.4}}>{desc}</span>
                </div>
                {/* Score + comment cells */}
                {['v1','v2'].map((ver, i) => (
                  <div key={ver} style={{padding:'13px',borderRight:i===0?`1px solid ${C.b}`:'none'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                      <input
                        type="number" min="1" max="10"
                        value={scores[ver][key].score}
                        onChange={e => setField(ver, key, 'score', e.target.value)}
                        placeholder="–"
                        style={{
                          width:50,padding:'5px 6px',borderRadius:6,textAlign:'center',
                          border:`1px solid ${scores[ver][key].score ? C.bh : C.b}`,
                          background:C.bg,color:C.text,fontSize:17,fontWeight:700,
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
                      onChange={e => setField(ver, key, 'comment', e.target.value)}
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

          {/* Rater name + submit */}
          <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
            <input
              type="text"
              value={raterName}
              onChange={e => setRaterName(e.target.value)}
              placeholder="Your name (optional)"
              style={{flex:1,minWidth:200,padding:'8px 12px',borderRadius:7,
                border:`1px solid ${C.b}`,background:C.surface,color:C.text,
                fontSize:13,fontFamily:"'Sora',sans-serif"}}
            />
            <button
              onClick={handleSubmit}
              disabled={!isValid || submitting}
              style={{padding:'8px 24px',borderRadius:7,border:'none',
                background:isValid&&!submitting ? C.accent : C.dim,
                color:isValid&&!submitting ? '#000' : C.muted,
                fontSize:13,fontWeight:700,cursor:isValid&&!submitting?'pointer':'not-allowed'}}
            >{submitting ? 'Submitting...' : 'Submit Ratings →'}</button>
          </div>
          {!isValid && (
            <div style={{fontSize:11,color:C.muted,marginTop:6,fontFamily:'monospace'}}>
              All 8 scores (1–10) required before submitting.
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
