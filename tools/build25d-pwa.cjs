'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),source=path.join(root,'inu25d/pwa'),out=path.join(root,'inu25d/app'),read=n=>fs.readFileSync(path.join(source,n),'utf8').replace(/\r\n/g,'\n'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');fs.mkdirSync(out,{recursive:true});
let r=spawnSync(process.execPath,[path.join(root,'tools/pwa25d-icons.cjs')],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'innu-pwa-')),gameFile=path.join(temp,'game.html');let game;
try{r=spawnSync(process.execPath,[path.join(root,'tools/build25d.js'),'--offline','--out',gameFile],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);game=fs.readFileSync(gameFile,'utf8').replace(/\r\n/g,'\n');}finally{if(fs.existsSync(gameFile))fs.unlinkSync(gameFile);fs.rmdirSync(temp);}
const iconNames=['apple-touch-icon.png','icon-192.png','icon-512.png','icon.svg','maskable-512.png'];
const names=['runtime.js','sw.template.js','manifest.template.json','page.template.html','landing.html','install.html','offline.html'];const inputs=[Buffer.from(fs.readFileSync(__filename,'utf8').replace(/\r\n/g,'\n')),Buffer.from(fs.readFileSync(path.join(root,'tools/pwa25d-icons.cjs'),'utf8').replace(/\r\n/g,'\n')),Buffer.from(game),...names.map(n=>Buffer.from(read(n))),...iconNames.map(n=>fs.readFileSync(path.join(out,'icons',n)))];const version=hash(Buffer.concat(inputs)),runtime=read('runtime.js').replace('@@VERSION@@',JSON.stringify(version));
new (require('node:vm').Script)(runtime);
const script='<script>'+runtime+'</script>',head='<meta name="innu-app-build" content="'+version+'"><link rel="manifest" href="./app.webmanifest"><link rel="apple-touch-icon" href="./icons/apple-touch-icon.png"><link rel="icon" href="./icons/icon-192.png">';
game=game.replace('</head>',head+'</head>').replace('</body>',script+'</body>');fs.writeFileSync(path.join(out,'game.html'),game);
for(const [name,fragment,title]of [['index.html','landing.html','もふもふイッヌ アプリ'],['install.html','install.html','ホーム画面に追加'],['offline.html','offline.html','接続を確認してください']]){
 const html=read('page.template.html').replace('@@TITLE@@',title).replace('@@BODY@@',read(fragment)).replace('@@RUNTIME@@',script);fs.writeFileSync(path.join(out,name),html);}
fs.writeFileSync(path.join(out,'app.webmanifest'),read('manifest.template.json'));
const files=['game.html','index.html','install.html','offline.html','app.webmanifest',...iconNames.map(n=>'icons/'+n)].map(p=>({path:p,sha256:hash(fs.readFileSync(path.join(out,p)))}));
fs.writeFileSync(path.join(out,'version.json'),JSON.stringify({version,game:files.find(f=>f.path==='game.html').sha256},null,2)+'\n');
const worker=read('sw.template.js').replace('@@VERSION@@',JSON.stringify(version)).replace('@@FILES@@',JSON.stringify(files));new (require('node:vm').Script)(worker);fs.writeFileSync(path.join(out,'sw.js'),worker);
fs.writeFileSync(path.join(out,'.gitattributes'),'* text eol=lf\n*.png binary\n');
console.log(JSON.stringify({version,assets:files.length,gameBytes:Buffer.byteLength(game),output:'inu25d/app/',base:'polish and provisional Cham/companion candidate based on public752; kosodoro pending; game coins only'},null,2));
