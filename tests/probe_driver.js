const DRIVER = `
(async()=>{
  const src=drawPlayer.toString();
  // steam の 3キー判定が拾っている '1.12' は本当に3キーの式か？
  let idx=0, hits=[];
  while(true){ const i=src.indexOf('1.12', idx); if(i<0) break; idx=i+4;
    hits.push(src.slice(Math.max(0,i-70), i+20).replace(/\\n/g,' ')); }
  console.log('drawPlayer 内の 1.12 出現数: '+hits.length);
  hits.forEach(function(h,i){ console.log('  ['+i+'] ...'+h+'...'); });
  console.log('PROBE PASSED'); process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);
