/* =============================================================================
   ue5/tests/core_probe.cpp
   probes.json の問いをUE5コアに投げ、答えを core_answers.json に書く。
   同じ問いをWeb版にも投げ、compare_probes.js で突き合わせる。

   ビルドと実行は ue5/tests/run.sh が行う。
   ========================================================================== */
#include "AshlineWorld.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

using namespace Ashline;

/* ---- 最小限のJSON読み取り。probes.json は自分で生成した平坦な配列なので、
       汎用パーサは要らない。キーを探して数値を拾うだけにする。 -------------- */
namespace {

struct Probe {
  std::string kind;
  float ox = 0, oy = 0, oz = 0, dx = 0, dy = 0, dz = 0, maxT = 0;
  float x = 0, z = 0, r = 0, d = 0;
};

std::string ReadFile(const char* path) {
  FILE* fp = std::fopen(path, "rb");
  if (!fp) {
    std::fprintf(stderr, "開けない: %s\n", path);
    std::exit(1);
  }
  std::string s;
  char buf[65536];
  size_t n;
  while ((n = std::fread(buf, 1, sizeof(buf), fp)) > 0) s.append(buf, n);
  std::fclose(fp);
  return s;
}

/* obj の範囲内で "key": の直後の数値を読む。無ければ fallback。 */
float Field(const std::string& s, size_t a, size_t b, const char* key, float fallback) {
  std::string pat = std::string("\"") + key + "\":";
  size_t p = s.find(pat, a);
  if (p == std::string::npos || p >= b) return fallback;
  return std::strtof(s.c_str() + p + pat.size(), nullptr);
}

std::string FieldStr(const std::string& s, size_t a, size_t b, const char* key) {
  std::string pat = std::string("\"") + key + "\":\"";
  size_t p = s.find(pat, a);
  if (p == std::string::npos || p >= b) return std::string();
  size_t q = p + pat.size();
  size_t e = s.find('"', q);
  return s.substr(q, e - q);
}

std::vector<Probe> LoadProbes(const char* path) {
  const std::string s = ReadFile(path);
  std::vector<Probe> out;
  size_t i = 0;
  while (true) {
    size_t a = s.find('{', i);
    if (a == std::string::npos) break;
    size_t b = s.find('}', a);
    if (b == std::string::npos) break;
    Probe p;
    p.kind = FieldStr(s, a, b, "k");
    p.ox = Field(s, a, b, "ox", 0);
    p.oy = Field(s, a, b, "oy", 0);
    p.oz = Field(s, a, b, "oz", 0);
    p.dx = Field(s, a, b, "dx", 0);
    p.dy = Field(s, a, b, "dy", 0);
    p.dz = Field(s, a, b, "dz", 0);
    p.maxT = Field(s, a, b, "maxT", kInf);
    p.x = Field(s, a, b, "x", 0);
    p.z = Field(s, a, b, "z", 0);
    p.r = Field(s, a, b, "r", 0.4f);
    p.d = Field(s, a, b, "d", Cfg::cover::snapDist);
    out.push_back(p);
    i = b + 1;
  }
  return out;
}

void PrintNum(FILE* fp, float v) {
  if (v == kInf) std::fprintf(fp, "null");            // JS の Infinity は JSON に無い
  else std::fprintf(fp, "%.6f", v);
}

}  // namespace

int main(int argc, char** argv) {
  const char* inPath = argc > 1 ? argv[1] : "ue5/tests/probes.json";
  const char* outPath = argc > 2 ? argv[2] : "ue5/tests/core_answers.json";

  World world;
  const std::vector<Probe> probes = LoadProbes(inPath);

  FILE* fp = std::fopen(outPath, "wb");
  if (!fp) {
    std::fprintf(stderr, "書けない: %s\n", outPath);
    return 1;
  }
  std::fprintf(fp, "[");
  for (size_t i = 0; i < probes.size(); ++i) {
    const Probe& p = probes[i];
    if (i) std::fprintf(fp, ",");
    if (p.kind == "ray") {
      const float t = world.RayWorld(p.ox, p.oy, p.oz, p.dx, p.dy, p.dz, p.maxT);
      PrintNum(fp, t);
    } else if (p.kind == "circle") {
      float ox = 0, oz = 0;
      world.ResolveCircle(p.x, p.z, p.r, ox, oz);
      std::fprintf(fp, "[");
      PrintNum(fp, ox);
      std::fprintf(fp, ",");
      PrintNum(fp, oz);
      std::fprintf(fp, "]");
    } else if (p.kind == "cover") {
      const CoverQuery q = world.FindCover(p.x, p.z, p.d);
      if (q.faceIndex < 0) std::fprintf(fp, "null");
      else {
        std::fprintf(fp, "[%d,", q.faceIndex);
        PrintNum(fp, q.t);
        std::fprintf(fp, "]");
      }
    } else {
      std::fprintf(fp, "null");
    }
  }
  std::fprintf(fp, "]\n");
  std::fclose(fp);

  /* 地形そのものも書き出す。問いの答えが合っていても、
     地形が違えば「たまたま同じ答えになった」だけかもしれない。 */
  const std::string shapePath = std::string(outPath).substr(0, std::string(outPath).rfind('/') + 1) +
                                "core_shape.json";
  FILE* sf = std::fopen(shapePath.c_str(), "wb");
  if (sf) {
    std::fprintf(sf, "{\"boxes\":[");
    const auto& bx = world.Boxes();
    for (size_t i = 0; i < bx.size(); ++i) {
      if (i) std::fprintf(sf, ",");
      std::fprintf(sf, "[%.6f,%.6f,%.6f,%.6f,%.6f,%d]", bx[i].minx, bx[i].maxx,
                   bx[i].minz, bx[i].maxz, bx[i].top, bx[i].coverIndex >= 0 ? 1 : 0);
    }
    std::fprintf(sf, "],\"faces\":[");
    const auto& fc = world.Faces();
    for (size_t i = 0; i < fc.size(); ++i) {
      if (i) std::fprintf(sf, ",");
      std::fprintf(sf, "[%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%d]", fc[i].nx, fc[i].nz,
                   fc[i].ax, fc[i].az, fc[i].tx, fc[i].tz, fc[i].len, fc[i].low ? 1 : 0);
    }
    std::fprintf(sf, "]}\n");
    std::fclose(sf);
  }

  std::fprintf(stderr, "core_probe: %zu 問に回答 -> %s\n", probes.size(), outPath);
  std::fprintf(stderr, "  boxes=%zu faces=%zu\n", world.Boxes().size(), world.Faces().size());
  return 0;
}
