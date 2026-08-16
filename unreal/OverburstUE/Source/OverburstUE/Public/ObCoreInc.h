// Copyright OVERBURST.
// ============================================================================
//  THE ONLY DOOR FROM UNREAL INTO ObCore. Include this, never an ObCore header
//  directly.
//
//  ---------------------------------------------------------------------------
//  WHY THIS FILE EXISTS — READ BEFORE "SIMPLIFYING" IT AWAY
//
//  Unreal's Math/UnrealMathUtility.h (pulled in by CoreMinimal.h, which is
//  pulled in by everything) defines PI as an OBJECT-LIKE MACRO:
//
//      #define PI (3.1415926535897932f)
//
//  ObCore's ObTypes.h declares a namespaced constant with the same spelling:
//
//      namespace ob { constexpr float PI = 3.14159265358979323846f; }
//
//  The preprocessor does not know about namespaces. In any translation unit
//  where CoreMinimal.h is seen first — which is every translation unit in this
//  module — that line expands to
//
//      constexpr float (3.1415926535897932f) = 3.14159265358979323846f;
//
//  and the module does not compile. The error surfaces inside ObTypes.h, a file
//  nobody in this module edited, which makes it look like ObCore is broken when
//  it is not: ObCore compiles cleanly on its own (unreal/tests proves that on
//  every run) and it is the ENGINE that is redefining the name.
//
//  The fix is to undefine PI across the ObCore includes and put it back
//  afterwards, so engine headers included later still see the macro they
//  expect. That is exactly what this file does.
//
//  >>> CONSEQUENCE, AND IT IS A RULE FOR THIS MODULE:
//  >>> never write `ob::PI` in Source/OverburstUE. After the pop_macro below,
//  >>> `ob::PI` expands to `ob::(3.14159f)` and fails. Use UE_PI (or PI) — they
//  >>> are the same number to float precision. ObCore's OWN uses of ob::PI are
//  >>> fine: they are all inside the region guarded here.
//
//  The clean long-term fix belongs in ObCore, not here: rename its constant to
//  ob::Pi. That is a one-line change in a module this module does not own, so
//  it is flagged rather than made.
//
//  ---------------------------------------------------------------------------
//  Nothing in ObCore is Unreal-aware. It knows about no UObject, no AActor, no
//  FVector; it takes an ob::IWorldQuery and returns plain structs. Everything
//  that crosses is converted through ObUnits.h / ObUnitsUE.h and nowhere else.
// ============================================================================
#pragma once

#include "CoreMinimal.h"

// --- ObCore region: engine macros that collide with ObCore identifiers -------
#pragma push_macro("PI")
#undef PI

#include "ObTypes.h"
#include "ObConfig.h"
#include "ObWorldQuery.h"
#include "ObEnergy.h"
#include "ObStagger.h"
#include "ObMovement.h"
#include "ObBallistics.h"
#include "ObWeapons.h"
#include "ObAI.h"
#include "ObMission.h"

// The two engine-free headers this module owns. They live here rather than in
// ObCore because this module owns them, and they are written without an Unreal
// dependency so unreal/tests can measure them. Included inside the guarded
// region because ObMechRig.h uses ob::PI in its inline builders.
#include "ObUnits.h"
#include "ObMechRig.h"

#pragma pop_macro("PI")
// --- end ObCore region -------------------------------------------------------
