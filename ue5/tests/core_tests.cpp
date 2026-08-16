/* =============================================================================
   ue5/tests/core_tests.cpp — UE非依存コアの挙動テスト。

   ここで見るのは「Web版で112項目の実行検証によって確定した手触りが、
   C++コアでも同じ数値で成立しているか」の一点。
   描画は一切関与しないので、GPUの無いこの環境でも本物の検証になる。

   逆に、ここで検証できないもの（正直に列挙する）
     - UE5のActor・入力・アニメーション・描画：UE5が無いので不可能
     - fps・発熱：GPUが無いので測定不能
   ========================================================================== */
#include "AshlineSim.h"

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

using namespace Ashline;

namespace {

int gPass = 0, gFail = 0;
std::vector<std::string> gFails;

void Check(const char* name, bool ok, const std::string& detail = std::string()) {
  /* 一時 std::string の c_str() を三項演算子の外へ持ち出すと解放後参照になる。
     必ず名前付きの実体に組み立ててから渡すこと。 */
  std::string line = std::string(ok ? "  PASS  " : "  FAIL  ") + name;
  if (!detail.empty()) line += "   [" + detail + "]";
  std::printf("%s\n", line.c_str());
  if (ok) {
    ++gPass;
  } else {
    ++gFail;
    gFails.push_back(std::string(name) + (detail.empty() ? "" : "  [" + detail + "]"));
  }
}

std::string F(float v, int prec = 3) {
  char buf[64];
  std::snprintf(buf, sizeof(buf), "%.*f", prec, v);
  return buf;
}

bool Near(float a, float b, float tol) { return std::fabs(a - b) <= tol; }

/* 固定ステップで n フレーム進める */
void Tick(Sim& s, const Input& in, int n, float dt = 1.0f / 60.0f) {
  for (int i = 0; i < n; ++i) s.Step(in, dt);
}

const Input kIdle{};

/* ---------------------------------------------------------------------------
   1. 設定の同一性 — Web版から機械生成された値が期待どおりか
   ------------------------------------------------------------------------ */
void TestConfig() {
  std::printf("\n=== 設定（game.js から機械生成） ===\n");
  Check("遮蔽が24個", Cfg::kCoverCount == 24, std::to_string(Cfg::kCoverCount) + "個");
  Check("敵が3種", static_cast<int>(Cfg::EnemyType::Count) == 3);
  Check("波が3つ", Cfg::kWaveCount == 3);
  Check("敵の同時上限が6", Cfg::kMaxEnemies == 6);
  Check("波の構成が 2 / 3 / 5",
        Cfg::kWaves[0].count == 2 && Cfg::kWaves[1].count == 3 && Cfg::kWaves[2].count == 5,
        std::to_string(Cfg::kWaves[0].count) + "/" + std::to_string(Cfg::kWaves[1].count) +
            "/" + std::to_string(Cfg::kWaves[2].count));
  Check("アクティブリロード：全長1.10s / 成功窓0.12s / 成功-0.35s / 失敗1.60s / +20%",
        Near(Cfg::fire::reload, 1.10f, 1e-6f) && Near(Cfg::fire::arWin, 0.12f, 1e-6f) &&
            Near(Cfg::fire::arGain, 0.35f, 1e-6f) && Near(Cfg::fire::arFail, 1.60f, 1e-6f) &&
            Near(Cfg::fire::arBonus, 1.20f, 1e-6f));
  Check("敵3種で耐久・射程・間合いが全て異なる",
        Cfg::kEnemyDefs[0].hp != Cfg::kEnemyDefs[1].hp &&
            Cfg::kEnemyDefs[1].hp != Cfg::kEnemyDefs[2].hp &&
            Cfg::kEnemyDefs[0].fireRange != Cfg::kEnemyDefs[1].fireRange &&
            Cfg::kEnemyDefs[1].keep != Cfg::kEnemyDefs[2].keep,
        "HP " + F(Cfg::kEnemyDefs[0].hp, 0) + "/" + F(Cfg::kEnemyDefs[1].hp, 0) + "/" +
            F(Cfg::kEnemyDefs[2].hp, 0));
}

/* ---------------------------------------------------------------------------
   2. 地形と射線 — 柱2「遮蔽が意味を持つ」が物理的に成立しているか
   ------------------------------------------------------------------------ */
void TestWorld() {
  std::printf("\n=== 地形・射線・押し出し ===\n");
  World w;
  Check("箱が28個（遮蔽24＋外周壁4）", w.Boxes().size() == 28,
        std::to_string(w.Boxes().size()) + "個");
  Check("面が96個（遮蔽1つにつき4面）", w.Faces().size() == 96,
        std::to_string(w.Faces().size()) + "個");

  /* 高い壁(x=0,z=-9.4,h=2.05)を胸の高さで貫けないこと */
  const float t = w.RayWorld(0.0f, 1.15f, -8.0f, 0.0f, 0.0f, -1.0f, 30.0f);
  Check("高い遮蔽が胸の高さの射線を止める", t < 1.5f, "手前 " + F(t) + "m で遮られる");

  /* 同じ場所でも壁より高ければ通る */
  const float t2 = w.RayWorld(0.0f, 3.0f, -8.0f, 0.0f, 0.0f, -1.0f, 30.0f);
  Check("壁より高い位置からは射線が通る", t2 > 4.0f, "到達 " + F(t2) + "m");

  /* 遮蔽の内側に置かれたら外へ押し出されること */
  float ox = 0, oz = 0;
  const bool moved = w.ResolveCircle(0.0f, -9.4f, Cfg::player::radius, ox, oz);
  const float outside = std::fabs(oz + 9.4f);
  Check("遮蔽にめり込んだら外へ押し出される", moved && outside > 0.4f,
        "z=-9.4 -> (" + F(ox) + ", " + F(oz) + ")");

  /* 外周の外へは出られないこと。
     ResolveCircle は「今めり込んでいる分を押し出す」局所処理なので、
     壁帯(z=20.0..20.6)の外側へ瞬間移動した点は引き戻さない。それが正しい。
     検証すべきは「歩いて場外に出られない」ことなので、実際に歩かせる。 */
  {
    float px = 0.0f, pz = 18.0f;
    for (int i = 0; i < 600; ++i) {           // 10秒ぶん、外へ押し続ける
      w.ResolveCircle(px, pz + Cfg::move::walk / 60.0f, Cfg::player::radius, px, pz);
    }
    Check("歩いて外周壁の外へは出られない",
          pz < Cfg::arena::hz && pz > Cfg::arena::hz - 1.0f,
          "z=18.0 から外へ歩き続けて " + F(pz) + " で止まる（壁 z=" +
              F(Cfg::arena::hz, 1) + "）");
  }

  /* 面の a->b の向き：法線と接線が直交し、右手系の並びであること。
     この並びが崩れると乗り出しの左右が反転する。 */
  /* 壁を向いた視線は -n。Y-up でその右方向は (-(-nz), 0, (-nx)) = (nz, 0, -nx)。
     接線 t が右方向と一致していれば a->b が「左->右」に揃っている。
     ここが逆転すると、端からの乗り出しが左右あべこべになる。 */
  bool orderOk = true;
  for (const Face& f : w.Faces()) {
    if (std::fabs(f.nx * f.tx + f.nz * f.tz) > 1e-5f) { orderOk = false; break; }
    if (std::fabs(f.tx - f.nz) > 1e-5f || std::fabs(f.tz + f.nx) > 1e-5f) { orderOk = false; break; }
  }
  Check("面の a->b が「壁を向いたときの左->右」で揃っている", orderOk);

  /* 吸着：中央の低い遮蔽(z=2.0)の手前から探すと、その +Z 面が見つかること */
  const CoverQuery q = w.FindCover(0.0f, 3.0f, Cfg::cover::snapDist);
  bool found = q.faceIndex >= 0;
  bool plusZ = found && w.Faces()[q.faceIndex].nz > 0.5f;
  Check("遮蔽の手前に立つとその面が吸着先になる", found && plusZ,
        found ? ("面" + std::to_string(q.faceIndex) + " t=" + F(q.t)) : "見つからない");
}

/* ---------------------------------------------------------------------------
   3. プレイヤー：遮蔽への吸着と離脱
   ------------------------------------------------------------------------ */
void TestCover() {
  std::printf("\n=== 遮蔽への吸着・乗り出し ===\n");
  Sim s;
  s.SetCombatEnabled(false);
  s.Teleport(0.0f, 3.2f, 0.0f);
  Tick(s, kIdle, 5);

  Input in;
  in.action = true;
  in.actionEdge = true;
  s.Step(in, 1.0f / 60.0f);
  in.actionEdge = false;
  s.Step(in, 1.0f / 60.0f);
  in.action = false;

  /* 吸着は §7 の 150〜200ms。ここでは snapTime=0.165s で完了すること。 */
  int frames = 0;
  while (frames < 60 && s.GetPlayer().state == PlayerState::ToCover) {
    s.Step(kIdle, 1.0f / 60.0f);
    ++frames;
  }
  const bool inCover = s.GetPlayer().state == PlayerState::Cover;
  Check("ボタンで遮蔽に吸着する", inCover,
        inCover ? ("COVER到達 " + F(frames / 60.0f) + "s") : "到達しなかった");
  Check("吸着は0.20秒以内に終わる（§7）", inCover && frames / 60.0f <= 0.20f,
        F(frames / 60.0f) + "s");

  if (inCover) {
    Check("遮蔽中の露出度が0（完全に隠れている）", s.Exposure() < 0.01f, F(s.Exposure()));
    /* 隠れたままトリガーを引き続けるとブラインドファイアになる */
    Input f;
    f.fire = true;
    Tick(s, f, 30);
    Check("隠れたまま撃つとブラインドファイアになる", s.IsBlind(), s.IsBlind() ? "blind" : "not blind");
    Check("ブラインドファイアの拡散は7.0°（当てる手段ではない）",
          Near(s.CurrentSpread() / kDeg, 7.0f, 0.05f), F(s.CurrentSpread() / kDeg, 2) + "°");
    Check("ブラインドファイア中はエイムアシストが働かない", s.AssistScale() <= 0.0f,
          F(s.AssistScale()));
  }
}

/* ---------------------------------------------------------------------------
   4. アクティブリロード（§7）
   ------------------------------------------------------------------------ */
void TestActiveReload() {
  std::printf("\n=== アクティブリロード ===\n");
  const float dt = 1.0f / 60.0f;

  /* リロードを立ち上げる小道具 */
  auto StartReload = [&](Sim& s) {
    s.MutablePlayer().ammo = 0;
    s.MutablePlayer().fireCd = 0.0f;
    s.Step(kIdle, dt);   // 次フレームで reloadT が立つ
  };
  auto TickTo = [&](Sim& s, float prog) {
    int n = 0;
    while (n < 400 &&
           (1.0f - s.GetPlayer().reloadT / Cfg::fire::reload) < prog) {
      s.Step(kIdle, dt);
      ++n;
    }
    return n;
  };
  auto Finish = [&](Sim& s) {
    int n = 0;
    while (n < 400 && s.GetPlayer().reloadT > 0.0f) { s.Step(kIdle, dt); ++n; }
    return n;
  };

  /* (a) 何もしなければ 1.10 秒 */
  {
    Sim s;
    s.SetCombatEnabled(false);
    s.Teleport(0.0f, 9.0f, 0.0f);
    Tick(s, kIdle, 5);
    StartReload(s);
    const int n = Finish(s);
    Check("無操作のリロードは1.10秒", Near(n / 60.0f, 1.10f, 0.05f), F(n / 60.0f) + "s");
    Check("リロード完了で弾倉が満タンに戻る", s.GetPlayer().ammo == static_cast<int>(Cfg::fire::mag),
          std::to_string(s.GetPlayer().ammo) + "発");
    Check("無操作なら火力ボーナスは付かない", Near(s.GetPlayer().dmgMul, 1.0f, 1e-6f),
          "x" + F(s.GetPlayer().dmgMul, 2));
  }

  /* (b) 成功窓のど真ん中でタップ */
  {
    Sim s;
    s.SetCombatEnabled(false);
    s.Teleport(0.0f, 9.0f, 0.0f);
    Tick(s, kIdle, 5);
    StartReload(s);
    int n = TickTo(s, Cfg::fire::arAt + 0.5f * Cfg::fire::arWin / Cfg::fire::reload);
    const float before = s.GetPlayer().reloadT;
    const bool tapped = s.ActiveReloadTap();
    const float after = s.GetPlayer().reloadT;
    const bool twice = s.ActiveReloadTap();
    n += Finish(s);
    Check("成功窓でのタップが受け付けられる", tapped);
    Check("成功で所要が0.35秒短縮される", Near(before - after, Cfg::fire::arGain, 0.02f),
          "短縮 " + F(before - after) + "s");
    Check("タップは1回だけ有効（連打で稼げない）", !twice);
    Check("成功したリロードは0.75秒前後で終わる",
          Near(n / 60.0f, Cfg::fire::reload - Cfg::fire::arGain, 0.05f), F(n / 60.0f) + "s");
    Check("成功した弾倉の火力が+20%になる", Near(s.GetPlayer().dmgMul, Cfg::fire::arBonus, 1e-5f),
          "x" + F(s.GetPlayer().dmgMul, 2));
  }

  /* (c) 窓の手前でタップ＝失敗 */
  {
    Sim s;
    s.SetCombatEnabled(false);
    s.Teleport(0.0f, 9.0f, 0.0f);
    Tick(s, kIdle, 5);
    StartReload(s);
    TickTo(s, Cfg::fire::arAt * 0.35f);
    const bool tapped = s.ActiveReloadTap();
    const float remain = s.GetPlayer().reloadT;
    Finish(s);
    Check("窓外のタップは失敗として受け付けられる", tapped);
    Check("失敗すると残り1.60秒の停止ペナルティになる", Near(remain, Cfg::fire::arFail, 0.02f),
          "残り " + F(remain) + "s");
    Check("失敗した弾倉に火力ボーナスは付かない", Near(s.GetPlayer().dmgMul, 1.0f, 1e-6f),
          "x" + F(s.GetPlayer().dmgMul, 2));
  }

  /* (d) リロード中でないタップは無視される */
  {
    Sim s;
    s.SetCombatEnabled(false);
    s.Teleport(0.0f, 9.0f, 0.0f);
    Tick(s, kIdle, 5);
    Check("リロード中でないタップは無視される（誤爆しない）", !s.ActiveReloadTap());
  }
}

/* ---------------------------------------------------------------------------
   5. 敵の攻撃と波（ラウンド2で実装した性質）
   ------------------------------------------------------------------------ */
void TestCombat() {
  std::printf("\n=== 敵の攻撃・波 ===\n");
  const float dt = 1.0f / 60.0f;

  /* (a) 開けた場所（x=9.5のレーンは z=-12..-6 に遮蔽が無い）では撃たれる */
  {
    Sim s;
    s.SetSeed(12345u);
    s.StartCombat();
    for (Enemy& e : s.MutableEnemies()) { e.active = false; e.dead = true; e.fall = 1.0f; }
    Enemy& e0 = s.MutableEnemies()[0];
    e0.type = Cfg::EnemyType::rusher;
    e0.x = 9.5f;
    e0.z = -12.0f;
    e0.maxHp = Cfg::kEnemyDefs[0].hp;
    e0.hp = e0.maxHp;
    e0.active = true;
    e0.dead = false;
    e0.fall = 0.0f;
    e0.st = 0;
    s.Teleport(9.5f, -6.0f, kPi);
    Tick(s, kIdle, 3);

    float minHp = Cfg::hurt::hp;
    float maxFireSpeed = 0.0f;
    float lx = s.GetEnemies()[0].x, lz = s.GetEnemies()[0].z;
    bool sawAim = false, sawFire = false;
    for (int i = 0; i < 60 * 8; ++i) {
      s.Step(kIdle, dt);
      const Enemy& e = s.GetEnemies()[0];
      if (s.GetPlayer().hp < minHp) minHp = s.GetPlayer().hp;
      if (e.st == 2) sawAim = true;
      if (e.st == 3) {
        sawFire = true;
        const float sp = Hypot2(e.x - lx, e.z - lz) / dt;
        if (sp > maxFireSpeed) maxFireSpeed = sp;
      }
      lx = e.x;
      lz = e.z;
      if (s.GetPlayer().dead) break;
    }
    Check("敵は狙い(aim)を経てから撃つ ── 予備動作がある", sawAim && sawFire);
    Check("敵は撃っている間は止まっている（柱1を敵にも課す）", maxFireSpeed < 0.05f,
          "発砲中の最大速度 " + F(maxFireSpeed) + " m/s（移動速度 " +
              F(Cfg::kEnemyDefs[0].speed, 1) + " m/s）");
    Check("開けた場所に立っているとHPが減る", minHp < Cfg::hurt::hp,
          "HP最低 " + F(minHp, 1) + " / " + F(Cfg::hurt::hp, 0));
  }

  /* (b) 高い遮蔽(z=-9.4, h=2.05)の裏では射線が通らず、被弾しない */
  {
    Sim s;
    s.SetSeed(999u);
    s.StartCombat();
    for (Enemy& e : s.MutableEnemies()) { e.active = false; e.dead = true; e.fall = 1.0f; }
    Enemy& e0 = s.MutableEnemies()[0];
    e0.type = Cfg::EnemyType::marksman;   // 間合い15mなので回り込まない
    e0.x = 0.0f;
    e0.z = -16.0f;
    e0.maxHp = Cfg::kEnemyDefs[1].hp;
    e0.hp = e0.maxHp;
    e0.active = true;
    e0.dead = false;
    e0.fall = 0.0f;
    e0.st = 0;
    s.Teleport(0.0f, -8.4f, kPi);
    Tick(s, kIdle, 3);

    float minHp = Cfg::hurt::hp;
    for (int i = 0; i < 60 * 8; ++i) {
      s.Step(kIdle, dt);
      if (s.GetPlayer().hp < minHp) minHp = s.GetPlayer().hp;
    }
    Check("高い遮蔽の裏に居れば8秒間まったく被弾しない",
          Near(minHp, Cfg::hurt::hp, 1e-3f), "HP " + F(minHp, 1));
  }

  /* (c) 波の進行：2 -> 3 -> 5 体、全滅で制圧 */
  {
    Sim s;
    s.SetSeed(7u);
    s.StartCombat();
    auto Alive = [&]() {
      int n = 0;
      for (const Enemy& e : s.GetEnemies()) if (e.active && !e.dead) ++n;
      return n;
    };
    std::vector<int> seen;
    for (int w = 0; w < 6; ++w) {
      if (s.GetCombat().state == CombatState::Clear) break;
      seen.push_back(Alive());
      const int wave = s.GetCombat().wave;
      for (Enemy& e : s.MutableEnemies()) { e.active = false; e.dead = true; e.fall = 1.0f; }
      int n = 0;
      while (n < 60 * 6 && s.GetCombat().wave == wave &&
             s.GetCombat().state != CombatState::Clear) {
        s.MutablePlayer().hp = Cfg::hurt::hp;
        s.Step(kIdle, dt);
        ++n;
      }
    }
    const bool ok = seen.size() == 3 && seen[0] == 2 && seen[1] == 3 && seen[2] == 5;
    std::string d;
    for (size_t i = 0; i < seen.size(); ++i) d += (i ? " -> " : "") + std::to_string(seen[i]) + "体";
    Check("波が 2 -> 3 -> 5 体と進み、全滅させると制圧になる",
          ok && s.GetCombat().state == CombatState::Clear, d);
  }

  /* (d) 撃たれ続ければ倒れ、再挑戦で1波目に戻る */
  {
    Sim s;
    s.SetSeed(4242u);
    s.StartCombat();
    for (Enemy& e : s.MutableEnemies()) { e.active = false; e.dead = true; e.fall = 1.0f; }
    Enemy& e0 = s.MutableEnemies()[0];
    e0.type = Cfg::EnemyType::heavy;
    e0.x = 9.5f;
    e0.z = -12.0f;
    e0.maxHp = Cfg::kEnemyDefs[2].hp;
    e0.hp = e0.maxHp;
    e0.active = true;
    e0.dead = false;
    e0.fall = 0.0f;
    e0.st = 0;
    s.Teleport(9.5f, -6.0f, kPi);
    Tick(s, kIdle, 3);

    int n = 0;
    while (n < 60 * 40 && !s.GetPlayer().dead) { s.Step(kIdle, dt); ++n; }
    Check("撃たれ続ければ倒れる（HP0で戦闘不能）",
          s.GetPlayer().dead && s.GetCombat().state == CombatState::Dead,
          F(n / 60.0f, 1) + "秒で戦闘不能");

    s.StartCombat();
    Tick(s, kIdle, 3);
    Check("再挑戦でHPが満タンに戻り1波目から始まる",
          Near(s.GetPlayer().hp, Cfg::hurt::hp, 1e-3f) && s.GetCombat().wave == 0 &&
              s.GetCombat().state == CombatState::Fight,
          "HP " + F(s.GetPlayer().hp, 0) + " / 波" + std::to_string(s.GetCombat().wave + 1));
  }
}

}  // namespace

int main() {
  TestConfig();
  TestWorld();
  TestCover();
  TestActiveReload();
  TestCombat();

  std::printf("\n----------------------------------------\n");
  std::printf("  コア単体: PASS %d / FAIL %d\n", gPass, gFail);
  std::printf("----------------------------------------\n");
  if (!gFails.empty()) {
    std::printf("失敗項目:\n");
    for (const std::string& f : gFails) std::printf("  - %s\n", f.c_str());
  }
  return gFail == 0 ? 0 : 1;
}
