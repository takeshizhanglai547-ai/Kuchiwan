const { chromium } = require('playwright'); const path=require('path');
const OUT=process.argv[3]; const url='file://'+path.resolve(process.argv[2]);
const SETS=JSON.parse(process.argv[4]);
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const pg=await b.newPage({viewport:{width:1000,height:620},deviceScaleFactor:1});
  pg.on('pageerror',e=>console.log('ERR',String(e)));
  await pg.goto(url); await pg.waitForTimeout(1000);
  await pg.evaluate(()=>{ startGame(); }); await pg.waitForTimeout(2600);
  await pg.evaluate(()=>{ hitStop=99999; });
  for(const s of SETS){
    await pg.evaluate(o=>{ Object.assign(PX,o); }, s.o);
    await pg.waitForTimeout(120);
    await pg.locator('#game').screenshot({path:`${OUT}/sw_${s.n}.png`});
  }
  await b.close();
})();
