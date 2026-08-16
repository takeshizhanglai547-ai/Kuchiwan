#!/usr/bin/env python3
# =============================================================================
# ue5/tools/ue_static_check.py
# UE5ラッパー層の静的検査。
#
# なぜ必要か
#   この環境にはUE5が無く、UEヘッダを含むコードは1行もコンパイルできない。
#   したがってUE層について「動く」とは絶対に言えない。言えるのは
#   「UEが要求する構造上の約束を破っていない」ことだけで、それをここで見る。
#   コンパイルの代わりにはならない。代わりになるつもりも無い。
#
# 使い方: python3 ue5/tools/ue_static_check.py
# =============================================================================
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PROJ = os.path.join(ROOT, "ue5", "AshlineUE")
SRC = os.path.join(PROJ, "Source")
CORE = os.path.join(SRC, "AshlineCore")
WRAP = os.path.join(SRC, "AshlineUE")

problems = []
notes = []
checks = 0


def problem(msg):
    problems.append(msg)


def rel(p):
    return os.path.relpath(p, ROOT)


def read(p):
    # utf-8-sig: ソースには BOM を付けてある（日本語ロケールのMSVC対策）ので、
    # 読む側で必ず外す。外さないと先頭の一致判定が全て落ちる。
    with open(p, "r", encoding="utf-8-sig") as f:
        return f.read()


def walk(base, exts):
    out = []
    for dirpath, _dirnames, filenames in os.walk(base):
        for fn in filenames:
            if os.path.splitext(fn)[1] in exts:
                out.append(os.path.join(dirpath, fn))
    return sorted(out)


# -----------------------------------------------------------------------------
# 1. .uproject が正しいJSONで、モジュール宣言が実体と一致しているか
# -----------------------------------------------------------------------------
def check_uproject():
    global checks
    path = os.path.join(PROJ, "AshlineUE.uproject")
    if not os.path.exists(path):
        problem(".uproject が無い: " + rel(path))
        return
    checks += 1
    try:
        data = json.loads(read(path))
    except Exception as e:  # noqa: BLE001
        problem(".uproject が壊れている（JSONとして読めない）: %s" % e)
        return

    declared = {m.get("Name") for m in data.get("Modules", [])}
    on_disk = set()
    if os.path.isdir(SRC):
        for name in os.listdir(SRC):
            d = os.path.join(SRC, name)
            if os.path.isdir(d) and os.path.exists(os.path.join(d, name + ".Build.cs")):
                on_disk.add(name)

    checks += 1
    missing = on_disk - declared
    if missing:
        problem(".uproject に書かれていないモジュールがある（ビルド対象から漏れる）: %s"
                % ", ".join(sorted(missing)))
    checks += 1
    ghost = declared - on_disk
    if ghost:
        problem(".uproject が実体の無いモジュールを指している: %s" % ", ".join(sorted(ghost)))

    checks += 1
    if not data.get("EngineAssociation"):
        problem(".uproject に EngineAssociation が無い（エディタがバージョンを決められない）")


# -----------------------------------------------------------------------------
# 2. AshlineCore がエンジンから独立し続けているか
#    ここが崩れると、この環境でコアを検証できなくなる＝検証ループが死ぬ。
# -----------------------------------------------------------------------------
UE_TOKENS = re.compile(
    r"#include\s+\"(CoreMinimal\.h|Engine/|GameFramework/|UObject/|Components/|Kismet/)"
    r"|\bUCLASS\s*\(|\bUSTRUCT\s*\(|\bUENUM\s*\(|\bUPROPERTY\s*\(|\bUFUNCTION\s*\("
    r"|\bGENERATED_BODY\b|\bFVector\b|\bFRotator\b|\bUWorld\b|\bAActor\b")


def check_core_is_engine_free():
    global checks
    if not os.path.isdir(CORE):
        problem("AshlineCore が無い")
        return
    for p in walk(CORE, {".h", ".cpp"}):
        # 唯一の例外。UEのモジュール機構への入口だけを持ち、ルールは含まない。
        # 例外を暗黙にせず、ここに名前で書いて見えるようにしておく。
        if os.path.basename(p) == "AshlineCoreModule.cpp":
            continue
        checks += 1
        txt = read(p)
        m = UE_TOKENS.search(txt)
        if m:
            line = txt[: m.start()].count("\n") + 1
            problem("AshlineCore がエンジンに依存している（コアの検証ができなくなる）: %s:%d 「%s」"
                    % (rel(p), line, m.group(0).strip()))

    # 例外ファイルが本当に入口だけか。ルールが紛れ込んだら独立性が崩れる。
    entry = os.path.join(CORE, "Private", "AshlineCoreModule.cpp")
    if os.path.exists(entry):
        checks += 1
        body = read(entry)
        if "IMPLEMENT_MODULE" not in body:
            problem("AshlineCoreModule.cpp に IMPLEMENT_MODULE が無い"
                    "（エディタが AshlineCore を読み込めず起動しない）")
        # ブロックコメントを本文ごと落としてから数える。行頭が * とは限らない。
        stripped = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
        stripped = re.sub(r"//[^\n]*", "", stripped)
        code = [ln for ln in stripped.splitlines() if ln.strip()]
        if len(code) > 4:
            problem("AshlineCoreModule.cpp に入口以外のコードが入っている（%d行）: %s"
                    % (len(code), " / ".join(x.strip() for x in code[:5])))
    else:
        problem("AshlineCoreModule.cpp が無い。.uproject に載ったモジュールは "
                "IMPLEMENT_MODULE が無いと実行時にロードできず、エディタが開かない")

    # Build.cs が Engine を引いていないか
    bcs = os.path.join(CORE, "AshlineCore.Build.cs")
    if os.path.exists(bcs):
        checks += 1
        txt = read(bcs)
        for bad in ("\"Engine\"", "\"CoreUObject\"", "\"InputCore\""):
            if bad in txt:
                problem("AshlineCore.Build.cs が %s を依存に入れている（エンジン非依存を壊す）" % bad)


