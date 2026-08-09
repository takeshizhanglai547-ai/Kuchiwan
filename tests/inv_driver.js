const DRIVER = `
(async()=>{
  const step=(n)=>{ for(let i=0;i<n;i++){ if(global.rafCb){ const cb=global.rafCb; global.rafCb=null; cb(); } } };
  setupRoster('inu'); startGame(); state='play';
  const p=players[0]; player=p; p.level=16; p.atkMul=1; p.x=camX+400; p.facing=1;
  p.hp=p.maxHp=99999; p.dim=3; p.invuln=0;
  enemies.length=0; encounters.length=0; particles.length=0;
  beginAttack('charge3');
  let prev=0, n=0;
  while(p.state==='attack' && n<140){
    n++; hitStop=0; slowmo=0; step(1);
    if(p.invuln>prev) console.log('F'+n+' t='+(p.atk?p.atk.t:'-')+' hold='+(p.atk?p.atk.hold:'-')+' invuln '+prev+' -> '+p.invuln);
    prev=p.invuln;
  }
  console.log('done n='+n);
  process.exit(0);
})().catch(e=>{ console.error('FAIL:', e.message); process.exit(1); });
`;
code = code + "\n;" + DRIVER;
(0, eval)(code);
