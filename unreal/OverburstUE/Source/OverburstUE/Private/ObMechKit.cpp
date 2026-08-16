// Copyright OVERBURST.
#include "ObMechKit.h"

#include "ObUnitsUE.h"
#include "ProceduralMeshComponent.h"

namespace
{
	/** Box-projected UVs in node-local space, so panel lines run continuously
	 *  across every plate of a body part instead of restarting per primitive. */
	FVector2D BoxUv(const FVector& P, const FVector& N)
	{
		const double Ax = FMath::Abs(N.X), Ay = FMath::Abs(N.Y), Az = FMath::Abs(N.Z);
		constexpr double kTile = 0.01;   // one texture tile per metre (100 uu)
		if (Az >= Ax && Az >= Ay) return FVector2D(P.X * kTile, P.Y * kTile);
		if (Ax >= Ay) return FVector2D(P.Y * kTile, P.Z * kTile);
		return FVector2D(P.X * kTile, P.Z * kTile);
	}
}

// ---------------------------------------------------------------------------
//  Transform for one part: node-local metres -> Unreal units, plus the part's
//  own euler. The conversion goes through ObUnits and nowhere else.
// ---------------------------------------------------------------------------
FTransform FObMechKit::PartTransform(const obrig::Part& P) const
{
	const FVector Loc = ObUnits::Pos(ob::Vec3(P.x, P.y, P.z));

	// The rig's eulers are ObCore-space (X right, Y up, Z back). Under the axis
	// map, an ObCore rotation about Y is an Unreal rotation about Z, about X is
	// about Y, and about Z is about X — with the sign flips the handedness
	// change implies. Composed as quaternions in that order so it stays a pure
	// relabelling rather than a re-derivation.
	const FQuat Qy(FVector::UpVector, -static_cast<double>(P.ry));
	const FQuat Qx(FVector::YAxisVector, -static_cast<double>(P.rx));
	const FQuat Qz(FVector::XAxisVector, -static_cast<double>(P.rz));
	return FTransform(Qy * Qx * Qz, Loc);
}

void FObMechKit::PushTri(FObMeshBucket& B, const FVector& A, const FVector& C, const FVector& D,
                         float BevelMask, float Ao)
{
	const FVector N = FVector::CrossProduct(C - A, D - A).GetSafeNormal();
	const int32 Base = B.Positions.Num();

	const FColor Col(static_cast<uint8>(FMath::Clamp(BevelMask, 0.0f, 1.0f) * 255.0f),
	                 static_cast<uint8>(FMath::Clamp(Ao, 0.0f, 1.0f) * 255.0f),
	                 0, 255);

	const FVector Pts[3] = { A, C, D };
	for (const FVector& Pt : Pts)
	{
		B.Positions.Add(Pt);
		B.Normals.Add(N);
		B.UVs.Add(BoxUv(Pt, N));
		B.Colors.Add(Col);
		B.Tangents.Add(FProcMeshTangent(FVector::CrossProduct(N, FVector::UpVector).GetSafeNormal(), false));
	}
	B.Triangles.Add(Base);
	B.Triangles.Add(Base + 1);
	B.Triangles.Add(Base + 2);
}

void FObMechKit::PushQuad(FObMeshBucket& B, const FVector& A, const FVector& C,
                          const FVector& D, const FVector& E, float BevelMask, float Ao)
{
	// Flat-shaded: each triangle carries its own normal. Hard-surface armour
	// wants a hard crease at every edge, and smoothing them is what makes a
	// procedural mech read as soft plastic.
	PushTri(B, A, C, D, BevelMask, Ao);
	PushTri(B, A, D, E, BevelMask, Ao);
}

int32 FObMechKit::TriangleCount() const
{
	int32 N = 0;
	for (const FObMeshBucket& B : Buckets)
	{
		N += B.Triangles.Num() / 3;
	}
	return N;
}

