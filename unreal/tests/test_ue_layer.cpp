// ============================================================================
//  Measurements of the UNREAL LAYER's two engine-free pieces.
//
//  READ THIS BEFORE TRUSTING ANYTHING IT PRINTS.
//
//  Unreal is not installed in this container and cannot be. Nothing in
//  Source/OverburstUE/ that touches an Unreal type is compiled here, let alone
//  run. What this file measures is the two headers in that module that were
//  deliberately written WITHOUT any Unreal dependency, precisely so they could
//  be measured:
//
//    ObUnits.h     the metre/centimetre + Y-up/Z-up boundary. Getting this
//                  wrong mirrors the world, and a mirrored world is a bug that
//                  survives review because every individual line looks right.
//
//    ObMechRig.h   the frame definition. AC_DESIGN.md states its proportions
//                  as hard targets; this is where they stop being prose.
//
//  A PASS here says the maths and the proportions are right. It says NOTHING
//  about whether UObMovementComponent compiles, whether the mech renders, or
//  whether the game runs at any frame rate. Those claims cannot be made from
//  this container at all.
// ============================================================================
// <cstdarg> ahead of ObTest.h: the framework's Fmt() uses va_start and the
// header does not pull it in itself. Same ordering every other suite uses.
#include <cstdarg>
#include <cstdio>

#include "ObTest.h"

#include "ObTypes.h"
#include "ObConfig.h"
#include "ObMovement.h"
#include "ObAI.h"

#include "ObUnits.h"
#include "ObMechRig.h"

using namespace ob;

namespace {

/** Round-trip a position through the boundary and back. */
Vec3 RoundTripPos(const Vec3& m) {
	const obu::Uu3 u = obu::PosToUe(m);
	return obu::PosToOb(u.X, u.Y, u.Z);
}

}  // namespace

