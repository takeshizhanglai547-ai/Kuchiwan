// Copyright OVERBURST.
// ============================================================================
//  FVector-typed face of the unit boundary.
//
//  Every function here is a ONE-LINE forward to ObUnits.h, which holds the
//  actual conversion and is compiled and measured by unreal/tests. Nothing in
//  this file may contain arithmetic beyond unpacking a struct: the moment a
//  second copy of the swizzle exists, the tested one stops being authoritative
//  and the two drift.
//
//  If you are reading this because something in the world is mirrored, the
//  place to look is ObUnits.h and Suite_Units in unreal/tests/test_ue_layer.cpp
//  — not here.
// ============================================================================
#pragma once

#include "ObCoreInc.h"

namespace ObUnits
{
	FORCEINLINE FVector Pos(const ob::Vec3& Metres)
	{
		const obu::Uu3 U = obu::PosToUe(Metres);
		return FVector(U.X, U.Y, U.Z);
	}

	FORCEINLINE ob::Vec3 Pos(const FVector& Uu)
	{
		return obu::PosToOb(Uu.X, Uu.Y, Uu.Z);
	}

	FORCEINLINE FVector Dir(const ob::Vec3& D)
	{
		const obu::Uu3 U = obu::DirToUe(D);
		return FVector(U.X, U.Y, U.Z);
	}

	FORCEINLINE ob::Vec3 Dir(const FVector& D)
	{
		return obu::DirToOb(D.X, D.Y, D.Z);
	}

	FORCEINLINE FVector Vel(const ob::Vec3& V)
	{
		const obu::Uu3 U = obu::VelToUe(V);
		return FVector(U.X, U.Y, U.Z);
	}

	FORCEINLINE ob::Vec3 Vel(const FVector& V)
	{
		return obu::VelToOb(V.X, V.Y, V.Z);
	}

	FORCEINLINE double Len(float Metres) { return obu::LenToUe(Metres); }
	FORCEINLINE float Len(double Uu) { return obu::LenToOb(Uu); }

	/** ObCore yaw+pitch -> an Unreal rotator. Roll is always zero: ObCore has
	 *  no roll, and the camera's boost roll is a PRESENTATION effect applied on
	 *  top by the pawn, never fed back into the solver. */
	FORCEINLINE FRotator Rot(float ObYaw, float ObPitch)
	{
		return FRotator(obu::PitchToUeDeg(ObPitch), obu::YawToUeDeg(ObYaw), 0.0);
	}

	FORCEINLINE float YawFrom(const FRotator& R) { return obu::YawToOb(R.Yaw); }
	FORCEINLINE float PitchFrom(const FRotator& R) { return obu::PitchToOb(R.Pitch); }

	/** ObCore feet position -> the UE capsule component's centre. */
	FORCEINLINE FVector FeetToCentre(const ob::Vec3& FeetMetres, float CapsuleHeightM)
	{
		const obu::Uu3 U = obu::FeetToCapsuleCentre(FeetMetres, CapsuleHeightM);
		return FVector(U.X, U.Y, U.Z);
	}

	/** ...and back. */
	FORCEINLINE ob::Vec3 CentreToFeet(const FVector& Centre, float CapsuleHeightM)
	{
		return obu::CapsuleCentreToFeet(Centre.X, Centre.Y, Centre.Z, CapsuleHeightM);
	}

	/** cfg::Cam::Fov is VERTICAL; UCameraComponent::FieldOfView is HORIZONTAL. */
	FORCEINLINE float HorizontalFov(float VerticalFovDeg, float Aspect)
	{
		return static_cast<float>(obu::VFovToHFovDeg(VerticalFovDeg, Aspect));
	}
}