// ---------------------------------------------------------------------------
//  The chamfered box, and its taper / wedge deformations.
//
//  Built as 6 flat faces inset by the chamfer, 12 bevel strips along the edges
//  and 8 corner triangles — 44 triangles, the same count whatever the bevel
//  width, which is why widening it for readability is free.
//
//  TopScaleX / TopScaleZ  scale the +Y end   -> taper
//  NoseScaleX             scales the -Z end  -> pointed leading edge
// ---------------------------------------------------------------------------
void FObMechKit::AddDeformedBox(const obrig::Part& P, int32 Bucket,
                                float TopScaleX, float TopScaleZ, float NoseScaleX, float AoBase)
{
	FObMeshBucket& B = Buckets[Bucket];

	const double HalfX = ObUnits::Len(P.w) * 0.5;
	const double HalfY = ObUnits::Len(P.h) * 0.5;
	const double HalfZ = ObUnits::Len(P.d) * 0.5;

	// Chamfer, widened for readability and then clamped so a thin plate cannot
	// inflate into an octagon.
	const double C = FMath::Clamp(ObUnits::Len(P.chamfer) * kBevelGain,
	                              ObUnits::Len(0.004f),
	                              FMath::Min3(HalfX, HalfY, HalfZ) * 0.42);

	// Unit-cube corner -> deformed local point. u,v,w each in {-1, +1} for a
	// corner or scaled to the inset for a face.
	auto Pt = [&](double Ux, double Uy, double Uz) -> FVector
	{
		// v runs 0 at the -Y end to 1 at the +Y end; n runs 0 at the -Z nose.
		const double V = (Uy + 1.0) * 0.5;
		const double Nz = (Uz + 1.0) * 0.5;
		const double Sx = FMath::Lerp(1.0, static_cast<double>(TopScaleX), V)
		                  * FMath::Lerp(static_cast<double>(NoseScaleX), 1.0, Nz);
		const double Sz = FMath::Lerp(1.0, static_cast<double>(TopScaleZ), V);
		// ObCore local (x right, y up, z back) -> Unreal (X fwd, Y right, Z up).
		const FVector Local(-Uz * HalfZ * Sz, Ux * HalfX * Sx, Uy * HalfY);
		return Current.TransformPosition(Local);
	};

	const double Ix = 1.0 - C / HalfX;   // inset fractions
	const double Iy = 1.0 - C / HalfY;
	const double Iz = 1.0 - C / HalfZ;

	// --- 6 flat faces, inset ---
	// +X / -X
	for (int32 S = 0; S < 2; ++S)
	{
		const double Sx = (S == 0) ? -1.0 : 1.0;
		PushQuad(B, Pt(Sx, -Iy, -Iz), Pt(Sx, -Iy, Iz), Pt(Sx, Iy, Iz), Pt(Sx, Iy, -Iz), 1.0f, AoBase);
		const double Sy = (S == 0) ? -1.0 : 1.0;
		PushQuad(B, Pt(-Ix, Sy, -Iz), Pt(Ix, Sy, -Iz), Pt(Ix, Sy, Iz), Pt(-Ix, Sy, Iz), 1.0f, AoBase);
		const double Sz2 = (S == 0) ? -1.0 : 1.0;
		PushQuad(B, Pt(-Ix, -Iy, Sz2), Pt(Ix, -Iy, Sz2), Pt(Ix, Iy, Sz2), Pt(-Ix, Iy, Sz2), 1.0f, AoBase);
	}

	// --- 12 bevel strips. Mask 0 => bare metal rubbed through the paint. ---
	const float Bevel = 0.0f;
	for (int32 A = 0; A < 2; ++A)
	{
		for (int32 Bb = 0; Bb < 2; ++Bb)
		{
			const double Sa = (A == 0) ? -1.0 : 1.0;
			const double Sb = (Bb == 0) ? -1.0 : 1.0;
			// edges along Z
			PushQuad(B, Pt(Sa, Sb * Iy, -Iz), Pt(Sa, Sb * Iy, Iz),
			         Pt(Sa * Ix, Sb, Iz), Pt(Sa * Ix, Sb, -Iz), Bevel, AoBase * 0.85f);
			// edges along Y
			PushQuad(B, Pt(Sa, -Iy, Sb * Iz), Pt(Sa * Ix, -Iy, Sb),
			         Pt(Sa * Ix, Iy, Sb), Pt(Sa, Iy, Sb * Iz), Bevel, AoBase * 0.85f);
			// edges along X
			PushQuad(B, Pt(-Ix, Sa, Sb * Iz), Pt(Ix, Sa, Sb * Iz),
			         Pt(Ix, Sa * Iy, Sb), Pt(-Ix, Sa * Iy, Sb), Bevel, AoBase * 0.85f);
		}
	}

	// --- 8 corner triangles ---
	for (int32 I = 0; I < 8; ++I)
	{
		const double Sx = (I & 1) ? 1.0 : -1.0;
		const double Sy = (I & 2) ? 1.0 : -1.0;
		const double Sz = (I & 4) ? 1.0 : -1.0;
		PushTri(B, Pt(Sx, Sy * Iy, Sz * Iz), Pt(Sx * Ix, Sy, Sz * Iz), Pt(Sx * Ix, Sy * Iy, Sz),
		        Bevel, AoBase * 0.72f);
	}
}

