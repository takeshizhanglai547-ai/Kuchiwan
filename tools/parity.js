// 本編とドット絵版へ同じ乱数・同じ入力を与えて、ゲームの状態が一致するかを見る。
//   node tools/parity.js
// ドット絵版は描画だけを差し替えたはずなので、900フレーム後の状態がずれたら
// 「描画層がゲームの状態を触っている」ことになる＝欠陥。
//
// 乱数は「フレーム番号 × そのフレーム内の呼び出し番号」で決まる純関数にすること。
// 1本の連番にすると、描画側が rnd を引く回数の違いだけで次フレームの更新が
// ずれて、ロジックの差と見分けがつかなくなる（実際に最初そうなった）。
const {execSync}=require('child_process');
const fs=require('fs'), path=require('path'), os=require('os');
const DRIVER = `
(async()=>{
  // 乱数は「フレーム番号 × そのフレーム内の呼び出し番号」だけで決まる純関数にする。
  // 1本の連番にすると、描画側が引く回数の違い（ドット絵版は rnd の使い方が変わる）が
  // 次フレームの更新処理まで押し流してしまい、ロジックの差と見分けがつかなくなる
  let __f=0, __i=0;
  Math.random=function(){ const v=Math.sin((__f+1)*12.9898+(__i++)*78.233)*43758.5453; return v-Math.floor(v); };
  sndOn=false; setupRoster('inu'); startGame(); state='play';
  // 入力はプレイヤーごとの p.in に入っていて、update が useInput でそこから読む。
  // グローバルの K に書いても毎フレーム上書きされるので、p.in.K を直接動かす
  const IN=players[0].in;
  const seq=['right','right','atk','right','atk','up','atk','left','grd','atk'];
  for(let f=0; f<900; f++){
    for(const k in IN.K) IN.K[k]=false;
    for(const k in IN.pressed) IN.pressed[k]=false;
    const a=seq[(f>>4)%seq.length];
    IN.K[a]=true;
    if(f%16===0 && (a==='atk'||a==='grab')) IN.pressed[a]=true;
    __f=f; __i=0;                       // フレーム頭で呼び出し番号を戻す
    if(typeof rafCb==='function' && rafCb) rafCb(); else update();
  }
  const p=players[0];
  console.log('PARITY '+JSON.stringify({ hp:Math.round(p.hp), x:Math.round(p.x), y:Math.round(p.y),
    z:Math.round(p.z), lv:p.level, foes:enemies.length, gf:gf, rframe:(typeof rframe!=='undefined'?rframe:-1),
    combo:combo.count, camX:Math.round(camX),
    foeSum:Math.round(enemies.reduce((s,e)=>s+e.x+e.y+e.hp,0)) }));
  process.exit(0);
})().catch(e=>{ console.error('DRIVER-FAIL:', e.message); process.exit(1); });
`;
function run(target){
  const f = path.join(os.tmpdir(), 'par_'+Math.random().toString(36).slice(2)+'.js');
  fs.writeFileSync(f, fs.readFileSync('tests/nm_head.js','utf8') + '\ncode = code + "\\n;" + ' + JSON.stringify(DRIVER) + ';\n(0, eval)(code);\n');
  try {
    const out = execSync('node '+f, {env:{...process.env, NM_TARGET:target}, encoding:'utf8', timeout:300000});
    const m = out.match(/PARITY (.*)/); return m ? m[1] : 'NO-PARITY-LINE';
  } catch(e){ return 'ERROR: '+String(e.stdout||'').trim().split('\n').slice(-2).join(' | ')+String(e.stderr||'').trim().split('\n').slice(-2).join(' | '); }
  finally { try{fs.unlinkSync(f);}catch(_){} }
}
const a = run('/home/user/Kuchiwan/beltaction.html');
const b = run('/home/user/Kuchiwan/beltaction_pixel.html');
console.log('本編      : '+a);
console.log('ドット絵版: '+b);
const ok = a===b && a.indexOf('ERROR')<0 && a.indexOf('NO-PARITY')<0;
console.log(ok ? '\n900フレーム同一入力で状態が完全一致 — 描画層はゲームの状態を触っていない'
               : '\n一致していない、または測れていない');
