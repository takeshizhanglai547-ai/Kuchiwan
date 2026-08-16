// Copyright OVERBURST.
// ============================================================================
//  ObMechKit — the geometry emitters the mech is built from.
//
//  AC_DESIGN.md section 3 is unambiguous: "Angles, not boxes. Every major
//  volume should be a chamfered, tapered or swept form. A rectangular prism is
//  only acceptable as an internal frame member that armour hides." So the
//  workhorse here is a CHAMFERED box, not a box, and the second is a tapered
//  one. There is no primitive in this kit that emits a raw 90-degree corner.
//
//  ---------------------------------------------------------------------------
//  WHY PROCEDURAL MESH AND NOT SCALED ENGINE CUBES
//
//  The zero-import requirement can be met two ways: scale /Engine/BasicShapes
//  static meshes, or generate geometry. Scaling cubes satisfies the letter of
//  "primitive static mesh components" and violates the design bible completely
//  — no chamfers, no tapers, no bell throats, no pointed leading edges, which
//  is the entire shape language. So the default path generates, and
//  UObMechRigComponent keeps the scaled-primitive path as a fallback for anyone
//  who cannot take the ProceduralMeshComponent dependency.
//
//  Cost is favourable either way: geometry is bucketed PER MATERIAL PER NODE
//  and emitted as one mesh section each, so an articulated mech is ~8 sections
//  per node rather than ~170 separate components with ~170 draw calls.
//
//  ---------------------------------------------------------------------------
//  CHAMFER WIDTH IS DELIBERATELY EXAGGERATED — see kBevelGain.
//
//  The web build measured this and left a note worth repeating: a physically
//  honest 5 cm chamfer on a mech viewed at 20-40 m projects to about ONE PIXEL.
//  A one-pixel arris cannot carry a value break, cannot carry the specular
//  streak AC_DESIGN section 6 asks for, and aliases away the moment the mech
//  moves — which is exactly how a frame full of chamfers gets reviewed as "100 %
//  axis-aligned rectangular prisms". Widening the bevel costs zero triangles.
//
//  NOTE: no claim is made that any of this renders. It has never been compiled.
// ============================================================================
#pragma once

#include "ObCoreInc.h"

/** Vertex/index buckets for one material slot. Filled, then handed to a
 *  UProceduralMeshComponent section (or discarded, in the fallback path). */
struct FObMeshBucket
{
	TArray<FVector> Positions;
	TArray<int32> Triangles;
	TArray<FVector> Normals;
	TArray<FVector2D> UVs;
	/** R = bevel mask (0 on a chamfer strip, 1 on a flat face) so the material
	 *  can rub bare metal through the paint on the arris only.
	 *  G = baked ambient occlusion. B = wear seed. */
	TArray<FColor> Colors;
	TArray<FProcMeshTangent> Tangents;

	void Reset()
	{
		Positions.Reset();
		Triangles.Reset();
		Normals.Reset();
		UVs.Reset();
		Colors.Reset();
		Tangents.Reset();
	}

	bool IsEmpty() const { return Triangles.Num() == 0; }
};

/**
 * Emits obrig::Part primitives into per-material buckets.
 *
 * Everything is in UNREAL UNITS by the time it lands in a bucket: the rig is
 * authored in ObCore metres and converted on the way in, through ObUnits.h and
 * nothing else.
 */
class OVERBURSTUE_API FObMechKit
{
public:
	explicit FObMechKit(TArray<FObMeshBucket>& InBuckets) : Buckets(InBuckets) {}

	/** Chamfer width as a multiple of the authored value. See the header. */
	static constexpr float kBevelGain = 2.05f;

	/** Emit one part, positioned in its NODE's local space. */
	void Emit(const obrig::Part& Part);

	/** Triangles emitted so far, across every bucket. */
	int32 TriangleCount() const;

private:
	// --- primitives ---------------------------------------------------------
	//
	// All four box forms share ONE generator. A taper is a box whose top
	// half-extents differ from its bottom; a wedge is a box whose -Z end
	// collapses toward an edge. Expressing them as deformations of a single
	// chamfered hull means there is exactly one piece of chamfer code to be
	// right, and the chamfer survives the deformation.
	void AddDeformedBox(const obrig::Part& P, int32 Bucket,
	                    float TopScaleX, float TopScaleZ, float NoseScaleX, float AoBase);

	void AddCylinder(const obrig::Part& P, int32 Bucket, float Radius, float Length, int32 Segments,
	                 float AoBase);
	void AddTorus(const obrig::Part& P, int32 Bucket, float Radius, float Tube, int32 Segments,
	              int32 RingSegments, float AoBase);
	/** A bell with a REAL throat: outer wall, inner wall, rim. A flat glowing
	 *  disc reads as a sticker (AC_DESIGN section 5). */
	void AddBell(const obrig::Part& P, int32 Bucket, float Throat, float Exit, float Depth,
	             int32 Segments);
	/** Raised hub plus a hex cap — the joint tell that reads at 20-40 m. */
	void AddBoss(const obrig::Part& P, int32 Bucket, float Radius, float Stand);
	/** Ribbed rubber boot: a short stack of rings of alternating radius. */
	void AddBoot(const obrig::Part& P, int32 Bucket, float Radius, float Length, int32 Ribs);
	/** Recessed frame with slats. */
	void AddVent(const obrig::Part& P, int32 Bucket, float W, float H, float Depth, int32 Slats);

	// --- helpers ------------------------------------------------------------
	FTransform PartTransform(const obrig::Part& P) const;
	int32 BucketFor(obrig::Mat M) const { return static_cast<int32>(M); }

	void PushQuad(FObMeshBucket& B, const FVector& A, const FVector& C,
	              const FVector& D, const FVector& E, float BevelMask, float Ao);
	void PushTri(FObMeshBucket& B, const FVector& A, const FVector& C, const FVector& D,
	             float BevelMask, float Ao);

	TArray<FObMeshBucket>& Buckets;
	FTransform Current = FTransform::Identity;
};