// ---------------------------------------------------------------------------
void FObMechKit::AddCylinder(const obrig::Part& P, int32 Bucket, float Radius, float Length,
                             int32 Segments, float AoBase)
{
	FObMeshBucket& B = Buckets[Bucket];
	const double R = ObUnits::Len(Radius);
	const double H = ObUnits::Len(Length) * 0.5;

	auto Ring = [&](int32 I, double Y) -> FVector
	{
		const double A = (2.0 * UE_DOUBLE_PI * I) / Segments;
		return Current.TransformPosition(FVector(-FMath::Sin(A) * R, FMath::Cos(A) * R, Y));
	};

	for (int32 I = 0; I < Segments; ++I)
	{
		const int32 J = (I + 1) % Segments;
		PushQuad(B, Ring(I, -H), Ring(J, -H), Ring(J, H), Ring(I, H), 1.0f, AoBase);
		// caps
		PushTri(B, Current.TransformPosition(FVector(0, 0, H)), Ring(I, H), Ring(J, H), 1.0f, AoBase * 0.9f);
		PushTri(B, Current.TransformPosition(FVector(0, 0, -H)), Ring(J, -H), Ring(I, -H), 1.0f, AoBase * 0.9f);
	}
}

void FObMechKit::AddTorus(const obrig::Part& P, int32 Bucket, float Radius, float Tube,
                          int32 Segments, int32 RingSegments, float AoBase)
{
	FObMeshBucket& B = Buckets[Bucket];
	const double R = ObUnits::Len(Radius);
	const double T = ObUnits::Len(Tube);

	auto At = [&](int32 I, int32 K) -> FVector
	{
		const double A = (2.0 * UE_DOUBLE_PI * I) / Segments;
		const double Bt = (2.0 * UE_DOUBLE_PI * K) / RingSegments;
		const double Rr = R + FMath::Cos(Bt) * T;
		return Current.TransformPosition(
			FVector(-FMath::Sin(A) * Rr, FMath::Cos(A) * Rr, FMath::Sin(Bt) * T));
	};

	for (int32 I = 0; I < Segments; ++I)
	{
		for (int32 K = 0; K < RingSegments; ++K)
		{
			const int32 I2 = (I + 1) % Segments;
			const int32 K2 = (K + 1) % RingSegments;
			PushQuad(B, At(I, K), At(I2, K), At(I2, K2), At(I, K2), 1.0f, AoBase);
		}
	}
}

