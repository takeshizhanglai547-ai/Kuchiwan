// ============================================================================
//  THE UNIT BOUNDARY. The whole conversion, and the only copy of it.
//
//  ENGINE-FREE BY CONTRACT. This header includes ObCore and <cmath> and
//  nothing else, on purpose: it is compiled and RUN by unreal/tests (see
//  test_ue_layer.cpp), which is the only way any claim about the conversion
//  can be VERIFIED rather than merely reviewed. Do not add an Unreal include
//  here; the FVector-typed helpers live in ObUnitsUE.h next door, and they are
//  one-line forwards to the functions below.
//
//  ------------------------------------------------------------------------
//  THE TWO SYSTEMS
//
//    ObCore    metres,      RIGHT-handed, Y up.
//              At yaw 0:  forward = (0, 0, -1)   [ObTypes.h ForwardFromYaw]
//                         right   = (1, 0,  0)   [ObTypes.h RightFromYaw]
//                         up      = (0, 1,  0)
//              Positions are the mech's FEET.
//
//    Unreal    centimetres, LEFT-handed, Z up.
//              forward = +X,  right = +Y,  up = +Z.
//              A capsule component's origin is its CENTRE.
//
//  THE MAP        UE.X = -ob.z      UE.Y = +ob.x      UE.Z = +ob.y
//
//  Check it on the basis, which is the only check that matters:
//      ob forward (0,0,-1) -> UE ( 1, 0, 0)   = +X   forward   OK
//      ob right   (1,0, 0) -> UE ( 0, 1, 0)   = +Y   right     OK
//      ob up      (0,1, 0) -> UE ( 0, 0, 1)   = +Z   up        OK
//
//  The matrix is [[0,0,-1],[1,0,0],[0,1,0]], determinant -1. The sign flip is
//  not a bug to be corrected: it IS the right-to-left handedness change, and a
//  map with determinant +1 would be the broken one. ObCore's basis satisfies
//  forward x right = -up (right-handed); Unreal's satisfies forward x right =
//  +up. Any conversion between them must flip.
//
//  YAW        ob yaw is measured so that forward = (-sin, 0, -cos), which runs
//             the OPPOSITE way round from Unreal's yaw. Hence the negation:
//                 UE yaw (deg) = -ob yaw (rad) * 180/pi
//             Verified on two bearings, not one, in the test suite: a single
//             sample at yaw 0 passes for both the correct map and the
//             sign-flipped one.
//
//  PITCH      both measure positive as nose-up, so pitch is a pure unit change.
//
//  FEET vs CENTRE   ObCore's position is the sole of the foot. A UE capsule is
//             centred on its own origin. Converting the position without also
//             lifting by the capsule half-height buries the mech to the waist
//             in the deck. That offset is applied HERE (FeetToCapsuleCentreUu)
//             so no caller has to remember it.
//
//  ------------------------------------------------------------------------
//  THE RULE THIS FILE EXISTS TO ENFORCE
//  The literal 100, the axis swizzle and the yaw negation appear in this file
//  and nowhere else in the Unreal module. Grepping the module for `* 100`,
//  `M_TO_UU` or `UU_TO_M` outside this header should return nothing. If a
//  gameplay file needs metres in Unreal space, it calls a function from here.
// ============================================================================
#pragma once

#include "ObTypes.h"

