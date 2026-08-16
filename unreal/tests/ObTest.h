// ============================================================
//  Minimal test framework for ObCore.
//
//  This is the verification instrument for the Unreal target — the
//  counterpart to tools/shot.mjs on the web target. Unreal cannot be
//  compiled in this pipeline, so anything that decides how the game
//  FEELS lives in ObCore and is proved here, with numbers.
//
//  Deliberately prints the measured value on success as well as
//  failure: "the test passed" is worth much less than "quick boost
//  produced 118.0 m/s and had decayed to 41.2 m/s after 400 ms".
// ============================================================
#pragma once

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

namespace obtest {

struct Result {
  std::string suite, name, detail;
  bool passed = false;
};

inline std::vector<Result>& Results() {
  static std::vector<Result> r;
  return r;
}
inline std::string& CurrentSuite() {
  static std::string s = "?";
  return s;
}

inline void Suite(const char* name) {
  CurrentSuite() = name;
  std::printf("\n\033[1m── %s ─────────────────────────────\033[0m\n", name);
}

inline void Record(bool ok, const std::string& name, const std::string& detail) {
  Results().push_back({CurrentSuite(), name, detail, ok});
  std::printf("  %s %-46s %s\n", ok ? "\033[32mPASS\033[0m" : "\033[31mFAIL\033[0m",
              name.c_str(), detail.c_str());
}

inline std::string Fmt(const char* f, ...) {
  char buf[512];
  va_list a;
  va_start(a, f);
  std::vsnprintf(buf, sizeof(buf), f, a);
  va_end(a);
  return std::string(buf);
}

/** Value must land inside [lo, hi]. Always reports what it actually was. */
inline void InRange(const char* name, double got, double lo, double hi,
                    const char* unit = "") {
  const bool ok = got >= lo && got <= hi;
  Record(ok, name, Fmt("got %.4g%s  expected %.4g..%.4g%s", got, unit, lo, hi, unit));
}

inline void Near(const char* name, double got, double want, double tol,
                 const char* unit = "") {
  const bool ok = std::fabs(got - want) <= tol;
  Record(ok, name, Fmt("got %.4g%s  want %.4g +/-%.3g%s", got, unit, want, tol, unit));
}

inline void True(const char* name, bool got, const std::string& detail = "") {
  Record(got, name, detail.empty() ? std::string(got ? "true" : "false") : detail);
}

inline void Greater(const char* name, double got, double than, const char* unit = "") {
  Record(got > than, name, Fmt("got %.4g%s  must exceed %.4g%s", got, unit, than, unit));
}

inline void Less(const char* name, double got, double than, const char* unit = "") {
  Record(got < than, name, Fmt("got %.4g%s  must be under %.4g%s", got, unit, than, unit));
}

/** Non-zero exit on any failure, so CI and the agent loop both gate on it. */
inline int Report() {
  int failed = 0;
  for (const auto& r : Results()) if (!r.passed) ++failed;
  const size_t total = Results().size();
  std::printf("\n\033[1m%zu checks, %d failed\033[0m\n", total, failed);
  if (failed) {
    std::printf("\nFailures:\n");
    for (const auto& r : Results())
      if (!r.passed) std::printf("  %s / %s — %s\n", r.suite.c_str(), r.name.c_str(), r.detail.c_str());
  }
  return failed ? 1 : 0;
}

}  // namespace obtest