// ---------------------------------------------------------------------------
//  Bell nozzle with a visible throat.
//
//  Three surfaces, not one: the outer wall, the INNER wall running back down to
//  the throat, and the rim joining them. The inner wall is what gives the
//  throat depth AC_DESIGN section 5 demands — without it the exhaust is a flat
//  disc, and a flat glowing disc reads as a sticker at any distance.
// ---------------------------------------------------------------------------
void FObMechKit::AddBell(const obrig::Part& P, int32 Bucket, float Throat, float Exit, float Depth,
                         int32 Segments)
{
	FObMeshBucket& B = Buckets[Bucket];
	const double R0 = ObUnits::Len(Throat);
	const double R1 = ObUnits::Len(Exit);
	const double D = ObUnits::Len(Depth);

	auto At = [&](int32 I, double R, double Y) -> FVector
	{
		const double A = (2.0 * UE_DOUBLE_PI * I) / Segments;
		return Current.TransformPosition(FVector(-FMath::Sin(A) * R, FMath::Cos(A) * R, Y));
	};

	const double Back = -D * 0.5, Front = D * 0.5;
	for (int32 I = 0; I < Segments; ++I)
	{
		const int32 J = (I + 1) % Segments;
		// outer wall, throat -> exit
		PushQuad(B, At(I, R0, Back), At(J, R0, Back), At(J, R1, Front), At(I, R1, Front), 1.0f, 0.55f);
		// inner wall, exit -> throat. Darker AO: this is the heat-stained bore.
		PushQuad(B, At(I, R1 * 0.94, Front), At(J, R1 * 0.94, Front),
		         At(J, R0 * 0.72, Back + D * 0.12), At(I, R0 * 0.72, Back + D * 0.12), 1.0f, 0.12f);
		// rim
		PushQuad(B, At(I, R1, Front), At(J, R1, Front), At(J, R1 * 0.94, Front), At(I, R1 * 0.94, Front),
		         0.0f, 0.75f);
		// throat floor
		PushTri(B, Current.TransformPosition(FVector(0, 0, Back + D * 0.12)),
		        At(J, R0 * 0.72, Back + D * 0.12), At(I, R0 * 0.72, Back + D * 0.12), 1.0f, 0.08f);
	}
}

void FObMechKit::AddBoss(const obrig::Part& P, int32 Bucket, float Radius, float Stand)
{
	// Hub, then a hex cap standing proud of it. The hex is the genre tell: a
	// plain disc reads as a bolt head, a hex cap reads as a serviceable pivot.
	obrig::Part Hub = P;
	Hub.w = Radius * 2.0f;
	Hub.h = Stand;
	AddCylinder(Hub, Bucket, Radius, Stand, 14, 0.5f);

	FObMeshBucket& B = Buckets[Bucket];
	const double R = ObUnits::Len(Radius) * 0.62;
	const double Y = ObUnits::Len(Stand) * 0.5;
	const double Cap = ObUnits::Len(Stand) * 0.34;
	auto Hex = [&](int32 I, double Yy) -> FVector
	{
		const double A = (2.0 * UE_DOUBLE_PI * I) / 6.0;
		return Current.TransformPosition(FVector(-FMath::Sin(A) * R, FMath::Cos(A) * R, Yy));
	};
	for (int32 I = 0; I < 6; ++I)
	{
		const int32 J = (I + 1) % 6;
		PushQuad(B, Hex(I, Y), Hex(J, Y), Hex(J, Y + Cap), Hex(I, Y + Cap), 1.0f, 0.62f);
		PushTri(B, Current.TransformPosition(FVector(0, 0, Y + Cap)), Hex(I, Y + Cap), Hex(J, Y + Cap),
		        1.0f, 0.70f);
	}
}

void FObMechKit::AddBoot(const obrig::Part& P, int32 Bucket, float Radius, float Length, int32 Ribs)
{
	// Alternating radii give the ribbed rubber concertina AC_DESIGN asks for at
	// the ankle. Dark, matte, and read entirely by shape.
	const float Step = Length / FMath::Max(1, Ribs);
	for (int32 I = 0; I < Ribs; ++I)
	{
		obrig::Part Rib = P;
		Rib.y = P.y - Length * 0.5f + Step * (I + 0.5f);
		const float R = Radius * ((I % 2 == 0) ? 1.0f : 0.84f);
		Current = PartTransform(Rib);
		AddCylinder(Rib, Bucket, R, Step * 0.94f, 12, 0.30f);
	}
	Current = PartTransform(P);
}