// ===========================================================================
//  THE UNIT BOUNDARY
// ===========================================================================
void Suite_Units() {
	obtest::Suite("ObUnits — the metre/centimetre, Y-up/Z-up boundary");

	// ---- scale ----
	obtest::Near("one ObCore metre is 100 Unreal units", obu::LenToUe(1.0f), 100.0, 1e-9, " uu");
	obtest::Near("...and the inverse agrees", obu::LenToOb(100.0), 1.0, 1e-6, " m");
	obtest::Near("the scale is ObCore's own constant, not a second copy",
	             obu::MToUu, static_cast<double>(ob::M_TO_UU), 1e-12);

	// ---- the basis. This is the whole test: three vectors, three answers. ----
	{
		const obu::Uu3 fwd = obu::DirToUe(ForwardFromYaw(0.0f));
		obtest::Near("ObCore forward -> Unreal +X", fwd.X, 1.0, 1e-6);
		obtest::Near("  ...with no Y component", fwd.Y, 0.0, 1e-6);
		obtest::Near("  ...and no Z component", fwd.Z, 0.0, 1e-6);

		const obu::Uu3 right = obu::DirToUe(RightFromYaw(0.0f));
		obtest::Near("ObCore right -> Unreal +Y", right.Y, 1.0, 1e-6);
		obtest::Near("  ...with no X component", right.X, 0.0, 1e-6);

		const obu::Uu3 up = obu::DirToUe(Vec3{0.0f, 1.0f, 0.0f});
		obtest::Near("ObCore up -> Unreal +Z", up.Z, 1.0, 1e-6);
	}

	// A direction is a direction in both systems. Scaling one by 100 is the
	// classic way to get a projectile that leaves the arena on frame one.
	{
		const obu::Uu3 d = obu::DirToUe(Vec3{0.6f, 0.0f, -0.8f});
		const double len = std::sqrt(d.X * d.X + d.Y * d.Y + d.Z * d.Z);
		obtest::Near("directions are NOT scaled by the unit conversion", len, 1.0, 1e-6);
	}

	// ---- handedness ----
	//
	// ObCore is right-handed (forward x right = -up); Unreal is left-handed
	// (forward x right = +up). A conversion that PRESERVED handedness would be
	// the broken one, and it would look completely reasonable in review.
	{
		const Vec3 f = ForwardFromYaw(0.0f), r = RightFromYaw(0.0f);
		const Vec3 c = Cross(f, r);
		obtest::Near("ObCore basis is right-handed: fwd x right = -up", c.y, -1.0, 1e-6);

		const obu::Uu3 F = obu::DirToUe(f), R = obu::DirToUe(r);
		const double cz = F.X * R.Y - F.Y * R.X;   // Z of F x R
		obtest::Near("...and converts to a LEFT-handed basis: fwd x right = +up", cz, 1.0, 1e-6);
	}

	// ---- yaw: measured on more than one bearing, deliberately ----
	//
	// At yaw 0 the correct map and the sign-flipped map agree. Any test that
	// only samples yaw 0 passes for both, which is exactly how a mirrored
	// world ships.
	{
		obtest::Near("yaw 0 -> 0 deg", obu::YawToUeDeg(0.0f), 0.0, 1e-9, " deg");
		obtest::Near("ObCore yaw +90 deg is Unreal -90 deg",
		             obu::YawToUeDeg(PI * 0.5f), -90.0, 1e-4, " deg");

		// Independent cross-check: convert the DIRECTION at that yaw and read
		// the Unreal yaw straight off it. The two derivations must agree.
		const obu::Uu3 d = obu::DirToUe(ForwardFromYaw(PI * 0.5f));
		const double yawFromDir = std::atan2(d.Y, d.X) * obu::RadToDeg;
		obtest::Near("...and the direction agrees with the angle", yawFromDir, -90.0, 1e-4, " deg");

		for (int i = 0; i < 8; ++i) {
			const float y = -PI + static_cast<float>(i) * (TAU / 8.0f) + 0.31f;
			const obu::Uu3 dd = obu::DirToUe(ForwardFromYaw(y));
			const double fromDir = std::atan2(dd.Y, dd.X) * obu::RadToDeg;
			const double fromAngle = obu::YawToUeDeg(y);
			const double err = std::fabs(WrapAngle(static_cast<float>((fromDir - fromAngle) * obu::DegToRad)));
			if (err > 1e-4) {
				obtest::Near("yaw map disagrees with the direction map", err, 0.0, 1e-4);
				break;
			}
			if (i == 7) obtest::True("yaw map agrees with the direction map on 8 bearings", true);
		}
		obtest::Near("yaw round-trips", obu::YawToOb(obu::YawToUeDeg(1.234f)), 1.234, 1e-5, " rad");
	}

	// ---- pitch: both systems call nose-up positive, so it is a pure unit change ----
	{
		obtest::Near("pitch +0.5 rad -> +28.65 deg", obu::PitchToUeDeg(0.5f), 28.6478898, 1e-4, " deg");
		const obu::Uu3 d = obu::DirToUe(DirFromYawPitch(0.0f, 0.5f));
		const double pitchFromDir = std::asin(Clamp(static_cast<float>(d.Z), -1.0f, 1.0f)) * obu::RadToDeg;
		obtest::Near("...and the aim direction agrees", pitchFromDir, 28.6478898, 1e-3, " deg");
		obtest::Near("ObCore's pitch clamp maps to a legal Unreal pitch",
		             obu::PitchToUeDeg(cfg::Cam::PitchMax), 60.16, 0.05, " deg");
	}

	// ---- round trips ----
	{
		const Vec3 samples[5] = {
			{0.0f, 0.0f, 0.0f}, {12.5f, 3.25f, -48.0f}, {-460.0f, 300.0f, 460.0f},
			{0.001f, -0.5f, 0.25f}, {123.456f, 78.9f, -321.0f},
		};
		double worst = 0.0;
		for (const Vec3& s : samples) {
			const Vec3 back = RoundTripPos(s);
			worst = std::fmax(worst, static_cast<double>((back - s).Length()));
		}
		obtest::Less("position round-trips through the boundary", worst, 1e-3, " m");
	}

	// ---- feet vs capsule centre ----
	//
	// ObCore's position is the SOLE. A UCapsuleComponent is centred. Convert
	// without lifting and the mech stands buried to the waist in the deck.
	{
		const float H = cfg::Player::Height;
		const obu::Uu3 c = obu::FeetToCapsuleCentre(Vec3{0.0f, 0.0f, 0.0f}, H);
		obtest::Near("feet at ground -> capsule centre at half height",
		             c.Z, 550.0, 1e-6, " uu");
		const Vec3 feet = obu::CapsuleCentreToFeet(c.X, c.Y, c.Z, H);
		obtest::Near("...and the inverse puts the sole back on the deck", feet.y, 0.0, 1e-4, " m");
		obtest::Near("capsule half-height", obu::CapsuleHalfHeightUu(H), 550.0, 1e-6, " uu");
		// 1e-3 rather than 1e-6: cfg::Player::Radius is the float 4.2f, whose
		// exact value is 4.19999980926513671875. The 1.9e-5 uu shortfall is
		// that constant's representation, not the conversion's.
		obtest::Near("capsule radius", obu::CapsuleRadiusUu(cfg::Player::Radius), 420.0, 1e-3, " uu");
		// The capsule must be able to contain itself: UE clamps radius to
		// half-height, and a 4.2 m radius under a 5.5 m half-height is legal.
		obtest::True("radius fits inside the half-height (UE clamps it otherwise)",
		             obu::CapsuleRadiusUu(cfg::Player::Radius) <= obu::CapsuleHalfHeightUu(H));
	}

	// ---- velocity ----
	{
		// A quick boost is 118 m/s. In Unreal that must read 11800 uu/s, and
		// it must point where ObCore pointed it.
		const Vec3 v = ForwardFromYaw(0.0f) * cfg::Player::QbImpulse;
		const obu::Uu3 u = obu::VelToUe(v);
		obtest::Near("a 118 m/s quick boost is 11800 uu/s", u.X, 11800.0, 1e-3, " uu/s");
		obtest::Near("...directed along +X, not somewhere else", std::fabs(u.Y) + std::fabs(u.Z), 0.0, 1e-6);
	}

	// ---- field of view ----
	//
	// cfg::Cam::Fov is a THREE.js VERTICAL fov; UCameraComponent::FieldOfView
	// is HORIZONTAL. Assigning one to the other silently widens the shot.
	{
		const double h = obu::VFovToHFovDeg(cfg::Cam::Fov, 16.0 / 9.0);
		obtest::InRange("62 deg vertical is ~95 deg horizontal at 16:9", h, 93.0, 97.0, " deg");
		obtest::Near("the fov conversion round-trips",
		             obu::HFovToVFovDeg(h, 16.0 / 9.0), cfg::Cam::Fov, 1e-6, " deg");
		const double hAb = obu::VFovToHFovDeg(cfg::Cam::FovAb, 16.0 / 9.0);
		obtest::Greater("assault boost widens the shot", hAb, h, " deg");
		obtest::Less("...but stays inside a sane projection", hAb, 160.0, " deg");
	}

	// ---- the arena, converted whole ----
	{
		obtest::Near("arena radius in Unreal units", obu::LenToUe(cfg::Arena::Radius), 46000.0, 1e-6, " uu");
		obtest::Near("flight ceiling in Unreal units", obu::LenToUe(cfg::Arena::Ceiling), 30000.0, 1e-6, " uu");
		// 50 km is well inside UE5's double-precision world, but past the
		// float32 WORLD_MAX of older builds — worth stating that it fits.
		obtest::Less("the whole arena fits in a single UE origin block",
		             obu::LenToUe(cfg::Arena::Wall) * 2.0, 20000000.0, " uu");
	}
}

