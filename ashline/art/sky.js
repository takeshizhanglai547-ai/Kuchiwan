(function (g) {
  var ASH = g.ASH = g.ASH || {};
  ASH.sky = function (T, scene) {
    var P = ASH.palette;
    var m = new T.Mesh(new T.SphereGeometry(400, 8, 6), new T.MeshBasicMaterial({ side: T.BackSide }));
    scene.add(m);
    scene.fog = new T.Fog(P.fog, P.fogNear, P.fogFar);
    return { mesh: m, motes: null, update: function () {} };
  };
})(typeof window !== 'undefined' ? window : globalThis);
