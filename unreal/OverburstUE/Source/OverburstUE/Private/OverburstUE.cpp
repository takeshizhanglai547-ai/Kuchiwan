// Copyright OVERBURST.
#include "OverburstUE.h"

DEFINE_LOG_CATEGORY(LogOverburst);

// PRIMARY, not just IMPLEMENT_MODULE: this is the game module named in
// OverburstUE.uproject. ObCore is deliberately NOT a listed module and has no
// IMPLEMENT_MODULE of its own — see the long note in ObCore.Build.cs.
IMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, OverburstUE, "OverburstUE");