// ===========================================================================
//  THE FRAME
// ===========================================================================
void Suite_MechRig() {
	obtest::Suite("ObMechRig — OB-01 REAVER against AC_DESIGN.md section 2");

	obrig::Frame f;
	obrig::BuildPlayer(f);
	const obrig::Metrics m = obrig::Measure(f);

	obtest::Greater("the frame was built", f.partCount, 60);
	obtest::Less("...without overflowing its fixed budget", f.partCount, obrig::MaxParts + 1);
	std::printf("      REAVER: %d parts, %.2f m tall, %.2f m wide at the shoulders,"
	            " %.2f m at the waist\n",
	            f.partCount, static_cast<double>(m.height),
	            static_cast<double>(m.shoulderWidth), static_cast<double>(m.waistWidth));

	// ---- height: must agree with the collision capsule ObCore integrates ----
	obtest::Near("total height matches cfg::Player::Height", m.height, cfg::Player::Height, 0.06, " m");

	// ---- THE defining line: shoulder : waist = 3.4 : 1 ----
	obtest::Near("shoulder-to-waist ratio", m.ShoulderToWaist(), 3.4, 0.25);

	// ---- the waist really is the narrowest point of the whole frame ----
	obtest::Near("the narrowest point above the knee IS the waist",
	             m.narrowestAtY, 6.8, 0.55, " m");
	obtest::Near("...and it measures the waist width", m.narrowestAboveKnee, m.waistWidth, 0.02, " m");

	// ---- the widest point is the shoulders ----
	obtest::InRange("the widest point sits in the shoulder band", m.widestAtY, 9.0, 10.6, " m");
	obtest::Near("...and it measures the shoulder span", m.widestOverall, m.shoulderWidth, 0.02, " m");

	// ---- legs are ~58 % of total height. "leggy, not squat." ----
	obtest::Near("legs are 58 % of total height", m.legFraction, 0.58, 0.02);

	// ---- the head is TINY: about 1/7 of core height ----
	std::printf("      head %.2f m tall over a %.2f m core -> 1/%.1f\n",
	            static_cast<double>(m.headHeight), static_cast<double>(m.coreHeight),
	            static_cast<double>(m.coreHeight / (m.headHeight > 1e-4f ? m.headHeight : 1.0f)));
	obtest::Near("head height is core height / 7", m.headHeight, m.coreHeight / 7.0f, 0.06, " m");

	// ---- front view reads as an arrow: wide, pinched, planted wide again ----
	obtest::Greater("shoulders are wider than the feet", m.shoulderWidth, m.footSpan, " m");
	obtest::Greater("the feet are planted wider than the waist", m.footSpan, m.waistWidth * 2.0, " m");

	// ---- the shoulders rise PAST the head. Never a head on a neck on top. ----
	{
		const ob::Vec3 headNode = obrig::NodeWorldRest(f, obrig::Node::Head);
		float shoulderTop = 0.0f, headBoxTop = 0.0f;
		for (int i = 0; i < f.partCount; ++i) {
			ob::Vec3 lo, hi;
			obrig::PartBounds(f, f.parts[i], lo, hi);
			const obrig::Node n = f.parts[i].node;
			if (n == obrig::Node::YokeL || n == obrig::Node::YokeR)
				shoulderTop = std::fmax(shoulderTop, hi.y);
			if (n == obrig::Node::Head && f.parts[i].shape != obrig::Shape::Rod)
				headBoxTop = std::fmax(headBoxTop, hi.y);
		}
		std::printf("      head box tops out at %.2f m; the shoulders reach %.2f m\n",
		            static_cast<double>(headBoxTop), static_cast<double>(shoulderTop));
		obtest::Greater("the shoulders rise past the head", shoulderTop, headBoxTop, " m");
		obtest::InRange("the head sits low, inside its design band", headNode.y, 9.9, 10.3, " m");
	}

	// ---- BIG PLATES, CONCENTRATED DETAIL (AC_DESIGN section 1) ----
	//
	// Two separate claims, measured separately, because the interesting half is
	// the one an area ratio cannot see.
	//
	//   BIG PLATES  — the surface is mostly large clean armour planes.
	//                 Measured as an area fraction.
	//   CONCENTRATED — the mechanism sits AT THE JOINTS rather than being
	//                 sprayed over the flat spans. An area ratio is blind to
	//                 this: uniform greeble and clustered greeble weigh the
	//                 same. Measured as mean distance to the nearest rig node,
	//                 mechanism against armour.
	std::printf("      surface split: %.1f m2 clean armour, %.1f m2 mechanism"
	            "  -> %.0f %% mechanism\n",
	            static_cast<double>(m.cleanArea), static_cast<double>(m.detailArea),
	            static_cast<double>(m.DetailFraction() * 100.0f));
	obtest::InRange("the surface is dominated by clean armour planes",
	                m.DetailFraction(), 0.04, 0.35);
	{
		const float dDetail = obrig::MeanDistanceToNode(f, true);
		const float dClean = obrig::MeanDistanceToNode(f, false);
		std::printf("      mechanism sits %.2f m from the nearest joint on average;"
		            " armour sits %.2f m\n",
		            static_cast<double>(dDetail), static_cast<double>(dClean));
		obtest::Less("mechanism is CONCENTRATED at the joints, armour is not",
		             dDetail, static_cast<double>(dClean), " m");
		obtest::Less("...and it clusters tightly enough to read as a cluster",
		             dDetail, 0.95, " m");
	}

	// ---- the accent stays rationed ----
	std::printf("      %d accent parts, %d bare-metal parts\n", m.accentParts, m.steelParts);
	obtest::InRange("the saturated accent is confined to a handful of parts",
	                m.accentParts, 1.0, 14.0);
	obtest::Greater("bare polished metal outnumbers the accent (it is what reads as milled)",
	                m.steelParts, m.accentParts);
}

