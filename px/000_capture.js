// ══════════════════════════════════════════════════════════════════
//  差し替え前の関数を控えておく（いちばん最初に走る）
// ══════════════════════════════════════════════════════════════════
// tests/ の多くのスイートは、関数の**ソース文字列**を読んで検査している：
//   drawBeast.toString().indexOf('e._stride')      … 個体共通の歩幅を使っているか
//   drawPlayer.toString() から 'rig.sq.x*' の係数  … スクワッシュが画面で見える量か
//   drawGatlingGun.toString().indexOf('PI2')       … 全周に PI2 を誤用していないか
//
// ドット絵版は本編の描画関数を「包んで」使う。包むと `toString()` は
// 包みの中身だけを返すので、包まれた本体のコードが読めなくなり、
// 実際には何も壊れていないのにスイートが落ちる（実際に anim/anim2 が落ちた）。
//
// ここで差し替え前の関数を控え、px/90_srcfix.js が
// 「包み + 包まれた本体」を結合したソースを返すようにする。
// 包みは本体を呼んで描いてから輪郭や陰影を足しているので、
// 結合した文字列は**実際に走るコードの全体**であり、嘘ではない。
// 本体から 'e._stride' が消えれば結合ソースからも消える＝検査は効いたまま。
const PX_ORIG_FN = new Map();
(function () {
  const G = (typeof window !== 'undefined') ? window : globalThis;
  let names;
  try { names = Object.getOwnPropertyNames(G); } catch (e) { return; }
  for (const k of names) {
    let v; try { v = G[k]; } catch (e) { continue; }
    if (typeof v !== 'function') continue;
    let s; try { s = Function.prototype.toString.call(v); } catch (e) { continue; }
    if (s.indexOf('[native code]') >= 0) continue;   // 組み込みは対象外
    PX_ORIG_FN.set(k, v);
  }
})();
