// Copyright OVERBURST.
#include "ObCombatSubsystem.h"

#include "ObStaggerComponent.h"
#include "ObUnitsUE.h"
#include "ObProjectilePool.h"
#include "OverburstUE.h"
#include "Engine/World.h"
#include "GameFramework/Actor.h"

namespace
{
	constexpr int32 kReserve = 96;
}

void UObCombatSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	Records.Reserve(kReserve);
	EnemyTargets.Reserve(kReserve);
	PlayerTargets.Reserve(8);

	WorldQuery_.Init(GetWorld(), nullptr, ob::cfg::Arena::GroundY);
	Ballistics_.Reset();
}

void UObCombatSubsystem::Deinitialize()
{
	Records.Reset();
	EnemyTargets.Reset();
	PlayerTargets.Reset();
	Super::Deinitialize();
}

TStatId UObCombatSubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UObCombatSubsystem, STATGROUP_Tickables);
}

// ---------------------------------------------------------------------------
void UObCombatSubsystem::RegisterTarget(AActor* Actor, ob::Owner Side, float RadiusM, float HeightM)
{
	if (!Actor)
	{
		return;
	}
	for (FTargetRecord& R : Records)
	{
		if (R.Actor.Get() == Actor)
		{
			R.Side = Side;
			R.RadiusM = RadiusM;
			R.HeightM = HeightM;
			return;
		}
	}
	Records.Add(FTargetRecord{ Actor, Side, RadiusM, HeightM, Actor->GetActorLocation() });
}

void UObCombatSubsystem::UnregisterTarget(AActor* Actor)
{
	Records.RemoveAll([Actor](const FTargetRecord& R) { return R.Actor.Get() == Actor || !R.Actor.IsValid(); });
}

// ---------------------------------------------------------------------------
//  Rebuild the capsules ObBallistics tests against.
//
//  The actor's location is its CAPSULE CENTRE; StandingCapsule wants FEET. Get
//  that wrong and every hit box floats half a mech above its owner, which
//  presents as "the hit detection is high" and is a unit-boundary bug, not a
//  ballistics one. Velocity is differenced here because missile lead
//  compensation needs it and an AActor does not necessarily have a movement
//  component to ask.
// ---------------------------------------------------------------------------
void UObCombatSubsystem::RefreshTargets()
{
	EnemyTargets.Reset();
	PlayerTargets.Reset();

	const float Dt = GetWorld() ? GetWorld()->GetDeltaSeconds() : 0.0f;
	const float InvDt = Dt > KINDA_SMALL_NUMBER ? 1.0f / Dt : 0.0f;

	for (int32 I = Records.Num() - 1; I >= 0; --I)
	{
		FTargetRecord& R = Records[I];
		AActor* Actor = R.Actor.Get();
		if (!Actor || !IsValid(Actor))
		{
			Records.RemoveAtSwap(I);
			continue;
		}

		const FVector Loc = Actor->GetActorLocation();
		const ob::Vec3 Feet = ObUnits::CentreToFeet(Loc, R.HeightM);
		const ob::Vec3 Vel = ObUnits::Vel((Loc - R.LastLocation) * InvDt);
		R.LastLocation = Loc;

		ob::CombatTarget T;
		T.vol = ob::StandingCapsule(Feet, R.RadiusM, R.HeightM);
		T.vel = Vel;
		T.userData = Actor;
		T.alive = true;
		T.staggered = false;

		if (const UObStaggerComponent* Stag = Actor->FindComponentByClass<UObStaggerComponent>())
		{
			T.alive = Stag->IsAlive();
			// Read at the top of the frame, so every projectile resolving this
			// tick agrees about whether the target was broken when it was hit.
			T.staggered = Stag->IsStaggered();
		}

		if (R.Side == ob::Owner::Enemy)
		{
			EnemyTargets.Add(T);
		}
		else
		{
			PlayerTargets.Add(T);
		}
	}
}

ob::CombatContext UObCombatSubsystem::MakeContext()
{
	ob::CombatContext Ctx;
	Ctx.enemies = ob::TargetView(EnemyTargets.GetData(), EnemyTargets.Num());
	Ctx.players = ob::TargetView(PlayerTargets.GetData(), PlayerTargets.Num());
	Ctx.world = &WorldQuery_;
	Ctx.sink = this;
	return Ctx;
}

void UObCombatSubsystem::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);

	RefreshTargets();
	ob::CombatContext Ctx = MakeContext();

	// dt raw: ObBallistics clamps to kMaxStep (0.1 s) and sub-steps its swept
	// segments internally. Verified in unreal/tests: a 620 m/s round hits a
	// target at 400 m at the same 396.00 m whether the frame is 1 ms or 100 ms,
	// and still lands through a 500 ms hitch.
	Ballistics_.Update(DeltaTime, Ctx);

	if (Pool)
	{
		Pool->SyncFrom(Ballistics_);
	}
}