void Suite_RigJoints() {
	obtest::Suite("ObMechRig — joints, sockets and the rig contract");

	obrig::Frame f;
	obrig::BuildPlayer(f);

	// ---- every articulation shows mechanism (AC_DESIGN section 4) ----
	{
		struct Row { obrig::Node node; const char* name; };
		const Row rows[] = {
			{ obrig::Node::Hips,   "hip"      },
			{ obrig::Node::YokeL,  "shoulder" },
			{ obrig::Node::ArmL,   "elbow"    },
			{ obrig::Node::ShinL,  "knee"     },
			{ obrig::Node::FootL,  "ankle"    },
		};
		for (const Row& r : rows) {
			const int n = obrig::MechanismCount(f, r.node);
			obtest::Greater(obtest::Fmt("%s joint shows mechanism", r.name).c_str(), n, 1.0);
		}
	}

	// ---- bare polished metal is on the actuators, per the material rule ----
	{
		int steelRods = 0, steelBosses = 0;
		for (int i = 0; i < f.partCount; ++i) {
			if (f.parts[i].mat != obrig::Mat::Steel) continue;
			if (f.parts[i].shape == obrig::Shape::Rod) ++steelRods;
			if (f.parts[i].shape == obrig::Shape::Boss) ++steelBosses;
		}
		std::printf("      %d bare-steel actuator rods, %d pivot bosses\n", steelRods, steelBosses);
		obtest::Greater("actuator rods are bare polished metal", steelRods, 7.0);
		obtest::Greater("pivot bosses are bare polished metal", steelBosses, 4.0);
	}

	// ---- every nozzle has a REAL throat. A flat disc reads as a sticker. ----
	{
		int nozzles = 0;
		float shallowest = 1e9f;
		for (int i = 0; i < f.partCount; ++i) {
			if (f.parts[i].shape != obrig::Shape::Nozzle) continue;
			++nozzles;
			shallowest = std::fmin(shallowest, f.parts[i].h);
		}
		std::printf("      %d nozzles, shallowest throat %.2f m deep\n",
		            nozzles, static_cast<double>(shallowest));
		obtest::Greater("the frame carries a full vernier set", nozzles, 8.0);
		obtest::Greater("every nozzle has visible throat depth", shallowest, 0.10, " m");
	}

	// ---- the four muzzles exist, and land where the loadout expects ----
	{
		const obrig::Socket* s = f.sockets;
		obtest::True("R-arm muzzle is placed", s[static_cast<int>(obrig::SocketId::MuzzleRArm)].used);
		obtest::True("L-arm blade emitter is placed", s[static_cast<int>(obrig::SocketId::MuzzleLArm)].used);
		obtest::True("R-back rack is placed", s[static_cast<int>(obrig::SocketId::MuzzleRBack)].used);
		obtest::True("L-back cannon is placed", s[static_cast<int>(obrig::SocketId::MuzzleLBack)].used);

		const ob::Vec3 rifle = obrig::SocketWorldRest(f, obrig::SocketId::MuzzleRArm);
		const ob::Vec3 cannon = obrig::SocketWorldRest(f, obrig::SocketId::MuzzleLBack);
		const ob::Vec3 rack = obrig::SocketWorldRest(f, obrig::SocketId::MuzzleRBack);
		std::printf("      rifle muzzle (%.2f, %.2f, %.2f)   cannon (%.2f, %.2f, %.2f)\n",
		            static_cast<double>(rifle.x), static_cast<double>(rifle.y), static_cast<double>(rifle.z),
		            static_cast<double>(cannon.x), static_cast<double>(cannon.y), static_cast<double>(cannon.z));

		obtest::Greater("the rifle muzzle is on the RIGHT arm", rifle.x, 0.0, " m");
		obtest::Less("...and ahead of the chest", rifle.z, -1.5, " m");
		obtest::Less("the cannon is on the LEFT back pylon", cannon.x, 0.0, " m");
		// The rack is VERTICAL-launch: its tubes point up, not forward.
		obtest::Greater("the missile rack launches upward",
		                f.sockets[static_cast<int>(obrig::SocketId::MuzzleRBack)].dy, 0.9);
		obtest::Greater("the rack sits above the shoulder line", rack.y, 9.5, " m");
	}

	// ---- the optic is the aim origin's neighbour, not a random point ----
	//
	// ObCore fires every ray from mv::EyeHeight. If the head optic sits a long
	// way from that, tracers visibly leave the wrong part of the machine.
	{
		const ob::Vec3 optic = obrig::SocketWorldRest(f, obrig::SocketId::Optic);
		std::printf("      optic at y = %.2f m; ObCore fires from mv::EyeHeight = %.2f m\n",
		            static_cast<double>(optic.y), static_cast<double>(mv::EyeHeight));
		obtest::Near("the head optic sits near ObCore's sensor height",
		             optic.y, mv::EyeHeight, 1.6, " m");
	}

	// ---- back units stand OFF the body with daylight under them ----
	{
		const ob::Vec3 backR = obrig::NodeWorldRest(f, obrig::Node::BackR);
		const ob::Vec3 core = obrig::NodeWorldRest(f, obrig::Node::Core);
		obtest::Greater("back units stand behind the core", backR.z - core.z, 0.8, " m");
		obtest::Greater("...and outboard of its centreline", std::fabs(backR.x), 0.8, " m");
	}

	// ---- rig points are ordered head-to-toe, so nothing is inverted ----
	{
		const float hip = obrig::NodeWorldRest(f, obrig::Node::Hips).y;
		const float knee = obrig::NodeWorldRest(f, obrig::Node::ShinL).y;
		const float ankle = obrig::NodeWorldRest(f, obrig::Node::FootL).y;
		const float core = obrig::NodeWorldRest(f, obrig::Node::Core).y;
		std::printf("      rig stations: ankle %.2f  knee %.2f  hip %.2f  core %.2f m\n",
		            static_cast<double>(ankle), static_cast<double>(knee),
		            static_cast<double>(hip), static_cast<double>(core));
		obtest::True("ankle < knee < hip < core", ankle < knee && knee < hip && hip < core);
		obtest::Near("the knee axis sits in its design band", knee, 4.0, 0.25, " m");
		obtest::Near("the ankle axis sits in its design band", ankle, 1.0, 0.20, " m");
	}
}