# -----------------------------------------------------------------------------
# 3. コアの単位系が守られているか（cm / Z-up の混入を検出）
#    ブリッジ以外の場所で 100 倍していたら、単位が混ざり始めた合図。
# -----------------------------------------------------------------------------
def check_units():
    global checks
    if not os.path.isdir(CORE):
        return
    pat = re.compile(r"(\*|/)\s*100(\.0)?f?\b")
    for p in walk(CORE, {".h", ".cpp"}):
        if p.endswith("AshlineConfig.generated.h"):
            continue
        checks += 1
        for i, line in enumerate(read(p).splitlines(), 1):
            if line.lstrip().startswith(("//", "*", "/*")):
                continue
            if pat.search(line):
                problem("コア内で100倍/除算をしている（cmが混入した疑い）: %s:%d  %s"
                        % (rel(p), i, line.strip()))


# -----------------------------------------------------------------------------
# 4. UCLASS/USTRUCT の構造的な約束
#    ここを外すとUHTが通らない。コンパイルできない環境でも形だけは見られる。
# -----------------------------------------------------------------------------
def check_uclass_shape():
    global checks
    if not os.path.isdir(WRAP):
        notes.append("UE5ラッパー層がまだ無い（作成中）")
        return
    headers = walk(os.path.join(WRAP, "Public"), {".h"}) + walk(os.path.join(WRAP, "Private"), {".h"})
    for p in headers:
        txt = read(p)
        body = re.sub(r"/\*.*?\*/", "", txt, flags=re.S)
        body = re.sub(r"//[^\n]*", "", body)

        has_ureflect = re.search(r"\b(UCLASS|USTRUCT|UENUM|UINTERFACE)\s*\(", body)
        if not has_ureflect:
            continue

        checks += 1
        base = os.path.splitext(os.path.basename(p))[0]
        gen = '#include "%s.generated.h"' % base
        if gen not in txt:
            problem("UCLASS/USTRUCT があるのに %s が無い（UHTが通らない）: %s" % (gen, rel(p)))
        else:
            # .generated.h は必ず最後のinclude
            incs = [m for m in re.finditer(r'^\s*#include\s+["<][^">]+[">]', txt, re.M)]
            if incs and gen not in incs[-1].group(0):
                problem(".generated.h が最後のincludeになっていない（UHTが通らない）: %s" % rel(p))

        # UCLASS / USTRUCT ごとに GENERATED_BODY があるか
        for m in re.finditer(r"\b(UCLASS|USTRUCT)\s*\([^)]*\)\s*(class|struct)\s+(\w+\s+)?(\w+)", body):
            checks += 1
            name = m.group(4)
            after = body[m.end():m.end() + 1200]
            if "GENERATED_BODY()" not in after and "GENERATED_UCLASS_BODY()" not in after:
                problem("%s に GENERATED_BODY() が無い（UHTが通らない）: %s" % (name, rel(p)))

        # UPROPERTY / UFUNCTION の直後が宣言であること（空行だけの誤配置を拾う）
        for m in re.finditer(r"\bUPROPERTY\s*\([^)]*\)\s*\n\s*\n", body):
            checks += 1
            problem("UPROPERTY の直後に宣言が無い: %s" % rel(p))


# -----------------------------------------------------------------------------
# 5. ラッパー層にゲーム判断が漏れていないか
#    ルールはコアが持つ、という設計を機械的に見張る。
# -----------------------------------------------------------------------------
CFG_LEAK = re.compile(r"\b(0\.165f|1\.10f|0\.58f|0\.12f|1\.60f|1\.20f|3\.05f|6\.30f|"
                      r"\b640\.0f|34\.0f|2\.05f)\b")


def check_no_rules_in_wrapper():
    global checks
    if not os.path.isdir(WRAP):
        return
    for p in walk(WRAP, {".h", ".cpp"}):
        checks += 1
        txt = read(p)
        for i, line in enumerate(txt.splitlines(), 1):
            s = line.strip()
            if s.startswith(("//", "*", "/*")):
                continue
            m = CFG_LEAK.search(line)
            if m:
                problem("ラッパー層にコアの調整値が直接書かれている（二重管理になる）: %s:%d 「%s」"
                        % (rel(p), i, m.group(0)))


# -----------------------------------------------------------------------------
# 6. 生成物が手で編集されていないか
# -----------------------------------------------------------------------------
def check_generated_untouched():
    global checks
    p = os.path.join(CORE, "Public", "AshlineConfig.generated.h")
    if not os.path.exists(p):
        problem("AshlineConfig.generated.h が無い（node ue5/tools/gen_config.js で生成する）")
        return
    checks += 1
    head = read(p)[:400]
    if "自動生成" not in head:
        problem("AshlineConfig.generated.h の生成ヘッダが消えている（手で編集された疑い）")


# -----------------------------------------------------------------------------
def main():
    check_uproject()
    check_core_is_engine_free()
    check_units()
    check_uclass_shape()
    check_no_rules_in_wrapper()
    check_generated_untouched()

    for n in notes:
        print("      -- " + n)
    if problems:
        print("      静的検査 %d 項目中 %d 件の指摘:" % (checks, len(problems)))
        for x in problems:
            print("        - " + x)
        return 1
    print("      静的検査 %d 項目を通過（※これはコンパイルの代わりにはならない）" % checks)
    return 0


if __name__ == "__main__":
    sys.exit(main())