// ---------------------------------------------------------------------------
//  The sink
// ---------------------------------------------------------------------------
void UObCombatSubsystem::OnHit(const ob::HitEvent& Event)
{
	AActor* Target = const_cast<AActor*>(static_cast<const AActor*>(Event.target));
	if (!Target || !IsValid(Target))
	{
		// A world hit: geometry, not an entity. Still worth reporting — it is
		// what puts a scorch decal and a dust puff on the wall.
		OnExplosionResolved.Broadcast(ObUnits::Pos(Event.point), 0.0f);
		return;
	}

	if (UObStaggerComponent* Stag = Target->FindComponentByClass<UObStaggerComponent>())
	{
		// STRAIGHT THROUGH. Event.damage already carries the direct-hit
		// multiplier — see the header.
		Stag->ApplyResolvedHit(Event.damage, Event.acs, Event.direct);
	}

	OnHitResolved.Broadcast(Target, Event.damage, Event.direct);
}

void UObCombatSubsystem::OnExplosion(const ob::ExplosionEvent& Event)
{
	// Explosions must LIGHT THE ENVIRONMENT (ART_DIRECTION section 3): the
	// listener is expected to spawn a real point light with a fast falloff, not
	// only a sprite. The radius is handed over in Unreal units so the listener
	// never touches the conversion.
	OnExplosionResolved.Broadcast(ObUnits::Pos(Event.position),
	                              static_cast<float>(ObUnits::Len(Event.radius)));
}

// ---------------------------------------------------------------------------
//  Lock-on
// ---------------------------------------------------------------------------
int32 UObCombatSubsystem::GatherLockCandidates(const FVector& EyeUu, const FVector& AimDir,
                                               ob::Owner FiringSide, const void** OutHandles,
                                               int32 MaxHandles) const
{
	if (!OutHandles || MaxHandles <= 0)
	{
		return 0;
	}

	const TArray<ob::CombatTarget>& Pool_ =
		(FiringSide == ob::Owner::Enemy) ? PlayerTargets : EnemyTargets;

	const ob::Vec3 Eye = ObUnits::Pos(EyeUu);
	const ob::Vec3 Dir = ObUnits::Dir(AimDir.GetSafeNormal());

	struct FCand { const void* Handle; float Dist; };
	TArray<FCand, TInlineAllocator<16>> Cands;

	for (const ob::CombatTarget& T : Pool_)
	{
		if (!T.alive || !T.userData)
		{
			continue;
		}
		const ob::Vec3 ToTarget = T.vol.Centre() - Eye;
		const float Dist = ToTarget.Length();
		if (Dist > ob::cfg::Lock::Range || Dist < ob::EPS)
		{
			continue;
		}
		// Half-angle against the SOFT cone. cfg::Lock::FovHard is the wider
		// gate the tracker holds an existing lock through; acquiring uses the
		// tighter one so a lock is something the player aimed at.
		const float Cos = ob::Dot(ToTarget / Dist, Dir);
		if (Cos < std::cos(ob::cfg::Lock::FovSoft))
		{
			continue;
		}
		Cands.Add({ T.userData, Dist });
	}

	Cands.Sort([](const FCand& A, const FCand& B) { return A.Dist < B.Dist; });

	const int32 N = FMath::Min3(Cands.Num(), MaxHandles, static_cast<int32>(ob::cfg::Missile::Count));
	for (int32 I = 0; I < N; ++I)
	{
		OutHandles[I] = Cands[I].Handle;
	}
	return N;
}

FVector UObCombatSubsystem::SolveAimPoint(const FVector& EyeUu, const FVector& AimDir,
                                          ob::Owner FiringSide, float MaxRangeM) const
{
	const ob::Vec3 Eye = ObUnits::Pos(EyeUu);
	const ob::Vec3 Dir = ObUnits::Dir(AimDir.GetSafeNormal());

	// One Cast, ObCore's, which is the single source of truth for every hit:
	// entity capsules first, then the world seam bounded to the nearest of them.
	// Solving this any other way would give the reticle a different opinion
	// about what it covers than the bullets have.
	ob::CombatContext Ctx;
	Ctx.enemies = ob::TargetView(const_cast<ob::CombatTarget*>(EnemyTargets.GetData()), EnemyTargets.Num());
	Ctx.players = ob::TargetView(const_cast<ob::CombatTarget*>(PlayerTargets.GetData()), PlayerTargets.Num());
	Ctx.world = &WorldQuery_;
	Ctx.sink = nullptr;

	const ob::CastHit Hit = Ballistics_.Cast(Eye, Dir, MaxRangeM, FiringSide, 0.0f, nullptr, Ctx);
	if (Hit.hit)
	{
		return ObUnits::Pos(Hit.point);
	}
	return EyeUu + AimDir.GetSafeNormal() * ObUnits::Len(MaxRangeM);
}