void FObMechKit::AddVent(const obrig::Part& P, int32 Bucket, float W, float H, float Depth, int32 Slats)
{
	// A recessed frame with slats inside it. The recess is what makes the vent
	// a hole rather than a decal, and the slats are what make it a vent rather
	// than a hole.
	obrig::Part Recess = P;
	Recess.w = W;
	Recess.h = H;
	Recess.d = Depth;
	Recess.chamfer = FMath::Min(P.chamfer, Depth * 0.30f);
	Current = PartTransform(Recess);
	AddDeformedBox(Recess, Bucket, 1.0f, 1.0f, 1.0f, /*AoBase=*/0.18f);

	const float Step = H / FMath::Max(1, Slats + 1);
	for (int32 I = 0; I < Slats; ++I)
	{
		obrig::Part Slat = P;
		Slat.y = P.y - H * 0.5f + Step * (I + 1);
		Slat.w = W * 0.92f;
		Slat.h = Step * 0.42f;
		Slat.d = Depth * 0.55f;
		Slat.z = P.z - Depth * 0.18f;
		Slat.rx = P.rx + 0.42f;   // tilted, so the slats catch the key light
		Slat.chamfer = Slat.h * 0.30f;
		Current = PartTransform(Slat);
		AddDeformedBox(Slat, Bucket, 1.0f, 1.0f, 1.0f, 0.42f);
	}
	Current = PartTransform(P);
}

// ---------------------------------------------------------------------------
void FObMechKit::Emit(const obrig::Part& Part)
{
	const int32 Bucket = BucketFor(Part.mat);
	if (!Buckets.IsValidIndex(Bucket))
	{
		return;
	}

	Current = PartTransform(Part);

	// Recessed parts get a darker baked AO than proud plates. This is the
	// panel-line darkening ART_DIRECTION asks for, done in vertex colour so it
	// costs no texture.
	const float Ao = Part.detail ? 0.42f : 0.62f;

	switch (Part.shape)
	{
	case obrig::Shape::Plate:
		AddDeformedBox(Part, Bucket, 1.0f, 1.0f, 1.0f, Ao);
		break;

	case obrig::Shape::Taper:
		AddDeformedBox(Part, Bucket,
		               Part.w > KINDA_SMALL_NUMBER ? Part.wT / Part.w : 1.0f,
		               Part.d > KINDA_SMALL_NUMBER ? Part.dT / Part.d : 1.0f,
		               1.0f, Ao);
		break;

	case obrig::Shape::Wedge:
		// 0.24 rather than 0: a true knife edge is fragile in silhouette and
		// impossible to light. AC_DESIGN wants a POINTED leading edge, and a
		// narrow flat reads as pointed while still catching the key.
		AddDeformedBox(Part, Bucket, 1.0f, 1.0f, 0.24f, Ao);
		break;

	case obrig::Shape::Rod:
		AddCylinder(Part, Bucket, Part.w * 0.5f, Part.h, 12, Ao);
		break;

	case obrig::Shape::Ring:
		AddTorus(Part, Bucket, (Part.w - Part.h) * 0.5f, Part.h * 0.5f, 16, 6, Ao);
		break;

	case obrig::Shape::Nozzle:
		AddBell(Part, Bucket, Part.w * 0.5f, Part.d * 0.5f, Part.h, 14);
		break;

	case obrig::Shape::Boss:
		AddBoss(Part, Bucket, Part.w * 0.5f, Part.h);
		break;

	case obrig::Shape::Boot:
		AddBoot(Part, Bucket, Part.w * 0.5f, Part.h, 4);
		break;

	case obrig::Shape::Vent:
		AddVent(Part, Bucket, Part.w, Part.h, Part.d, 4);
		break;

	default:
		AddDeformedBox(Part, Bucket, 1.0f, 1.0f, 1.0f, Ao);
		break;
	}
}