namespace obu {

/** ObCore metres -> Unreal units. The single scale factor, from ObCore. */
inline constexpr double MToUu = static_cast<double>(ob::M_TO_UU);
inline constexpr double UuToM = static_cast<double>(ob::UU_TO_M);

inline constexpr double RadToDeg = 57.295779513082320876798154814105;
inline constexpr double DegToRad = 0.01745329251994329576923690768489;

/**
 * A point or vector in Unreal's space, as plain doubles.
 *
 * Doubles rather than floats because UE5's FVector is double-precision (LWC),
 * and narrowing at the boundary then widening again inside the engine would
 * quantise world positions for no reason. ObCore stays float — a 500 m arena
 * has no need of more, and float is what its numbers were measured in.
 */
struct Uu3 {
	double X = 0.0;
	double Y = 0.0;
	double Z = 0.0;
};

// ---------------------------------------------------------------------------
//  Directions — swizzle only, no scale. A unit vector is a unit vector in
//  both systems, and multiplying one by 100 is the classic way to get a
//  projectile that travels 100x too far on its first frame.
// ---------------------------------------------------------------------------
inline Uu3 DirToUe(const ob::Vec3& d) { return Uu3{ -static_cast<double>(d.z), static_cast<double>(d.x), static_cast<double>(d.y) }; }

inline ob::Vec3 DirToOb(double x, double y, double z) {
	return ob::Vec3{ static_cast<float>(y), static_cast<float>(z), static_cast<float>(-x) };
}

// ---------------------------------------------------------------------------
//  Positions and lengths — swizzle AND scale.
// ---------------------------------------------------------------------------
inline Uu3 PosToUe(const ob::Vec3& m) {
	return Uu3{ -static_cast<double>(m.z) * MToUu, static_cast<double>(m.x) * MToUu, static_cast<double>(m.y) * MToUu };
}

inline ob::Vec3 PosToOb(double x, double y, double z) {
	return ob::Vec3{ static_cast<float>(y * UuToM), static_cast<float>(z * UuToM), static_cast<float>(-x * UuToM) };
}

/** Velocities convert exactly like positions: m/s -> uu/s is the same scale. */
inline Uu3 VelToUe(const ob::Vec3& v) { return PosToUe(v); }
inline ob::Vec3 VelToOb(double x, double y, double z) { return PosToOb(x, y, z); }

inline constexpr double LenToUe(float metres) { return static_cast<double>(metres) * MToUu; }
inline constexpr float LenToOb(double uu) { return static_cast<float>(uu * UuToM); }

// ---------------------------------------------------------------------------
//  Orientation
// ---------------------------------------------------------------------------
/** ObCore yaw (radians) -> Unreal yaw (degrees). Note the sign. */
inline constexpr double YawToUeDeg(float obYaw) { return -static_cast<double>(obYaw) * RadToDeg; }
inline constexpr float YawToOb(double ueYawDeg) { return static_cast<float>(-ueYawDeg * DegToRad); }

/** ObCore pitch (radians) -> Unreal pitch (degrees). Both are nose-up positive. */
inline constexpr double PitchToUeDeg(float obPitch) { return static_cast<double>(obPitch) * RadToDeg; }
inline constexpr float PitchToOb(double uePitchDeg) { return static_cast<float>(uePitchDeg * DegToRad); }

// ---------------------------------------------------------------------------
//  The capsule
//
//  ObCore's cfg::Player::Radius / ::Height describe a capsule whose extent is
//  exactly [feet, feet + height] — the same convention ObBallistics'
//  StandingCapsule uses. Unreal's UCapsuleComponent is described by a
//  half-height that INCLUDES the hemispherical caps and is measured from the
//  component's centre.
// ---------------------------------------------------------------------------
inline constexpr double CapsuleRadiusUu(float radiusM) { return LenToUe(radiusM); }
inline constexpr double CapsuleHalfHeightUu(float heightM) { return LenToUe(heightM) * 0.5; }

/**
 * Metres of lift from ObCore's feet position to the UE capsule's centre.
 * Always half the capsule height — the sole is at -halfHeight from centre.
 */
inline constexpr double FeetToCapsuleCentreUu(float heightM) { return CapsuleHalfHeightUu(heightM); }

/** Feet (ObCore) -> capsule centre (Unreal), the transform the pawn uses. */
inline Uu3 FeetToCapsuleCentre(const ob::Vec3& feetM, float capsuleHeightM) {
	Uu3 p = PosToUe(feetM);
	p.Z += FeetToCapsuleCentreUu(capsuleHeightM);
	return p;
}

/** Capsule centre (Unreal) -> feet (ObCore), the inverse. */
inline ob::Vec3 CapsuleCentreToFeet(double x, double y, double z, float capsuleHeightM) {
	return PosToOb(x, y, z - FeetToCapsuleCentreUu(capsuleHeightM));
}

// ---------------------------------------------------------------------------
//  Field of view
//
//  cfg::Cam::Fov is the web build's THREE.PerspectiveCamera fov, which is
//  VERTICAL. Unreal's UCameraComponent::FieldOfView is HORIZONTAL. Handing
//  one straight to the other yields a materially wider shot (62 vertical is
//  about 95 horizontal at 16:9), which quietly changes how much of the arena
//  the duel's framing maths in ObAI can see.
// ---------------------------------------------------------------------------
inline double VFovToHFovDeg(double vFovDeg, double aspect) {
	const double v = vFovDeg * DegToRad;
	return 2.0 * std::atan(std::tan(v * 0.5) * aspect) * RadToDeg;
}

inline double HFovToVFovDeg(double hFovDeg, double aspect) {
	const double h = hFovDeg * DegToRad;
	return 2.0 * std::atan(std::tan(h * 0.5) / aspect) * RadToDeg;
}

}  // namespace obu
