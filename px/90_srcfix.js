// ══════════════════════════════════════════════════════════════════
//  包んだ関数から、包まれた本体のソースが読めるようにする（いちばん最後）
// ══════════════════════════════════════════════════════════════════
// 理由は px/000_capture.js の頭に書いた。ここでは差し替えられた関数の
// `toString()` を「包み + 本体」の結合へ差し替える。
//
// 差し替えではなく**丸ごと置き換えた**関数（本体を呼ばないもの）では、
// 結合ソースに走らないコードが混ざる。それが検査を素通りさせないことは、
// ミューテーションテストで確かめること（本体を壊してスイートが赤くなるか）。
(function () {
  const G = (typeof window !== 'undefined') ? window : globalThis;
  let n = 0;
  for (const ent of PX_ORIG_FN) {
    const k = ent[0], raw = ent[1];
    let cur; try { cur = G[k]; } catch (e) { continue; }
    if (typeof cur !== 'function' || cur === raw) continue;
    let a, b;
    try { a = Function.prototype.toString.call(cur); b = Function.prototype.toString.call(raw); }
    catch (e) { continue; }
    try {
      Object.defineProperty(cur, 'toString', {
        value: function () { return a + '\n/* ── ドット絵版が包んでいる本体 ── */\n' + b; },
        writable: true, configurable: true,
      });
      n++;
    } catch (e) { /* 凍結された関数は諦める */ }
  }
  PX.wrappedCount = n;
})();
