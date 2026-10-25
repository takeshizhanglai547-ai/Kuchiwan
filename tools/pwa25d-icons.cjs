'use strict';
// Rasterize the existing project's SVG.paw ellipses, with no external dependency.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),out=path.join(root,'inu25d/app/icons');fs.mkdirSync(out,{recursive:true});
const ellipses=[[12,15.8,5.4,4.6,0],[4.9,10.2,2.3,2.9,-18],[9.2,5.6,2.3,3,0],[14.8,5.6,2.3,3,0],[19.1,10.2,2.3,2.9,18]].map(([x,y,rx,ry,a])=>({x,y,rx,ry,c:Math.cos(a*Math.PI/180),s:Math.sin(a*Math.PI/180)}));
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(name,data){const type=Buffer.from(name),b=Buffer.concat([type,data]);let crc=0xffffffff;for(const v of b)crc=table[(crc^v)&255]^(crc>>>8);const h=Buffer.alloc(4),t=Buffer.alloc(4);h.writeUInt32BE(data.length);t.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([h,b,t]);}
function png(size){const scan=Buffer.alloc((size*4+1)*size);for(let y=0;y<size;y++)for(let x=0;x<size;x++){
 const sum=[0,0,0];for(let sy=0;sy<3;sy++)for(let sx=0;sx<3;sx++){const u=(x+(sx+.5)/3)/size,v=(y+(sy+.5)/3)/size,d=Math.hypot(u-.5,v-.5);let color=[127*(1-v)+25*v,200*(1-v)+70*v,255*(1-v)+110*v];
  if(d<.425)color=[255,210,77];if(d<.395)color=[21,55,79];const px=(u-.5)/.72*24+12,py=(v-.5)/.72*24+12;
  if(ellipses.some(e=>{const dx=px-e.x,dy=py-e.y;return ((dx*e.c+dy*e.s)/e.rx)**2+((-dx*e.s+dy*e.c)/e.ry)**2<=1;}))color=[255,246,216];for(let i=0;i<3;i++)sum[i]+=color[i];}
 const i=y*(size*4+1)+1+x*4;for(let c=0;c<3;c++)scan[i+c]=Math.round(sum[c]/9);scan[i+3]=255;}
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);}
for(const [name,size]of [['icon-192.png',192],['icon-512.png',512],['maskable-512.png',512],['apple-touch-icon.png',180]])fs.writeFileSync(path.join(out,name),png(size));
const paw=fs.readFileSync(path.join(root,'inu25d/src/80_ui.js'),'utf8').match(/paw:'<svg[^>]*>(.*?)<\/svg>'/)[1];
fs.writeFileSync(path.join(out,'icon.svg'),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#7fc8ff"/><circle cx="256" cy="256" r="218" fill="#ffd24d"/><circle cx="256" cy="256" r="202" fill="#15374f"/><g transform="translate(71.68 71.68) scale(15.36)" fill="#fff6d8">'+paw+'</g></svg>\n');
console.log('Built project-paw PNG icons (180/192/512 and maskable) and SVG source');
