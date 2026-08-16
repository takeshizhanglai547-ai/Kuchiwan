// Copyright OVERBURST.
#include "ObProjectilePool.h"

#include "ObUnitsUE.h"
#include "OverburstUE.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "NiagaraComponent.h"

// ===========================================================================
//  AObProjectile
// ===========================================================================
AObProjectile::AObProjectile()
{
	PrimaryActorTick.bCanEverTick = false;   // driven by the pool, not by itself

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);

	Trail = CreateDefaultSubobject<UNiagaraComponent>(TEXT("Trail"));
	Trail->SetupAttachment(Root);
	Trail->bAutoActivate = false;

	SetActorEnableCollision(false);
}

void AObProjectile::DriveTo(const FVector& Location, const FVector& Direction)
{
	SetActorLocationAndRotation(Location, FRotationMatrix::MakeFromX(Direction).Rotator(),
	                            /*bSweep=*/false, nullptr, ETeleportType::TeleportPhysics);
	if (Trail && !Trail->IsActive())
	{
		Trail->Activate(true);
	}
}

void AObProjectile::Retire()
{
	if (Trail)
	{
		// Deactivate rather than destroy, so the smoke ribbon finishes its
		// ~1.2 s life instead of popping out of existence with the missile.
		Trail->Deactivate();
	}
	SetActorHiddenInGame(true);
}

// ===========================================================================
//  AObProjectilePool
// ===========================================================================
AObProjectilePool::AObProjectilePool()
{
	// Not ticked: UObCombatSubsystem calls SyncFrom immediately after
	// Ballistics::Update, so the visuals are never a frame behind the maths.
	// An actor tick would land in an unspecified order relative to that and be
	// exactly one frame stale at 146 m/s, which is 2.4 m of visible lag.
	PrimaryActorTick.bCanEverTick = false;

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);

	auto MakeIsm = [this](const TCHAR* Name) -> UInstancedStaticMeshComponent*
	{
		UInstancedStaticMeshComponent* Ism = CreateDefaultSubobject<UInstancedStaticMeshComponent>(Name);
		Ism->SetupAttachment(Root);
		Ism->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Ism->SetCastShadow(false);        // tracers casting shadows reads as debris
		Ism->SetMobility(EComponentMobility::Movable);
		Ism->NumCustomDataFloats = 1;     // 0..1 age, for fade in the material
		return Ism;
	};

	Tracers = MakeIsm(TEXT("Tracers"));
	Missiles = MakeIsm(TEXT("Missiles"));
	Bolts = MakeIsm(TEXT("Bolts"));

	Scratch.Reserve(ob::Ballistics::MaxBullets);
}

void AObProjectilePool::BeginPlay()
{
	Super::BeginPlay();

	if (Tracers && TracerMesh) { Tracers->SetStaticMesh(TracerMesh); }
	if (Missiles && MissileMesh) { Missiles->SetStaticMesh(MissileMesh); }
	if (Bolts && BoltMesh) { Bolts->SetStaticMesh(BoltMesh); }
	if (Tracers && TracerMaterial) { Tracers->SetMaterial(0, TracerMaterial); }
	if (Missiles && MissileMaterial) { Missiles->SetMaterial(0, MissileMaterial); }
	if (Bolts && BoltMaterial) { Bolts->SetMaterial(0, BoltMaterial); }

	if (!TracerMesh)
	{
		UE_LOG(LogOverburst, Warning,
		       TEXT("AObProjectilePool has no meshes assigned: the ballistics still run and still hit, "
		            "there is simply nothing to see. Assign TracerMesh / MissileMesh / BoltMesh."));
	}
}

void AObProjectilePool::PushInstances(UInstancedStaticMeshComponent* Ism,
                                      const TArray<FTransform>& Transforms)
{
	if (!Ism || !Ism->GetStaticMesh())
	{
		return;
	}

	// Grow/shrink the instance count to match, then rewrite in place. Batched
	// with bMarkRenderStateDirty deferred to a single update at the end:
	// touching an ISM instance one at a time with the flag set rebuilds the
	// render state per call, which is the classic way to make 300 tracers cost
	// more than 300 actors would have.
	const int32 Have = Ism->GetInstanceCount();
	const int32 Want = Transforms.Num();

	for (int32 I = Have; I < Want; ++I)
	{
		Ism->AddInstance(FTransform::Identity, /*bWorldSpace=*/true);
	}
	for (int32 I = Have - 1; I >= Want; --I)
	{
		Ism->RemoveInstance(I);
	}
	for (int32 I = 0; I < Want; ++I)
	{
		Ism->UpdateInstanceTransform(I, Transforms[I], /*bWorldSpace=*/true,
		                             /*bMarkRenderStateDirty=*/false, /*bTeleport=*/true);
	}
	if (Want > 0 || Have > 0)
	{
		Ism->MarkRenderStateDirty();
	}
}

void AObProjectilePool::SyncFrom(const ob::Ballistics& Ballistics)
{
	// ---- bullets: a stretched streak along the direction of travel ----------
	{
		Scratch.Reset();
		const ob::Bullet* Bullets = Ballistics.Bullets();
		for (int32 I = 0; I < ob::Ballistics::MaxBullets; ++I)
		{
			const ob::Bullet& B = Bullets[I];
			if (!B.used)
			{
				continue;
			}
			const FVector Pos = ObUnits::Pos(B.pos);
			const FVector Dir = ObUnits::Dir(B.vel.Normalised());
			// Scale X to the tracer length; the mesh is authored one unit long
			// along +X. The streak is a readability device, not a measurement:
			// a round crossing 10 m per frame drawn at its true length is a
			// single invisible pixel.
			const double Len = ObUnits::Len(TracerLengthM);
			Scratch.Add(FTransform(FRotationMatrix::MakeFromX(Dir).Rotator(), Pos,
			                       FVector(Len * 0.01, 1.0, 1.0)));
		}
		PushInstances(Tracers, Scratch);
	}

	// ---- missiles ----------------------------------------------------------
	{
		Scratch.Reset();
		const ob::GuidedMissile* Missiles_ = Ballistics.Missiles();
		for (int32 I = 0; I < ob::Ballistics::MaxMissiles; ++I)
		{
			const ob::GuidedMissile& M = Missiles_[I];
			if (!M.used)
			{
				continue;
			}
			Scratch.Add(FTransform(FRotationMatrix::MakeFromX(ObUnits::Dir(M.dir)).Rotator(),
			                       ObUnits::Pos(M.pos), FVector::OneVector));
		}
		PushInstances(Missiles, Scratch);
	}

	// ---- plasma bolts: fat, and their radius is gameplay-relevant ----------
	{
		Scratch.Reset();
		const ob::PlasmaBolt* Bolts_ = Ballistics.Bolts();
		for (int32 I = 0; I < ob::Ballistics::MaxBolts; ++I)
		{
			const ob::PlasmaBolt& Bo = Bolts_[I];
			if (!Bo.used)
			{
				continue;
			}
			// The bolt is a swept SPHERE in the maths, so drawing it at its
			// real radius is not decoration — a player has to be able to see
			// how fat the thing that is about to hit them is.
			const double S = ObUnits::Len(Bo.radius) * 0.01;
			Scratch.Add(FTransform(FRotationMatrix::MakeFromX(ObUnits::Dir(Bo.dir)).Rotator(),
			                       ObUnits::Pos(Bo.pos), FVector(S)));
		}
		PushInstances(Bolts, Scratch);
	}
}
