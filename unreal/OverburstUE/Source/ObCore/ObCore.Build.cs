// Copyright OVERBURST.
//
// ============================================================================
//  ObCore — the engine-free simulation, built as a UBT library module.
//
//  READ THIS BEFORE CHANGING ANY SETTING IN THIS FILE.
//
//  ObCore's whole value is that it contains ZERO Unreal headers, so it can be
//  compiled and RUN outside the engine (unreal/tests, plain clang/g++) and
//  every number in it is measured rather than asserted. Each setting below
//  exists to keep the in-engine compile identical to that out-of-engine one.
//  A "tidy-up" here can quietly reintroduce the engine into ObCore's
//  translation units and break the guarantee without breaking the build.
//
//  1. NO SHARED PCH — and this one is not cosmetic.
//     With a shared PCH, UBT force-includes SharedPCH.Core.h (-> CoreMinimal.h)
//     into every .cpp in this module. CoreMinimal.h defines `PI` as an
//     OBJECT-LIKE MACRO. ObTypes.h declares `constexpr float PI` inside
//     namespace ob. Macro expansion does not respect namespaces, so that line
//     becomes `constexpr float (3.1415926535897932f) = ...` and the module
//     fails to compile. NoSharedPCHs is what stops that.
//     (The same collision on the consuming side is handled by ObCoreInc.h in
//     the OverburstUE module — every UE translation unit reaches ObCore
//     through that shim and nothing else.)
//
//  2. NO UNITY BUILD. Unity concatenates several .cpp files into one
//     translation unit. ObCore is verified as one-TU-per-.cpp by the container
//     test build; compiling it a different way in the engine means the thing
//     that was measured is not the thing that shipped. The module is small
//     enough that the build-time cost is irrelevant.
//
//  3. NO MODULE DEPENDENCIES AT ALL, not even "Core". Listing Core would make
//     its include paths available and invite the first accidental
//     #include "CoreMinimal.h", which is the failure this whole split exists
//     to prevent. If it does not compile with `g++ -std=c++17 -Wall -Wextra`
//     and nothing else, it does not belong in this module.
//
//  4. bRequiresImplementModule = false. ObCore has no IMPLEMENT_MODULE, because
//     IMPLEMENT_MODULE lives in Modules/ModuleManager.h, which is an Unreal
//     header, which is the one thing ObCore may not have. It is therefore not
//     listed in OverburstUE.uproject's Modules array either: it is linked as a
//     dependency of OverburstUE, never loaded by name through ModuleManager.
//     >>> If your UBT version rejects this property, the one-line fallback is a
//     >>> new file Source/ObCore/Private/ObCoreModule.cpp containing
//     >>>     #include "Modules/ModuleManager.h"
//     >>>     IMPLEMENT_MODULE(FDefaultModuleImpl, ObCore);
//     >>> and deleting the line below. That file is the ONLY Unreal-touching
//     >>> file permitted under Source/ObCore, and only if UBT forces it.
// ============================================================================
using UnrealBuildTool;

public class ObCore : ModuleRules
{
	public ObCore(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.NoSharedPCHs;
		bUseUnity = false;

		// See (4). No IMPLEMENT_MODULE, because that macro is an Unreal header.
		bRequiresImplementModule = false;

		// See (3). Deliberately empty. Do not add "Core" here.
		PublicDependencyModuleNames.Clear();
		PrivateDependencyModuleNames.Clear();

		// Unreal already builds with both off; stated explicitly so the module
		// matches the flags the container test build uses
		// (-fno-exceptions -fno-rtti) rather than inheriting them by luck.
		bUseRTTI = false;
		bEnableExceptions = false;

		// ObCore is authored to C++17 and the test build pins -std=c++17. The
		// engine standard is deliberately NOT overridden here: a module
		// compiled to a different standard than the module including its
		// headers is an ODR hazard, and the header set is shared. The C++17
		// source is valid C++20; the test build is the stricter of the two.
	}
}