void Suite_RigRoster() {
	obtest::Suite("ObMechRig — the hostile roster, AC_DESIGN.md section 7");

	using EK = cfg::EnemyKind;
	struct Row { EK kind; const char* name; };
	const Row roster[] = {
		{ EK::AcLight, "SHRIKE"   },
		{ EK::AcMid,   "KITE"     },
		{ EK::AcHeavy, "BULWARK"  },
		{ EK::Boss,    "NIGHTJAR" },
		{ EK::MT,      "MT"       },
	};

	obrig::Frame frames[5];
	obrig::Metrics metrics[5];
	for (int i = 0; i < 5; ++i) {
		obrig::BuildEnemy(frames[i], roster[i].kind);
		metrics[i] = obrig::Measure(frames[i]);
		std::printf("      %-9s %3d parts  %5.2f m tall  shoulders %4.2f  waist %4.2f"
		            "  ratio %4.2f  legs %.0f %%\n",
		            roster[i].name, frames[i].partCount,
		            static_cast<double>(metrics[i].height),
		            static_cast<double>(metrics[i].shoulderWidth),
		            static_cast<double>(metrics[i].waistWidth),
		            static_cast<double>(metrics[i].ShoulderToWaist()),
		            static_cast<double>(metrics[i].legFraction * 100.0f));
	}

	// ---- each frame is the height and the proportion its design calls for ----
	for (int i = 0; i < 5; ++i) {
		obtest::Near(obtest::Fmt("%s is built to its design height", roster[i].name).c_str(),
		             metrics[i].height, frames[i].designHeight, 0.20, " m");
	}
	{
		// The spec table states MEASURED ratios, so this reads it straight back.
		const double want[5] = { 3.40, 3.40, 2.25, 3.85, 1.75 };
		for (int i = 0; i < 5; ++i) {
			obtest::Near(obtest::Fmt("%s hits its shoulder-to-waist spec", roster[i].name).c_str(),
			             metrics[i].ShoulderToWaist(), want[i], 0.30);
		}
	}

	// ---- NIGHTJAR is taller and sleeker than all of them ----
	{
		float tallestOther = 0.0f, pinchOther = 0.0f;
		for (int i = 0; i < 4; ++i) {
			if (roster[i].kind == EK::Boss) continue;
			tallestOther = std::fmax(tallestOther, metrics[i].height);
			pinchOther = std::fmax(pinchOther, metrics[i].ShoulderToWaist());
		}
		obtest::Greater("NIGHTJAR is the tallest frame on the field", metrics[3].height, tallestOther, " m");
		obtest::Greater("...and the most pinched, i.e. the sleekest",
		                metrics[3].ShoulderToWaist(), pinchOther);
		obtest::Near("NIGHTJAR carries four back units", frames[3].backUnits, 4.0, 0.0);
	}

	// ---- SHRIKE: thin, all legs, no back units ----
	{
		float leggiest = 0.0f;
		for (int i = 1; i < 5; ++i) leggiest = std::fmax(leggiest, metrics[i].legFraction);
		obtest::Greater("SHRIKE is the leggiest frame", metrics[0].legFraction, leggiest);
		obtest::Near("SHRIKE carries no back units", frames[0].backUnits, 0.0, 0.0);
		obtest::True("SHRIKE is reverse-jointed", frames[0].reverseJoint);
		obtest::Less("SHRIKE is the narrowest AC at the shoulder", metrics[0].shoulderWidth,
		             static_cast<double>(std::fmin(metrics[1].shoulderWidth, metrics[3].shoulderWidth)), " m");
	}

	// ---- BULWARK: NO WAIST PINCH is the identity, plus four legs ----
	{
		obtest::True("BULWARK is a tetrapod", frames[2].tetrapod);
		// "No waist pinch" is relative: the player's frame is the reference, and
		// BULWARK has to read as a different KIND of machine beside it.
		obtest::Less("BULWARK has no waist pinch beside a pinched frame's 3.4",
		             metrics[2].ShoulderToWaist(), 2.8);
		float widestOther = 0.0f;
		for (int i = 0; i < 5; ++i) if (i != 2) widestOther = std::fmax(widestOther, metrics[i].widestOverall);
		obtest::Greater("BULWARK is the widest frame on the field", metrics[2].widestOverall, widestOther, " m");
		float tallestOther = 0.0f;
		for (int i = 0; i < 4; ++i) if (i != 2) tallestOther = std::fmax(tallestOther, metrics[i].height);
		obtest::Less("...and the lowest AC. Wide and low, unmistakable.", metrics[2].height, tallestOther, " m");
		// A tetrapod's rear legs must actually be placed, not just flagged.
		obtest::True("BULWARK's rear leg nodes are placed",
		             frames[2].nodes[static_cast<int>(obrig::Node::ThighBL)].used
		             && frames[2].nodes[static_cast<int>(obrig::Node::ShinBR)].used);
	}

	// ---- KITE: the baseline, one back unit on the RIGHT pylon ----
	{
		obtest::Near("KITE carries exactly one back unit", frames[1].backUnits, 1.0, 0.0);
		int rightParts = 0, leftParts = 0;
		for (int i = 0; i < frames[1].partCount; ++i) {
			if (frames[1].parts[i].node == obrig::Node::BackR) ++rightParts;
			if (frames[1].parts[i].node == obrig::Node::BackL) ++leftParts;
		}
		obtest::Greater("...and it is on the RIGHT pylon", rightParts, 0.0);
		obtest::Near("...with the left pylon bare", leftParts, 0.0, 0.0);
	}

	// ---- "distinguishable by silhouette alone at 100 m" ----
	//
	// Measured, not asserted: the width profile of each frame is sampled at 12
	// normalised heights and compared pairwise. Normalising by each frame's own
	// height means the comparison is about SHAPE — two machines that differ
	// only in scale are not distinguishable at range without a reference.
	{
		float worst = 1e9f;
		const char* worstA = "";
		const char* worstB = "";
		for (int a = 0; a < 5; ++a) {
			for (int b = a + 1; b < 5; ++b) {
				const float dist = obrig::SilhouetteDistance(metrics[a], metrics[b]);
				if (dist < worst) { worst = dist; worstA = roster[a].name; worstB = roster[b].name; }
			}
		}
		std::printf("      closest pair of silhouettes: %s vs %s, distance %.4f\n",
		            worstA, worstB, static_cast<double>(worst));
		obtest::Greater("every pair of frames is distinguishable by silhouette", worst, 0.010);
	}

	// ---- every hostile still shows joint mechanism ----
	for (int i = 0; i < 5; ++i) {
		const int knee = obrig::MechanismCount(frames[i], obrig::Node::ShinL);
		const int shoulder = obrig::MechanismCount(frames[i], obrig::Node::YokeL);
		obtest::True(obtest::Fmt("%s shows knee and shoulder mechanism", roster[i].name).c_str(),
		             knee >= 2 && shoulder >= 2,
		             obtest::Fmt("knee %d, shoulder %d parts", knee, shoulder));
	}

	// ---- MTs are NOT ACs, and the geometry says so ----
	{
		obtest::Less("an MT is the smallest thing on the field", metrics[4].height,
		             static_cast<double>(metrics[0].height), " m");
		obtest::Less("an MT has effectively no waist pinch", metrics[4].ShoulderToWaist(), 2.2);
		obtest::Less("an MT is squat, not leggy", metrics[4].legFraction, 0.50);
	}

	// ---- every frame stays inside its fixed budget ----
	{
		int worst = 0;
		for (int i = 0; i < 5; ++i) worst = frames[i].partCount > worst ? frames[i].partCount : worst;
		obtest::Less("no frame overflows the fixed part budget",
		             worst, static_cast<double>(obrig::MaxParts) + 0.5, " parts");
	}
}

// ===========================================================================
//  The rig against the simulation it has to carry.
// ===========================================================================
void Suite_RigVsSim() {
	obtest::Suite("ObMechRig — the frame against the numbers it has to carry");

	obrig::Frame f;
	obrig::BuildPlayer(f);
	const obrig::Metrics m = obrig::Measure(f);

	// The collision capsule ObCore integrates has to actually contain the
	// machine that is drawn, or the mech clips walls its own shoulders cleared.
	std::printf("      collision capsule: r = %.2f m, h = %.2f m;"
	            " frame is %.2f m wide, %.2f m deep, %.2f m tall\n",
	            static_cast<double>(cfg::Player::Radius), static_cast<double>(cfg::Player::Height),
	            static_cast<double>(m.widestOverall), static_cast<double>(m.depth),
	            static_cast<double>(m.height));

	obtest::Near("the frame is as tall as the capsule", m.height, cfg::Player::Height, 0.06, " m");

	// MEASURED, AND IT IS A FINDING, NOT A PASS.
	//
	// ObCore integrates a 4.2 m capsule radius — 8.4 m across — around a machine
	// that measures 5.49 m at its widest and 4.77 m deep. The collision volume
	// is 1.5x the frame. That is a deliberate-looking choice inherited from the
	// web build (whose mech is the same ~5.6 m wide against the same radius), so
	// it is asserted at the value it HAS rather than the value it "should" have.
	//
	// What it buys: nothing on the machine can ever visually intersect a wall,
	// because the capsule contains the whole frame including the shoulder
	// overhang. What it costs: about 1.4 m of invisible margin on each side,
	// which is what a player feels as "I stopped before I touched that".
	// Whether that trade is right is a play-test question and this container
	// cannot answer it. The number is here so the question can be asked.
	{
		const double capsuleAcross = cfg::Player::Radius * 2.0;
		const double margin = (capsuleAcross - m.widestOverall) * 0.5;
		std::printf("      the capsule is %.2f m across around a %.2f m frame:"
		            " %.2f m of invisible margin per side\n",
		            capsuleAcross, static_cast<double>(m.widestOverall), margin);
		obtest::Greater("the capsule fully contains the frame, so nothing clips a wall",
		                capsuleAcross, static_cast<double>(m.widestOverall), " m");
		obtest::Greater("...and contains its depth too", capsuleAcross, static_cast<double>(m.depth), " m");
		obtest::InRange("the collision volume is 1.5x the machine — asserted as measured, "
		                "not as intended",
		                capsuleAcross / static_cast<double>(m.widestOverall), 1.40, 1.65);
	}

	// ObAI's duel framing pads the player's outline by its half-width. That
	// number is quoted from the capsule; the drawn machine must not be so much
	// wider that a hostile can hide behind a shoulder the maths cannot see.
	obtest::Near("ai::PlayerHalfWidth matches the capsule it is quoted from",
	             ai::PlayerHalfWidth, cfg::Player::Radius + 0.2f, 1e-4, " m");

	// The chest aim point every hostile shoots at must be ON the chest.
	{
		const ob::Vec3 core = obrig::NodeWorldRest(f, obrig::Node::Core);
		const ob::Vec3 head = obrig::NodeWorldRest(f, obrig::Node::Head);
		std::printf("      ai::PlayerChest = %.2f m; the core spans %.2f - %.2f m\n",
		            static_cast<double>(ai::PlayerChest),
		            static_cast<double>(core.y), static_cast<double>(head.y));
		// PlayerChest is the hostiles' aim point, quoted as centre of MASS —
		// which on a leggy frame sits at the hips, not in the chest box.
		obtest::InRange("the hostile aim point is on the machine",
		                ai::PlayerChest, 0.0, static_cast<double>(m.height));
		obtest::True("...and inside the torso-and-hips mass, not the ankles",
		             ai::PlayerChest > m.height * 0.35f && ai::PlayerChest < head.y);
	}

	// Muzzle-to-eye offsets. ObCore converges every muzzle on the reticle, so
	// what matters is that the offsets are small enough for that convergence to
	// look like aiming rather than like a squint.
	{
		const ob::Vec3 eye{ 0.0f, mv::EyeHeight, 0.0f };
		const obrig::SocketId muzzles[4] = {
			obrig::SocketId::MuzzleRArm, obrig::SocketId::MuzzleLArm,
			obrig::SocketId::MuzzleRBack, obrig::SocketId::MuzzleLBack,
		};
		float worst = 0.0f;
		for (obrig::SocketId id : muzzles) {
			const ob::Vec3 p = obrig::SocketWorldRest(f, id);
			const float off = std::sqrt(ob::Sq(p.x - eye.x) + ob::Sq(p.y - eye.y));
			worst = std::fmax(worst, off);
		}
		std::printf("      widest muzzle offset from the sensor head: %.2f m\n",
		            static_cast<double>(worst));
		obtest::Less("every muzzle sits within a frame's width of the aim origin", worst, 4.0, " m");
		// At the lock-on range the loadout is tuned for, that offset is a small
		// angle — which is what makes converging on the reticle honest.
		const double angle = std::atan(static_cast<double>(worst) / cfg::Lock::Range) * obu::RadToDeg;
		obtest::Less("...so convergence at lock range is a sub-degree correction", angle, 1.0, " deg");
	}
}
