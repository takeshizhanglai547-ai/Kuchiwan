// ============================================================================
//  ObMechRig — the frames, as DATA.
//
//  ENGINE-FREE BY CONTRACT, like ObUnits.h next door, and for the same reason:
//  AC_DESIGN.md states its proportions as HARD TARGETS ("3.4:1 shoulder to
//  waist", "legs ~58 % of total height", "head about 1/7 of core height"), and
//  a hard target that nothing checks is a suggestion. Because the frame is a
//  table of boxes in metres rather than a pile of UStaticMeshComponents, the
//  container CAN measure it: unreal/tests/test_ue_layer.cpp reads this header,
//  builds every frame and asserts the silhouette contract with numbers.
//
//  What is verified here is the GEOMETRY OF THE DESIGN, not its appearance.
//  No claim is made that the result looks good, only that it has the
//  proportions, the joint mechanism and the plate-to-mechanism balance the
//  design bible asks for. Whether it reads as an Armored Core on screen is a
//  judgement no test in this container can make.
//
//  UObMechRigComponent (Unreal side) walks these tables and emits geometry.
//  It adds no dimension of its own; if a proportion is wrong, it is wrong
//  HERE, where a test can catch it.
//
//  ------------------------------------------------------------------------
//  CONVENTIONS
//    * METRES, ObCore's Y-up right-handed space. Feet at y = 0, facing -Z.
//      (The rig is authored in ObCore space, not Unreal space, so that
//      ObUnits.h stays the only conversion.)
//    * Parts are placed in their NODE's local frame. Node rest transforms are
//      pure TRANSLATIONS — the rest pose has no rotated joints — which is what
//      lets Measure() compose them by addition alone.
//    * Part rotations are intrinsic XYZ eulers, radians, applied about the
//      part's own centre.
//    * `detail` splits AC_DESIGN section 1: false = clean armour plane, true =
//      concentrated mechanism. The 70/30 rule is asserted against it.
// ============================================================================
#pragma once

#include "ObTypes.h"
#include "ObConfig.h"

namespace obrig {

// ---------------------------------------------------------------------------
//  Material slots. Three tones plus an accent, exactly as AC_DESIGN section 6:
//  body paint, near-black frame, bare polished metal. The Hull2/3/4 splits are
//  VALUE variation inside the one body tone, not extra colours — a factory
//  repaint is never perfectly uniform.
// ---------------------------------------------------------------------------
enum class Mat : unsigned char {
	Hull = 0,    // body: primary armour plate, satin, roughness ~0.35
	Hull2,       // body: shaded secondary plate
	Hull3,       // body: deep recessed plate
	Hull4,       // body: service panel, warmer
	Frame,       // frame: near-black charcoal structure, roughness ~0.6
	Frame2,      // frame: deepest recess, rubber, hoses
	Steel,       // metal: bare polished actuator rod / pivot boss, rough 0.18
	Accent,      // the ONE saturated colour. Optic, booster cores, seam strips.
	Count
};

// ---------------------------------------------------------------------------
//  Shapes. Deliberately NOT "box": AC_DESIGN section 3 says a rectangular
//  prism is only acceptable as an internal frame member that armour hides, so
//  the workhorse is a CHAMFERED box and the second is a TAPERED one.
// ---------------------------------------------------------------------------
enum class Shape : unsigned char {
	Plate = 0,   // chamfered box. w,h,d = full extents; chamfer = arris width
	Taper,       // chamfered box narrowing to (wT, dT) at its +Y end
	Wedge,       // chamfered box with a POINTED leading edge at -Z (knee, shoulder)
	Rod,         // cylinder along +Y. w = diameter, h = length
	Ring,        // torus in the XZ plane. w = outer diameter, h = tube diameter
	Nozzle,      // bell with a REAL throat: w = throat dia, d = exit dia, h = depth
	Boss,        // pivot boss: raised hub + hex cap. w = diameter, h = stand-off
	Boot,        // ribbed rubber boot over a joint. w = diameter, h = length
	Vent,        // recessed frame with slats. w,h = face, d = recess depth
	Count
};

// ---------------------------------------------------------------------------
//  Articulated nodes. The rig points ARE the contract (ARCHITECTURE_UE.md):
//  an authored mesh replacing this later must land its joints on these.
// ---------------------------------------------------------------------------
enum class Node : unsigned char {
	Root = 0,
	Hips, Core, Head,
	YokeL, YokeR,      // shoulder yoke — carries the shoulder armour
	ArmL, ArmR,        // upper arm + forearm + weapon unit
	ThighL, ThighR,
	ShinL, ShinR,
	FootL, FootR,
	ThighBL, ThighBR,  // tetrapod rear legs (BULWARK only)
	ShinBL, ShinBR,
	BackL, BackR,      // back-unit pylons
	Count
};

/** Parent of each node in the rest hierarchy. Root's parent is itself. */
const Node* NodeParents();

// ---------------------------------------------------------------------------
//  Sockets — the points gameplay actually needs. Muzzle directions are unit
//  vectors in the node's local frame; the Unreal layer converts once through
//  ObUnits.h and never re-derives one.
// ---------------------------------------------------------------------------
enum class SocketId : unsigned char {
	MuzzleRArm = 0,   // MG-014 LANCET
	MuzzleLArm,       // PB-03 VERGE  (blade emitter root)
	MuzzleRBack,      // VP-60LCS rack
	MuzzleLBack,      // BML-SB PYRE
	Optic,            // head sensor — the only saturated colour on the frame
	ThrMainL, ThrMainR,       // main bells, lower back
	ThrHipL, ThrHipR,         // hip verniers — fire on a lateral quick boost
	ThrShoulderL, ThrShoulderR,
	ThrCalfL, ThrCalfR,
	Count
};

struct Socket {
	SocketId id = SocketId::Optic;
	Node node = Node::Root;
	float x = 0.0f, y = 0.0f, z = 0.0f;
	float dx = 0.0f, dy = 0.0f, dz = -1.0f;   // firing / exhaust direction, unit
	float radius = 0.2f;                       // bell or muzzle radius, m
	bool used = false;
};

// ---------------------------------------------------------------------------
//  One primitive.
// ---------------------------------------------------------------------------
struct Part {
	Shape shape = Shape::Plate;
	Mat mat = Mat::Hull;
	Node node = Node::Root;
	float x = 0.0f, y = 0.0f, z = 0.0f;        // centre, node-local metres
	float w = 1.0f, h = 1.0f, d = 1.0f;
	float wT = 1.0f, dT = 1.0f;                // taper end / nozzle exit
	float rx = 0.0f, ry = 0.0f, rz = 0.0f;     // intrinsic XYZ euler, radians
	float chamfer = 0.06f;
	bool detail = false;                        // concentrated mechanism
};

// ---------------------------------------------------------------------------
//  A frame.
//
//  Fixed capacity, no allocation: this header is included by ObCore-adjacent
//  test code that runs under the same no-heap-in-the-tick-path discipline, and
//  by an Unreal component that builds one of these on a loading screen.
// ---------------------------------------------------------------------------
inline constexpr int MaxParts = 320;

struct NodeRest {
	float x = 0.0f, y = 0.0f, z = 0.0f;   // translation in the PARENT's frame
	bool used = false;
};

struct Frame {
	Part parts[MaxParts];
	int partCount = 0;
	NodeRest nodes[static_cast<int>(Node::Count)];
	Socket sockets[static_cast<int>(SocketId::Count)];

	/** Design intent, carried alongside so Measure() can be checked against it. */
	float designHeight = 11.0f;
	float accentHue = 0.0f;      // 0 = player cyan, 1 = hostile orange, 2 = violet
	bool reverseJoint = false;
	bool tetrapod = false;
	int backUnits = 2;

	void Add(const Part& p) { if (partCount < MaxParts) parts[partCount++] = p; }
	void Place(Node n, float x, float y, float z) {
		NodeRest& r = nodes[static_cast<int>(n)];
		r.x = x; r.y = y; r.z = z; r.used = true;
	}
	void Socketed(SocketId id, Node n, float x, float y, float z,
	              float dx, float dy, float dz, float radius) {
		Socket& s = sockets[static_cast<int>(id)];
		s.id = id; s.node = n; s.x = x; s.y = y; s.z = z;
		s.dx = dx; s.dy = dy; s.dz = dz; s.radius = radius; s.used = true;
	}
};

/** Absolute rest position of a node, composed through its parents. */
ob::Vec3 NodeWorldRest(const Frame& f, Node n);

/** Rest-pose world position of a socket. */
ob::Vec3 SocketWorldRest(const Frame& f, SocketId id);

// ---------------------------------------------------------------------------
//  Measurement — what the test suite asserts against AC_DESIGN.md.
// ---------------------------------------------------------------------------
inline constexpr int SilhouetteBands = 12;

struct Metrics {
	float height = 0.0f;          // sole to highest point
	float shoulderWidth = 0.0f;   // widest span inside the shoulder band
	float waistWidth = 0.0f;      // narrowest span inside the waist band
	float footSpan = 0.0f;
	float widestOverall = 0.0f;
	float widestAtY = 0.0f;
	float narrowestAboveKnee = 0.0f;
	float narrowestAtY = 0.0f;
	float legFraction = 0.0f;     // hip pivot height / total height
	float headHeight = 0.0f;
	float coreHeight = 0.0f;
	float depth = 0.0f;

	float cleanArea = 0.0f;       // surface area of parts flagged as armour plane
	float detailArea = 0.0f;      // ...and of parts flagged as mechanism
	int accentParts = 0;
	int steelParts = 0;

	/** Half-width sampled at SilhouetteBands equal steps of NORMALISED height.
	 *  Two frames are "distinguishable at 100 m" when these disagree. */
	float band[SilhouetteBands] = {};

	float ShoulderToWaist() const { return waistWidth > 1e-4f ? shoulderWidth / waistWidth : 0.0f; }
	float DetailFraction() const {
		const float t = cleanArea + detailArea;
		return t > 1e-4f ? detailArea / t : 0.0f;
	}
};

/** Axis-aligned world extent of one part in the rest pose. */
void PartBounds(const Frame& f, const Part& p, ob::Vec3& outMin, ob::Vec3& outMax);

Metrics Measure(const Frame& f);

/** Half-width of the frame's silhouette at absolute height y. */
float WidthAt(const Frame& f, float y);

/** L1 distance between two normalised silhouette descriptors. */
float SilhouetteDistance(const Metrics& a, const Metrics& b);

/** Count of parts on `node` flagged as mechanism — the joint-detail test. */
int MechanismCount(const Frame& f, Node node);

/**
 * Mean distance from a class of part to the nearest rig node, in metres.
 *
 * This is how AC_DESIGN section 1's rule is actually measured. "Big plates,
 * concentrated detail" is not a claim about how MUCH mechanism there is — a
 * frame can be 30 % mechanism by area and still look like uniform greeble. It
 * is a claim about WHERE the mechanism is: clustered at the articulations,
 * absent from the flat spans. Rig nodes ARE the articulations, so mechanism
 * that sits measurably closer to them than the armour does is mechanism that
 * is concentrated, and the difference between the two means is the number
 * that says so.
 */
float MeanDistanceToNode(const Frame& f, bool wantDetail);

// ---------------------------------------------------------------------------
//  The frames themselves.
// ---------------------------------------------------------------------------
/** OB-01 REAVER — the player. 11.0 m, cfg::Player::Height. */
void BuildPlayer(Frame& out);

/** Hostiles. SHRIKE / KITE / BULWARK / NIGHTJAR / MT, per AC_DESIGN section 7. */
void BuildEnemy(Frame& out, ob::cfg::EnemyKind kind);

/** Any frame by kind, with the player selected by a null-ish sentinel. */
void BuildFrame(Frame& out, ob::cfg::EnemyKind kind, bool player);

}  // namespace obrig

// ===========================================================================
//  IMPLEMENTATION
//
//  Header-only, and deliberately so: the container test build compiles only
//  unreal/tests/*.cpp and ObCore/Private/*.cpp, so a .cpp here would be
//  invisible to the one build that can check this file. Everything below is
//  `inline`; it is built once per frame kind on a loading screen, never in a
//  tick path.
// ===========================================================================
namespace obrig {

// ---- node hierarchy -------------------------------------------------------
inline const Node* NodeParents() {
	static const Node kParent[static_cast<int>(Node::Count)] = {
		/* Root    */ Node::Root,
		/* Hips    */ Node::Root,
		/* Core    */ Node::Hips,
		/* Head    */ Node::Core,
		/* YokeL   */ Node::Core,   /* YokeR   */ Node::Core,
		/* ArmL    */ Node::YokeL,  /* ArmR    */ Node::YokeR,
		/* ThighL  */ Node::Hips,   /* ThighR  */ Node::Hips,
		/* ShinL   */ Node::ThighL, /* ShinR   */ Node::ThighR,
		/* FootL   */ Node::ShinL,  /* FootR   */ Node::ShinR,
		/* ThighBL */ Node::Hips,   /* ThighBR */ Node::Hips,
		/* ShinBL  */ Node::ThighBL,/* ShinBR  */ Node::ThighBR,
		/* BackL   */ Node::Core,   /* BackR   */ Node::Core,
	};
	return kParent;
}

inline ob::Vec3 NodeWorldRest(const Frame& f, Node n) {
	ob::Vec3 acc;
	const Node* parent = NodeParents();
	int guard = 0;
	Node cur = n;
	while (guard++ < static_cast<int>(Node::Count) + 1) {
		const NodeRest& r = f.nodes[static_cast<int>(cur)];
		acc.x += r.x; acc.y += r.y; acc.z += r.z;
		if (cur == Node::Root) break;
		cur = parent[static_cast<int>(cur)];
	}
	return acc;
}

inline ob::Vec3 SocketWorldRest(const Frame& f, SocketId id) {
	const Socket& s = f.sockets[static_cast<int>(id)];
	const ob::Vec3 base = NodeWorldRest(f, s.node);
	return ob::Vec3{ base.x + s.x, base.y + s.y, base.z + s.z };
}

// ---- bounds ---------------------------------------------------------------
inline void PartBounds(const Frame& f, const Part& p, ob::Vec3& outMin, ob::Vec3& outMax) {
	// Half-extents of the primitive's bounding box in its own local frame.
	float hx = p.w * 0.5f, hy = p.h * 0.5f, hz = p.d * 0.5f;
	switch (p.shape) {
		case Shape::Taper:
			hx = (p.w > p.wT ? p.w : p.wT) * 0.5f;
			hz = (p.d > p.dT ? p.d : p.dT) * 0.5f;
			break;
		case Shape::Rod:
		case Shape::Boot:
			hx = hz = p.w * 0.5f;
			break;
		case Shape::Ring:
			hx = hz = p.w * 0.5f;
			hy = p.h * 0.5f;
			break;
		case Shape::Nozzle:
			hx = hz = (p.w > p.d ? p.w : p.d) * 0.5f;
			break;
		case Shape::Boss:
			hx = hz = p.w * 0.5f;
			break;
		default:
			break;
	}

	const float cx = std::cos(p.rx), sx = std::sin(p.rx);
	const float cy = std::cos(p.ry), sy = std::sin(p.ry);
	const float cz = std::cos(p.rz), sz = std::sin(p.rz);

	// Intrinsic XYZ: R = Rx * Ry * Rz. Only the absolute row sums are needed
	// to bound a box, so the AABB is |R| * halfExtents.
	const float m00 = cy * cz;
	const float m01 = -cy * sz;
	const float m02 = sy;
	const float m10 = sx * sy * cz + cx * sz;
	const float m11 = -sx * sy * sz + cx * cz;
	const float m12 = -sx * cy;
	const float m20 = -cx * sy * cz + sx * sz;
	const float m21 = cx * sy * sz + sx * cz;
	const float m22 = cx * cy;

	const float ex = std::fabs(m00) * hx + std::fabs(m01) * hy + std::fabs(m02) * hz;
	const float ey = std::fabs(m10) * hx + std::fabs(m11) * hy + std::fabs(m12) * hz;
	const float ez = std::fabs(m20) * hx + std::fabs(m21) * hy + std::fabs(m22) * hz;

	const ob::Vec3 base = NodeWorldRest(f, p.node);
	const float px = base.x + p.x, py = base.y + p.y, pz = base.z + p.z;
	outMin = ob::Vec3{ px - ex, py - ey, pz - ez };
	outMax = ob::Vec3{ px + ex, py + ey, pz + ez };
}

inline float WidthAt(const Frame& f, float y) {
	float half = 0.0f;
	for (int i = 0; i < f.partCount; ++i) {
		ob::Vec3 lo, hi;
		PartBounds(f, f.parts[i], lo, hi);
		if (y < lo.y || y > hi.y) continue;
		const float a = std::fabs(lo.x), b = std::fabs(hi.x);
		const float w = a > b ? a : b;
		if (w > half) half = w;
	}
	return half * 2.0f;
}

inline float SurfaceArea(const Part& p) {
	switch (p.shape) {
		case Shape::Rod:
		case Shape::Boot: {
			const float r = p.w * 0.5f;
			return 2.0f * ob::PI * r * (r + p.h);
		}
		case Shape::Ring: {
			const float R = (p.w - p.h) * 0.5f;
			return 4.0f * ob::PI * ob::PI * (R > 0.0f ? R : 0.01f) * (p.h * 0.5f);
		}
		case Shape::Nozzle: {
			// Bell wall plus the visible throat depth. A flat disc reads as a
			// sticker (AC_DESIGN section 5), so depth is part of the shape.
			const float r0 = p.w * 0.5f, r1 = p.d * 0.5f;
			const float slant = std::sqrt(ob::Sq(r1 - r0) + ob::Sq(p.h));
			return ob::PI * (r0 + r1) * slant;
		}
		case Shape::Boss: {
			const float r = p.w * 0.5f;
			return ob::PI * r * r + 2.0f * ob::PI * r * p.h;
		}
		case Shape::Taper: {
			const float w = (p.w + p.wT) * 0.5f, d = (p.d + p.dT) * 0.5f;
			return 2.0f * (w * d) + 2.0f * p.h * (w + d);
		}
		default:
			return 2.0f * (p.w * p.h + p.w * p.d + p.h * p.d);
	}
}

inline Metrics Measure(const Frame& f) {
	Metrics m;
	if (f.partCount <= 0) return m;

	float top = -1e9f, bottom = 1e9f;
	float minZ = 1e9f, maxZ = -1e9f;
	for (int i = 0; i < f.partCount; ++i) {
		ob::Vec3 lo, hi;
		PartBounds(f, f.parts[i], lo, hi);
		if (hi.y > top) top = hi.y;
		if (lo.y < bottom) bottom = lo.y;
		if (lo.z < minZ) minZ = lo.z;
		if (hi.z > maxZ) maxZ = hi.z;

		const float area = SurfaceArea(f.parts[i]);
		if (f.parts[i].detail) m.detailArea += area; else m.cleanArea += area;
		if (f.parts[i].mat == Mat::Accent) ++m.accentParts;
		if (f.parts[i].mat == Mat::Steel) ++m.steelParts;
	}
	m.height = top - (bottom < 0.0f ? bottom : 0.0f);
	m.depth = maxZ - minZ;

	const ob::Vec3 hip = NodeWorldRest(f, Node::Hips);
	const ob::Vec3 core = NodeWorldRest(f, Node::Core);
	const ob::Vec3 head = NodeWorldRest(f, Node::Head);
	m.legFraction = m.height > 1e-4f ? hip.y / m.height : 0.0f;
	m.coreHeight = head.y - core.y;

	// Head volume: the tallest run of parts on the Head node, EXCLUDING the
	// antenna. "1/7 of core" is about the visored box, not the sensor spike —
	// measuring the spike would report a head twice its apparent size.
	{
		float hTop = -1e9f, hBot = 1e9f;
		for (int i = 0; i < f.partCount; ++i) {
			const Part& p = f.parts[i];
			if (p.node != Node::Head || p.shape == Shape::Rod) continue;
			ob::Vec3 lo, hi;
			PartBounds(f, p, lo, hi);
			if (hi.y > hTop) hTop = hi.y;
			if (lo.y < hBot) hBot = lo.y;
		}
		m.headHeight = (hTop > hBot) ? hTop - hBot : 0.0f;
	}

	// Shoulder / waist / foot spans, sampled finely so a single wide bolt
	// cannot be mistaken for the plate it sits on.
	struct Span { float width; float atY; };
	const float scan = m.height / 400.0f;
	// `atY` is the MIDPOINT of the plateau that achieves the extreme, not the
	// first sample that reaches it. A shoulder plate is widest over a 1 m run;
	// reporting either end of that run as "where the frame is widest" is an
	// artifact of the scan direction and reads as a fault in the design when
	// it is only a fault in the measurement.
	auto spanIn = [&](float y0, float y1, bool wantMax) -> Span {
		float best = wantMax ? 0.0f : 1e9f;
		for (float y = y0; y <= y1; y += scan) {
			const float w = WidthAt(f, y);
			if (w <= 1e-4f) continue;
			if (wantMax ? (w > best) : (w < best)) best = w;
		}
		if (!wantMax && best > 1e8f) return Span{ 0.0f, y0 };
		const float tol = best * 0.005f;
		float lo = -1.0f, hi = -1.0f;
		for (float y = y0; y <= y1; y += scan) {
			const float w = WidthAt(f, y);
			if (w <= 1e-4f) continue;
			if (std::fabs(w - best) > tol) continue;
			if (lo < 0.0f) lo = y;
			hi = y;
		}
		return Span{ best, lo < 0.0f ? y0 : (lo + hi) * 0.5f };
	};

	const float H = m.height;
	// Bands are quoted off the RIG STATIONS, not off fractions of height.
	//
	// Height fractions look portable and are not: they were calibrated on a
	// frame whose legs are 58 % of its height, so on BULWARK (46 %) the "waist"
	// window lands on the thighs and on SHRIKE (64 %) it lands below the
	// pelvis. Both then report the widest thing in the wrong band as the waist
	// and the shoulder-to-waist ratio silently becomes a measurement of
	// something else. Node positions move with the design; fractions do not.
	const float waistLo = NodeWorldRest(f, Node::Hips).y;
	const float waistHi = NodeWorldRest(f, Node::Core).y;
	const float yokeY = f.nodes[static_cast<int>(Node::YokeR)].used
	                        ? NodeWorldRest(f, Node::YokeR).y
	                        : waistHi;
	const float ankleY = f.nodes[static_cast<int>(Node::FootR)].used
	                         ? NodeWorldRest(f, Node::FootR).y
	                         : H * 0.09f;
	const float kneeY = f.nodes[static_cast<int>(Node::ShinR)].used
	                        ? NodeWorldRest(f, Node::ShinR).y
	                        : H * 0.4f;

	const Span shoulder = spanIn(yokeY - m.coreHeight * 0.20f, top, true);
	const Span waist = spanIn(waistLo, waistHi, false);
	const Span foot = spanIn(0.0f, ankleY + 0.35f, true);
	const Span widest = spanIn(0.0f, H, true);
	// Chassis only — knee to the base of the head. AC_DESIGN calls the waist
	// "the narrowest point of the whole frame", but it also calls for a head
	// about 1/7 of core height, and a head that tiny is necessarily narrower
	// than the waist. The claim that can actually be true, and the one the
	// silhouette is about, is that the waist is the narrowest point of the
	// BODY COLUMN. Including the head would make the assertion measure the
	// head every time and say nothing about the pinch.
	const float headBaseY = f.nodes[static_cast<int>(Node::Head)].used
	                            ? NodeWorldRest(f, Node::Head).y
	                            : top;
	const Span narrow = spanIn(kneeY, headBaseY, false);

	m.shoulderWidth = shoulder.width;
	m.waistWidth = waist.width;
	m.footSpan = foot.width;
	m.widestOverall = widest.width;
	m.widestAtY = widest.atY;
	m.narrowestAboveKnee = narrow.width;
	m.narrowestAtY = narrow.atY;

	for (int i = 0; i < SilhouetteBands; ++i) {
		const float t = (static_cast<float>(i) + 0.5f) / static_cast<float>(SilhouetteBands);
		m.band[i] = WidthAt(f, t * H) * 0.5f;
	}
	return m;
}

inline float SilhouetteDistance(const Metrics& a, const Metrics& b) {
	// Normalise each descriptor by its own frame height, so the comparison is
	// about SHAPE. Two frames that differ only in scale are not distinguishable
	// at 100 m without a reference, and the design bible asks for shape.
	float sum = 0.0f;
	const float na = a.height > 1e-4f ? a.height : 1.0f;
	const float nb = b.height > 1e-4f ? b.height : 1.0f;
	for (int i = 0; i < SilhouetteBands; ++i) {
		sum += std::fabs(a.band[i] / na - b.band[i] / nb);
	}
	return sum / static_cast<float>(SilhouetteBands);
}

inline int MechanismCount(const Frame& f, Node node) {
	int n = 0;
	for (int i = 0; i < f.partCount; ++i)
		if (f.parts[i].node == node && f.parts[i].detail) ++n;
	return n;
}

inline float MeanDistanceToNode(const Frame& f, bool wantDetail) {
	// Node positions are cached once: NodeWorldRest walks the parent chain, and
	// this is an O(parts * nodes) loop already.
	ob::Vec3 nodePos[static_cast<int>(Node::Count)];
	bool nodeUsed[static_cast<int>(Node::Count)];
	for (int n = 0; n < static_cast<int>(Node::Count); ++n) {
		nodeUsed[n] = f.nodes[n].used;
		nodePos[n] = nodeUsed[n] ? NodeWorldRest(f, static_cast<Node>(n)) : ob::Vec3{};
	}

	double sum = 0.0;
	int count = 0;
	for (int i = 0; i < f.partCount; ++i) {
		const Part& p = f.parts[i];
		if (p.detail != wantDetail) continue;
		const ob::Vec3 base = NodeWorldRest(f, p.node);
		const ob::Vec3 at{ base.x + p.x, base.y + p.y, base.z + p.z };
		float nearest = 1e9f;
		for (int n = 0; n < static_cast<int>(Node::Count); ++n) {
			if (!nodeUsed[n] || static_cast<Node>(n) == Node::Root) continue;
			const float dsq = DistanceSq(at, nodePos[n]);
			if (dsq < nearest) nearest = dsq;
		}
		if (nearest < 1e8f) { sum += std::sqrt(static_cast<double>(nearest)); ++count; }
	}
	return count > 0 ? static_cast<float>(sum / count) : 0.0f;
}

// ===========================================================================
//  Builders
// ===========================================================================
namespace detail {

struct Pen {
	Frame* f = nullptr;
	Node node = Node::Root;
	explicit Pen(Frame* frame) : f(frame) {}
	/** Written to when the frame is full, so an overflowing builder mutates a
	 *  scratch part instead of silently re-writing the last real one. */
	Part overflow;
	int dropped = 0;

	void At(Node n) { node = n; }

	Part& Emit(Shape s, Mat m, float x, float y, float z, float w, float h, float d) {
		Part p;
		p.shape = s; p.mat = m; p.node = node;
		p.x = x; p.y = y; p.z = z;
		p.w = w; p.h = h; p.d = d;
		p.wT = w; p.dT = d;
		p.chamfer = 0.055f;
		if (f->partCount >= MaxParts) { ++dropped; overflow = p; return overflow; }
		f->Add(p);
		return f->parts[f->partCount - 1];
	}

	// ---- clean armour planes (70 % of the surface, AC_DESIGN section 1) ----
	Part& Plate(Mat m, float x, float y, float z, float w, float h, float d) {
		return Emit(Shape::Plate, m, x, y, z, w, h, d);
	}
	Part& Taper(Mat m, float x, float y, float z, float w, float h, float d, float wT, float dT) {
		Part& p = Emit(Shape::Taper, m, x, y, z, w, h, d);
		p.wT = wT; p.dT = dT;
		return p;
	}
	/** Pointed leading edge at -Z: shoulder intake lip, knee cap, toe. */
	Part& Wedge(Mat m, float x, float y, float z, float w, float h, float d) {
		return Emit(Shape::Wedge, m, x, y, z, w, h, d);
	}

	// ---- concentrated mechanism (30 %, AC_DESIGN section 4) ----
	Part& Rod(Mat m, float x, float y, float z, float dia, float len) {
		Part& p = Emit(Shape::Rod, m, x, y, z, dia, len, dia);
		p.detail = true;
		return p;
	}
	Part& Ring(Mat m, float x, float y, float z, float dia, float tube) {
		Part& p = Emit(Shape::Ring, m, x, y, z, dia, tube, dia);
		p.detail = true;
		return p;
	}
	Part& Boss(float x, float y, float z, float dia, float stand) {
		Part& p = Emit(Shape::Boss, Mat::Steel, x, y, z, dia, stand, dia);
		p.detail = true;
		return p;
	}
	Part& Boot(float x, float y, float z, float dia, float len) {
		Part& p = Emit(Shape::Boot, Mat::Frame2, x, y, z, dia, len, dia);
		p.detail = true;
		return p;
	}
	Part& Vent(Mat m, float x, float y, float z, float w, float h, float depth) {
		Part& p = Emit(Shape::Vent, m, x, y, z, w, h, depth);
		p.detail = true;
		return p;
	}
	/** Bell with a real throat depth. `dia` is the throat, `exit` the mouth. */
	Part& Nozzle(float x, float y, float z, float dia, float exit, float depth) {
		Part& p = Emit(Shape::Nozzle, Mat::Frame2, x, y, z, dia, depth, exit);
		p.detail = true;
		return p;
	}
	/** The glowing core inside a bell. Accent, and one of very few. */
	Part& Core(float x, float y, float z, float dia) {
		Part& p = Emit(Shape::Ring, Mat::Accent, x, y, z, dia, dia * 0.34f, dia);
		p.detail = true;
		return p;
	}

	/**
	 * A complete joint: pivot boss on the axis, a bare-steel actuator rod
	 * across it, and a ribbed boot. AC_DESIGN section 4 — "every articulation
	 * must show mechanism, at a scale that reads at 20-40 m". Emitting these
	 * three together is what stops a joint from quietly shipping bare.
	 */
	//
	// `rodDir` runs the actuator UP (+1) or DOWN (-1) from the axis. It is a
	// parameter rather than a convention because a hip actuator hangs down into
	// the thigh while a knee actuator reaches up to it, and getting that
	// backwards puts hardware in the waist band — which is the one band on the
	// whole machine that has to stay clean (AC_DESIGN section 2: the waist is
	// the narrowest point of the frame, and the pinch is the defining line).
	void Joint(float x, float y, float z, float dia, float rodLen, float rodOffZ,
	           int side, int rodDir = 1) {
		Boss(x, y, z, dia, dia * 0.30f).rz = ob::PI * 0.5f;
		Rod(Mat::Steel, x + static_cast<float>(side) * dia * 0.10f,
		    y + static_cast<float>(rodDir) * rodLen * 0.42f,
		    z + rodOffZ, dia * 0.30f, rodLen);
		Boot(x, y, z, dia * 0.86f, dia * 0.72f).rz = ob::PI * 0.5f;
	}
};

}  // namespace detail

// ---------------------------------------------------------------------------
//  OB-01 REAVER — the player frame.
//
//  Every station below is AC_DESIGN.md section 2's table, in metres from the
//  sole. They are targets, and unreal/tests/test_ue_layer.cpp asserts them.
//
//    feet + ankle   0.00 - 1.00
//    shin           1.00 - 3.60
//    knee           3.60 - 4.40   (axis at 4.00)
//    thigh          4.40 - 6.40
//    hip / waist    6.40 - 7.20   NARROWEST POINT OF THE FRAME
//    core           7.20 - 10.00
//    shoulders      9.00 - 10.60  WIDEST POINT
//    head          10.00 - 11.00  (visored box only 0.40 tall = core / 7)
//
//  Widths are set FROM the 3.4:1 rule rather than eyeballed and checked after:
//    waist 1.62 m  ->  shoulders 1.62 * 3.4 = 5.508 m.
// ---------------------------------------------------------------------------
inline void BuildPlayer(Frame& out) {
	out = Frame{};
	out.designHeight = ob::cfg::Player::Height;   // 11.0
	out.accentHue = 0.0f;
	out.backUnits = 2;

	// ---- rig stations ----
	out.Place(Node::Root, 0.0f, 0.0f, 0.0f);
	out.Place(Node::Hips, 0.0f, 6.38f, 0.0f);                  // 58 % of 11.0
	out.Place(Node::Core, 0.0f, 0.82f, 0.0f);                  // world 7.20
	out.Place(Node::Head, 0.0f, 2.82f, -0.06f);                // world 10.02
	out.Place(Node::YokeL, -1.22f, 2.14f, 0.02f);              // world 9.34
	out.Place(Node::YokeR, 1.22f, 2.14f, 0.02f);
	out.Place(Node::ArmL, -0.74f, -0.36f, 0.0f);               // world 8.98
	out.Place(Node::ArmR, 0.74f, -0.36f, 0.0f);
	out.Place(Node::ThighL, -1.16f, -0.18f, 0.0f);             // world 6.20
	out.Place(Node::ThighR, 1.16f, -0.18f, 0.0f);
	out.Place(Node::ShinL, 0.0f, -2.20f, 0.14f);               // world 4.00 knee
	out.Place(Node::ShinR, 0.0f, -2.20f, 0.14f);
	out.Place(Node::FootL, 0.0f, -3.00f, -0.12f);              // world 1.00 ankle
	out.Place(Node::FootR, 0.0f, -3.00f, -0.12f);
	out.Place(Node::BackL, -1.04f, 2.46f, 1.18f);              // world 9.66
	out.Place(Node::BackR, 1.04f, 2.46f, 1.18f);

	detail::Pen K(&out);

	// =======================================================================
	//  HIPS / WAIST — the pinch. Nothing wide is allowed in 6.40 - 7.20.
	// =======================================================================
	K.At(Node::Hips);
	K.Plate(Mat::Frame, 0.0f, 0.42f, 0.0f, 1.62f, 0.80f, 1.34f);              // waist column
	K.Ring(Mat::Steel, 0.0f, 0.10f, 0.0f, 1.30f, 0.13f);                      // waist bearing
	K.Plate(Mat::Hull3, 0.0f, 0.76f, -0.04f, 1.56f, 0.14f, 1.30f);            // belt cap
	// Skirt plates hang BELOW the waist band, into the thigh band, so the
	// pinch survives them.
	K.Plate(Mat::Hull, 0.0f, -0.30f, -0.80f, 1.34f, 1.00f, 0.30f).rx = 0.15f; // front skirt
	K.Plate(Mat::Hull2, 0.0f, -0.26f, 0.80f, 1.52f, 0.88f, 0.28f).rx = -0.13f;
	// EVERYTHING below hangs BELOW hips-local +0.02 (world 6.40). The waist
	// band 6.40 - 7.20 carries the column and nothing else, which is what makes
	// it the narrowest cross-section of the frame and delivers the 3.4:1.
	for (int i = 0; i < 2; ++i) {
		const float s = (i == 0) ? -1.0f : 1.0f;
		K.Taper(Mat::Hull, s * 1.10f, -0.60f, 0.06f, 0.34f, 1.20f, 1.44f, 0.30f, 1.06f).rz = s * 0.12f;
		K.Plate(Mat::Hull2, s * 1.30f, -0.52f, 0.02f, 0.18f, 0.58f, 0.90f);
		// hip vernier: fires on a LATERAL quick boost, so it must read from
		// the front and the side, not only from behind (AC_DESIGN section 5).
		K.Plate(Mat::Hull3, s * 1.08f, -0.40f, 0.72f, 0.62f, 0.62f, 0.78f);
		K.Nozzle(s * 1.08f, -0.40f, 1.06f, 0.20f, 0.32f, 0.30f).rx = ob::PI * 0.5f;
		K.Core(s * 1.08f, -0.40f, 1.14f, 0.17f).rx = ob::PI * 0.5f;
		K.Nozzle(s * 1.42f, -0.62f, 0.02f, 0.13f, 0.21f, 0.20f).rz = s * ob::PI * 0.5f;
		// hip ball joint: housing, cover plate, hose bundle to the thigh. The
		// actuator hangs DOWN into the thigh, keeping the waist band clear.
		K.Joint(s * 1.16f, -0.34f, 0.0f, 0.56f, 0.72f, -0.30f, static_cast<int>(s), -1);
		K.Rod(Mat::Frame2, s * 0.96f, -0.52f, 0.62f, 0.11f, 0.86f).rx = 0.42f;
		K.Rod(Mat::Frame2, s * 1.06f, -0.52f, 0.68f, 0.09f, 0.82f).rx = 0.46f;
	}
	out.Socketed(SocketId::ThrHipL, Node::Hips, -1.08f, -0.40f, 1.14f, 0.0f, 0.0f, 1.0f, 0.16f);
	out.Socketed(SocketId::ThrHipR, Node::Hips, 1.08f, -0.40f, 1.14f, 0.0f, 0.0f, 1.0f, 0.16f);

	// =======================================================================
	//  CORE — chest slopes forward and outward toward the shoulders, V-cut
	//  intake at the sternum, raised central spine, yoke reads as separate.
	// =======================================================================
	K.At(Node::Core);
	K.Plate(Mat::Frame, 0.0f, 1.28f, 0.06f, 1.92f, 2.02f, 1.66f);             // chest frame
	// breast armour, layered off the frame with a visible gap
	K.Taper(Mat::Hull, 0.0f, 1.52f, -0.86f, 1.32f, 1.46f, 0.40f, 1.86f, 0.44f).rx = -0.12f;
	K.Wedge(Mat::Hull2, -0.74f, 1.62f, -0.90f, 0.72f, 1.20f, 0.42f).ry = 0.30f;
	K.Wedge(Mat::Hull2, 0.74f, 1.62f, -0.90f, 0.72f, 1.20f, 0.42f).ry = -0.30f;
	K.Vent(Mat::Hull3, 0.0f, 1.46f, -1.06f, 0.72f, 0.56f, 0.16f);             // V-cut intake
	K.Plate(Mat::Hull3, 0.0f, 2.02f, -0.92f, 0.30f, 0.86f, 0.24f);            // raised spine
	K.Plate(Mat::Hull3, 0.0f, 0.42f, -0.82f, 1.44f, 0.76f, 0.32f).rx = 0.18f; // abdomen
	K.Plate(Mat::Hull4, 0.0f, -0.06f, -0.68f, 1.02f, 0.34f, 0.26f).rx = 0.36f;
	// the yoke: one sweeping deck that carries the shoulders
	K.Plate(Mat::Hull3, 0.0f, 2.14f, 0.10f, 2.58f, 0.42f, 1.62f);
	K.Plate(Mat::Hull3, 0.0f, 1.16f, 0.94f, 2.20f, 1.96f, 0.36f);             // back plate
	for (int i = 0; i < 2; ++i) {
		const float s = (i == 0) ? -1.0f : 1.0f;
		K.Taper(Mat::Hull, s * 1.10f, 1.34f, 0.02f, 0.42f, 1.72f, 1.56f, 0.40f, 1.22f).rz = -s * 0.06f;
		K.Plate(Mat::Hull4, s * 1.16f, 0.42f, 0.16f, 0.22f, 0.48f, 0.96f);
		K.Vent(Mat::Hull3, s * 1.28f, 1.18f, 0.28f, 0.42f, 0.84f, 0.14f).rz = s * ob::PI * 0.5f;
	}
	// exactly three painted seam strips. The accent stays rationed.
	K.Plate(Mat::Accent, 0.0f, 0.60f, -0.98f, 0.92f, 0.05f, 0.06f).rx = 0.16f;
	K.Plate(Mat::Accent, -1.16f, 1.60f, -0.82f, 0.05f, 0.50f, 0.06f);
	K.Plate(Mat::Accent, 1.16f, 1.60f, -0.82f, 0.05f, 0.50f, 0.06f);
	// radiator stack + the main booster bank: bells angled down and back on a
	// visible backpack block, heat-stained throats with a bright core inside.
	K.Plate(Mat::Hull3, 0.0f, 0.62f, 1.32f, 1.86f, 1.44f, 0.86f);
	for (int i = 0; i < 5; ++i)
		K.Plate(Mat::Steel, 0.0f, 1.72f + static_cast<float>(i) * 0.13f, 1.20f, 1.58f, 0.06f, 0.40f);
	for (int i = 0; i < 2; ++i) {
		const float s = (i == 0) ? -1.0f : 1.0f;
		K.Plate(Mat::Hull2, s * 0.58f, 0.62f, 1.70f, 0.80f, 1.22f, 0.42f);
		K.Nozzle(s * 0.58f, 0.44f, 1.92f, 0.46f, 0.74f, 0.52f).rx = ob::PI * 0.5f - 0.34f;
		K.Core(s * 0.58f, 0.36f, 2.04f, 0.40f).rx = ob::PI * 0.5f - 0.34f;
		K.Nozzle(s * 1.18f, 1.62f, 1.30f, 0.15f, 0.24f, 0.22f).rx = ob::PI * 0.5f;   // shoulder-blade
	}
	K.Plate(Mat::Hull3, 0.0f, 1.42f, 2.02f, 1.72f, 0.22f, 0.44f).rx = 0.30f;  // shroud lip
	out.Socketed(SocketId::ThrMainL, Node::Core, -0.58f, 0.36f, 2.10f, 0.0f, -0.33f, 0.94f, 0.37f);
	out.Socketed(SocketId::ThrMainR, Node::Core, 0.58f, 0.36f, 2.10f, 0.0f, -0.33f, 0.94f, 0.37f);
	out.Socketed(SocketId::ThrShoulderL, Node::Core, -1.18f, 1.62f, 1.42f, 0.0f, 0.0f, 1.0f, 0.12f);
	out.Socketed(SocketId::ThrShoulderR, Node::Core, 1.18f, 1.62f, 1.42f, 0.0f, 0.0f, 1.0f, 0.12f);
	// neck: a raised collar so the head stands clear without sitting ON it
	K.Plate(Mat::Hull3, 0.0f, 2.48f, -0.10f, 0.96f, 0.22f, 0.84f);
	K.Boot(0.0f, 2.70f, -0.10f, 0.44f, 0.34f);

	// =======================================================================
	//  HEAD — tiny (0.40 = core height / 7), set LOW between the shoulders.
	//  A visor slit and a single optic. Never a face.
	// =======================================================================
	K.At(Node::Head);
	K.Taper(Mat::Hull, 0.0f, 0.20f, -0.04f, 0.78f, 0.40f, 0.74f, 0.62f, 0.58f);
	K.Plate(Mat::Frame, 0.0f, 0.20f, -0.36f, 0.66f, 0.20f, 0.10f).rx = -0.16f;  // visor recess
	K.Plate(Mat::Accent, 0.0f, 0.20f, -0.41f, 0.54f, 0.09f, 0.05f).rx = -0.16f; // THE optic
	K.Plate(Mat::Hull2, -0.42f, 0.22f, 0.02f, 0.14f, 0.24f, 0.34f);             // sensor pod
	K.Plate(Mat::Hull2, 0.42f, 0.22f, 0.02f, 0.14f, 0.24f, 0.34f);
	K.Vent(Mat::Hull3, 0.0f, 0.02f, -0.30f, 0.40f, 0.10f, 0.08f);               // chin vent
	K.Rod(Mat::Steel, -0.30f, 0.68f, 0.20f, 0.05f, 0.62f).rz = 0.16f;           // antenna -> 11.00
	out.Socketed(SocketId::Optic, Node::Head, 0.0f, 0.20f, -0.42f, 0.0f, 0.0f, -1.0f, 0.27f);

	// =======================================================================
	//  SHOULDERS — swept back, POINTED leading edge, overhanging the arm.
	//  "This one form does more for the silhouette than anything else."
	//  Outer edge lands at 2.754 m => 5.508 m span => 3.4 : 1 against the waist.
	// =======================================================================
	for (int i = 0; i < 2; ++i) {
		const float s = (i == 0) ? -1.0f : 1.0f;
		K.At(i == 0 ? Node::YokeL : Node::YokeR);
		// collar caps the gap into the torso — no visible hole
		K.Ring(Mat::Frame, 0.0f, 0.0f, 0.0f, 0.86f, 0.20f).rz = ob::PI * 0.5f;
		K.Boss(s * 0.16f, 0.0f, 0.0f, 0.52f, 0.16f).rz = ob::PI * 0.5f;
		K.Rod(Mat::Steel, s * 0.30f, -0.28f, -0.26f, 0.13f, 0.62f).rx = 0.30f;   // actuator
		// The shell: one sweeping plane, tapering outboard and back.
		//
		// The outboard edges are set FROM the 3.4:1 rule, not eyeballed. The
		// waist column is 1.62 m, so the shoulders must span 1.62 * 3.4 =
		// 5.508 m and no part of this cluster may reach past x = 2.754. Every
		// offset below is that budget minus the part's own rotated half-width
		// (a rotated plate is wider than its `w`, which is the trap).
		K.Wedge(Mat::Hull, s * 0.78f, 0.52f, -0.22f, 1.34f, 0.92f, 1.62f).rz = -s * 0.16f;
		K.Taper(Mat::Hull2, s * 0.98f, 0.22f, 0.26f, 0.94f, 0.86f, 1.32f, 0.64f, 0.92f).rz = -s * 0.20f;
		K.Plate(Mat::Hull3, s * 1.14f, 1.00f, 0.30f, 0.70f, 0.20f, 1.10f).rz = -s * 0.26f;
		K.Vent(Mat::Hull3, s * 1.10f, -0.16f, -0.52f, 0.44f, 0.34f, 0.12f);
	}

	// =======================================================================
	//  ARMS — tapered shell, wider at the elbow. The weapon unit clamps on and
	//  is LONGER than the arm itself.
	// =======================================================================
	for (int i = 0; i < 2; ++i) {
		const float s = (i == 0) ? -1.0f : 1.0f;
		K.At(i == 0 ? Node::ArmL : Node::ArmR);
		K.Taper(Mat::Hull, 0.0f, -0.52f, 0.0f, 0.72f, 1.04f, 0.74f, 0.60f, 0.62f).rz = 0.0f;
		K.Joint(0.0f, -1.06f, 0.0f, 0.44f, 0.52f, -0.22f, static_cast<int>(s));  // elbow
		K.Taper(Mat::Hull2, 0.0f, -1.62f, -0.04f, 0.66f, 1.06f, 0.70f, 0.50f, 0.54f);
		K.Plate(Mat::Hull3, s * 0.30f, -1.60f, 0.02f, 0.16f, 0.66f, 0.52f);
	}
	// R-arm: MG-014 LANCET. 2.10 m of weapon on a 1.60 m forearm.
	K.At(Node::ArmR);
	K.Plate(Mat::Frame, 0.16f, -1.86f, -0.72f, 0.40f, 0.44f, 1.28f);
	K.Taper(Mat::Hull3, 0.16f, -1.86f, -1.58f, 0.34f, 0.34f, 1.10f, 0.26f, 0.26f).rx = ob::PI * 0.5f;
	K.Rod(Mat::Steel, 0.16f, -1.86f, -2.16f, 0.15f, 0.68f).rx = ob::PI * 0.5f;   // barrel
	K.Vent(Mat::Hull2, 0.16f, -1.62f, -1.10f, 0.24f, 0.30f, 0.08f);
	K.Plate(Mat::Hull2, 0.16f, -1.58f, -0.60f, 0.30f, 0.26f, 0.52f);            // magazine
	out.Socketed(SocketId::MuzzleRArm, Node::ArmR, 0.16f, -1.86f, -2.50f, 0.0f, 0.0f, -1.0f, 0.09f);
	// L-arm: PB-03 VERGE. Emitter housing, blade is VFX.
	K.At(Node::ArmL);
	K.Plate(Mat::Frame, -0.16f, -1.88f, -0.54f, 0.36f, 0.40f, 0.96f);
	K.Wedge(Mat::Hull3, -0.16f, -1.88f, -1.24f, 0.30f, 0.46f, 0.86f);
	K.Rod(Mat::Steel, -0.16f, -1.88f, -1.62f, 0.10f, 0.34f).rx = ob::PI * 0.5f;
	K.Core(-0.16f, -1.88f, -1.74f, 0.16f).rx = ob::PI * 0.5f;
	out.Socketed(SocketId::MuzzleLArm, Node::ArmL, -0.16f, -1.88f, -1.80f, 0.0f, 0.0f, -1.0f, 0.10f);

	// =======================================================================
	//  BACK UNITS — stand off the shoulders on PYLONS, angled outward, with
	//  DAYLIGHT between the unit and the body. "A huge readability win."
	// =======================================================================
	for (int i = 0; i < 2; ++i) {
		const float s = (i == 0) ? -1.0f : 1.0f;
		K.At(i == 0 ? Node::BackL : Node::BackR);
		K.Rod(Mat::Frame, -s * 0.24f, -0.34f, -0.16f, 0.26f, 0.86f).rz = -s * 0.34f;  // pylon
		K.Boss(-s * 0.36f, -0.62f, -0.16f, 0.34f, 0.12f).rz = ob::PI * 0.5f;
	}
	// R-back: VP-60LCS vertical rack — six tubes, cells visible from above.
	K.At(Node::BackR);
	K.Plate(Mat::Hull, 0.30f, 0.28f, 0.0f, 0.86f, 0.94f, 1.36f).rz = -0.12f;
	K.Plate(Mat::Hull3, 0.30f, 0.76f, 0.0f, 0.78f, 0.10f, 1.24f).rz = -0.12f;
	for (int c = 0; c < 6; ++c) {
		const float cx = 0.30f + ((c % 2 == 0) ? -0.18f : 0.18f);
		const float cz = -0.42f + static_cast<float>(c / 2) * 0.42f;
		K.Nozzle(cx, 0.72f, cz, 0.15f, 0.19f, 0.24f);
	}
	out.Socketed(SocketId::MuzzleRBack, Node::BackR, 0.30f, 0.86f, 0.0f, 0.0f, 1.0f, 0.0f, 0.16f);
	// L-back: BML-SB PYRE — one heavy barrel, longer than the unit that holds it.
	K.At(Node::BackL);
	K.Plate(Mat::Hull, -0.30f, 0.24f, 0.10f, 0.80f, 0.82f, 1.30f).rz = 0.12f;
	K.Taper(Mat::Hull3, -0.30f, 0.30f, -0.96f, 0.52f, 1.34f, 0.54f, 0.40f, 0.42f).rx = ob::PI * 0.5f;
	K.Rod(Mat::Steel, -0.30f, 0.30f, -1.82f, 0.24f, 0.86f).rx = ob::PI * 0.5f;
	K.Ring(Mat::Steel, -0.30f, 0.30f, -1.52f, 0.42f, 0.09f).rx = ob::PI * 0.5f;
	K.Vent(Mat::Hull2, -0.30f, 0.62f, 0.28f, 0.34f, 0.30f, 0.10f);
	out.Socketed(SocketId::MuzzleLBack, Node::BackL, -0.30f, 0.30f, -2.28f, 0.0f, 0.0f, -1.0f, 0.13f);

	// =======================================================================
	//  LEGS — the heaviest volume on the machine. Thigh tapers UPWARD; knee
	//  cap overhangs the shin and comes to a point; ankle sweeps into a heel
	//  spur over a wide sole with a raised toe.
	// =======================================================================
	for (int i = 0; i < 2; ++i) {
		const float s = (i == 0) ? -1.0f : 1.0f;

		K.At(i == 0 ? Node::ThighL : Node::ThighR);
		// One tapered volume, heaviest at the knee, in the 4.40 - 6.40 band
		// (thigh-local -1.98 .. +0.02).
		K.Taper(Mat::Hull, 0.0f, -0.98f, 0.0f, 1.06f, 2.00f, 1.24f, 0.86f, 0.98f).rx = 0.0f;
		K.Plate(Mat::Hull2, s * 0.50f, -1.10f, 0.08f, 0.20f, 1.36f, 1.00f).rz = -s * 0.05f;
		K.Plate(Mat::Hull3, 0.0f, -1.72f, -0.60f, 0.84f, 0.62f, 0.24f).rx = -0.18f;
		K.Rod(Mat::Frame2, s * 0.34f, -1.30f, 0.62f, 0.10f, 1.30f);                // hose to knee
		K.Rod(Mat::Steel, s * 0.16f, -1.46f, 0.52f, 0.13f, 1.10f);                 // knee actuator

		K.At(i == 0 ? Node::ShinL : Node::ShinR);
		// knee: cap with a POINTED leading tip, overhanging the shin
		K.Wedge(Mat::Hull, 0.0f, 0.10f, -0.42f, 0.98f, 0.78f, 0.86f).rx = -0.10f;
		K.Joint(0.0f, 0.0f, 0.10f, 0.68f, 0.66f, 0.34f, static_cast<int>(s));
		// shin: narrow armoured shell over a VISIBLE inner frame
		K.Plate(Mat::Frame, 0.0f, -1.60f, 0.06f, 0.56f, 2.30f, 0.60f);             // inner frame
		K.Taper(Mat::Hull2, 0.0f, -1.34f, -0.26f, 0.86f, 1.70f, 0.72f, 0.72f, 0.60f);
		K.Plate(Mat::Hull3, s * 0.42f, -1.70f, 0.06f, 0.16f, 1.42f, 0.66f);
		K.Plate(Mat::Hull4, 0.0f, -2.34f, -0.32f, 0.66f, 0.60f, 0.30f).rx = 0.16f;
		K.Nozzle(s * 0.46f, -1.10f, 0.44f, 0.13f, 0.20f, 0.20f).rx = ob::PI * 0.5f;  // calf vernier
		K.Rod(Mat::Steel, s * 0.24f, -1.94f, 0.40f, 0.11f, 1.24f);                  // ankle actuator
		K.Rod(Mat::Steel, -s * 0.24f, -1.94f, 0.40f, 0.11f, 1.24f);

		K.At(i == 0 ? Node::FootL : Node::FootR);
		// ankle: ribbed boot + two piston rods, then a wide sole
		K.Boot(0.0f, -0.06f, 0.0f, 0.52f, 0.44f);
		K.Boss(s * 0.28f, -0.06f, 0.0f, 0.34f, 0.10f).rz = ob::PI * 0.5f;
		K.Plate(Mat::Frame, 0.0f, -0.42f, 0.02f, 0.62f, 0.44f, 0.70f);
		K.Plate(Mat::Hull, 0.0f, -0.80f, -0.12f, 1.30f, 0.30f, 2.10f);             // sole plate
		K.Wedge(Mat::Hull2, 0.0f, -0.60f, -1.02f, 1.06f, 0.34f, 0.60f).rx = -0.26f; // raised toe
		K.Plate(Mat::Hull3, 0.0f, -0.62f, 0.86f, 0.70f, 0.40f, 0.62f).rx = 0.34f;   // heel spur
		K.Plate(Mat::Hull2, s * 0.58f, -0.70f, -0.10f, 0.20f, 0.34f, 1.60f);
	}
	out.Socketed(SocketId::ThrCalfL, Node::ShinL, -0.46f, -1.10f, 0.54f, 0.0f, 0.0f, 1.0f, 0.10f);
	out.Socketed(SocketId::ThrCalfR, Node::ShinR, 0.46f, -1.10f, 0.54f, 0.0f, 0.0f, 1.0f, 0.10f);
}

// ---------------------------------------------------------------------------
//  Hostiles.
//
//  AC_DESIGN section 7 demands each frame be distinguishable BY SILHOUETTE
//  ALONE AT 100 M, so the builder below is parameterised on the handful of
//  proportions that actually change a silhouette — height, shoulder span,
//  waist pinch, leg length fraction, joint direction, back-unit count — and
//  test_ue_layer.cpp measures the pairwise distance between the results
//  rather than trusting that four different-looking part lists look different.
// ---------------------------------------------------------------------------
namespace detail {

struct EnemySpec {
	float height;
	float waist;
	/** The MEASURED shoulder-to-waist ratio this frame should come out at.
	 *  Not a construction offset — the builder divides it back out through
	 *  kSpread below, so what is written in this table is what Measure()
	 *  reports. A spec number that is not the number the test reads is a spec
	 *  number nobody can check. */
	float shoulderRatio;
	float legFrac;
	float footSpan;
	float coreDepth;
	int backUnits;
	bool reverseJoint;
	bool tetrapod;
	float accentHue;
	float leanZ;           // forward lean of the core, radians
	float armLength;
	bool bigArms;          // heavy shoulder-mounted weapon blocks
};

/**
 * How far past `shoulderHalf` the outermost shoulder part actually reaches,
 * as a multiple of it. Derived from the geometry emitted below — the yoke node
 * offset (0.44), the armour's own offset (0.42 / 0.33) and its rotated
 * half-width (0.284 / 0.43) — NOT tuned by trial. The builder divides the
 * spec ratio by it so the table above states measured proportions.
 */
inline constexpr float SpreadNormal = 1.2442f;
inline constexpr float SpreadBigArms = 1.2000f;

inline EnemySpec SpecFor(ob::cfg::EnemyKind k) {
	using EK = ob::cfg::EnemyKind;
	switch (k) {
		// SHRIKE: thin, forward-leaning, ALL LEGS. Reverse joint, no back
		// units, twin blades, low-profile pack.
		case EK::AcLight:  return { 9.40f, 1.02f, 3.40f, 0.64f, 3.10f, 1.10f, 0, true,  false, 1.0f, 0.16f, 1.50f, false };
		// KITE: the baseline duellist, closest to the player's own frame.
		// ONE back unit on the right pylon.
		case EK::AcMid:    return { 10.60f, 1.50f, 3.40f, 0.58f, 4.20f, 1.50f, 1, false, false, 1.0f, 0.04f, 1.70f, false };
		// BULWARK: tetrapod. NO WAIST PINCH is the identity — the ratio is
		// deliberately far below 3.4 — plus enormous shoulder cannons.
		case EK::AcHeavy:  return { 8.60f, 2.90f, 2.25f, 0.46f, 6.40f, 2.00f, 0, false, true,  1.0f, 0.0f,  1.20f, true  };
		// NIGHTJAR: taller and sleeker than all of them. Four back units,
		// reverse joint, violet optic. Same CLASS, obviously the best of them.
		case EK::Boss:     return { 12.40f, 1.46f, 3.85f, 0.60f, 4.40f, 1.46f, 4, true,  false, 2.0f, 0.06f, 1.90f, false };
		// MT: neglected industrial plant. Boxy, squat, barely a waist.
		default:           return { 6.80f, 2.10f, 1.75f, 0.44f, 3.40f, 1.70f, 0, false, false, 1.0f, 0.0f,  1.05f, false };
	}
}

}  // namespace detail

inline void BuildEnemy(Frame& out, ob::cfg::EnemyKind kind) {
	using EK = ob::cfg::EnemyKind;
	out = Frame{};
	const detail::EnemySpec S = detail::SpecFor(kind);
	const bool isAC = ob::cfg::Enemy(kind).isAC;

	out.designHeight = S.height;
	out.accentHue = S.accentHue;
	out.reverseJoint = S.reverseJoint;
	out.tetrapod = S.tetrapod;
	out.backUnits = S.backUnits;

	const float H = S.height;
	const float hipY = H * S.legFrac;
	const float waistH = H * 0.075f;

	// Core height is SOLVED so the top of the head lands exactly on the design
	// height, instead of being a fraction that happens to land near it. An AC's
	// sensor spike reaches 2.25 head-heights above the head node; an MT's
	// cockpit box only 1.40. With head = core / 7 that gives
	//     H = hipY + waistH + core + tipMul * core / 7
	// which is one line to invert and removes a whole class of "the frame came
	// out 0.6 m short and nobody noticed" from the roster.
	const float headTipMul = isAC ? 2.25f : 1.40f;
	const float coreH = (H - hipY - waistH) / (1.0f + headTipMul / 7.0f);
	const float headH = coreH / 7.0f;

	// See SpreadNormal / SpreadBigArms: S.shoulderRatio is the ratio the frame
	// must MEASURE, so the construction offset is that ratio divided by how far
	// the shoulder cluster actually reaches.
	const float spread = S.bigArms ? detail::SpreadBigArms : detail::SpreadNormal;
	const float shoulderHalf = S.waist * S.shoulderRatio / (2.0f * spread);

	const float kneeY = hipY * (S.tetrapod ? 0.44f : 0.60f);
	const float ankleY = H * 0.085f;

	out.Place(Node::Root, 0.0f, 0.0f, 0.0f);
	out.Place(Node::Hips, 0.0f, hipY, 0.0f);
	out.Place(Node::Core, 0.0f, waistH, 0.0f);
	out.Place(Node::Head, 0.0f, coreH, -0.06f);
	out.Place(Node::YokeL, -shoulderHalf * 0.44f, coreH * 0.76f, 0.02f);
	out.Place(Node::YokeR, shoulderHalf * 0.44f, coreH * 0.76f, 0.02f);
	out.Place(Node::ArmL, -shoulderHalf * 0.26f, -coreH * 0.13f, 0.0f);
	out.Place(Node::ArmR, shoulderHalf * 0.26f, -coreH * 0.13f, 0.0f);
	// The hip PIVOT hangs below the hip STATION — the ball joint sits under the
	// pelvis, it is not the pelvis. Every station below the pivot is therefore
	// quoted against the pivot, not against hipY. Quoting them against hipY
	// leaves the whole leg short by exactly that drop, which lands the sole
	// BELOW the deck and inflates the measured height of every hostile by the
	// same amount — a fault that is invisible in a part list and obvious in a
	// height measurement.
	const float hipDrop = waistH * 0.4f;
	const float hipPivotY = hipY - hipDrop;
	out.Place(Node::ThighL, -S.footSpan * 0.26f, -hipDrop, S.tetrapod ? -0.5f : 0.0f);
	out.Place(Node::ThighR, S.footSpan * 0.26f, -hipDrop, S.tetrapod ? -0.5f : 0.0f);
	out.Place(Node::ShinL, 0.0f, kneeY - hipPivotY, S.reverseJoint ? -0.34f : 0.14f);
	out.Place(Node::ShinR, 0.0f, kneeY - hipPivotY, S.reverseJoint ? -0.34f : 0.14f);
	out.Place(Node::FootL, 0.0f, ankleY - kneeY, S.reverseJoint ? 0.46f : -0.12f);
	out.Place(Node::FootR, 0.0f, ankleY - kneeY, S.reverseJoint ? 0.46f : -0.12f);
	if (S.tetrapod) {
		out.Place(Node::ThighBL, -S.footSpan * 0.30f, -hipDrop, 1.30f);
		out.Place(Node::ThighBR, S.footSpan * 0.30f, -hipDrop, 1.30f);
		out.Place(Node::ShinBL, 0.0f, kneeY - hipPivotY, 0.30f);
		out.Place(Node::ShinBR, 0.0f, kneeY - hipPivotY, 0.30f);
	}
	if (S.backUnits > 0) {
		out.Place(Node::BackL, -shoulderHalf * 0.38f, coreH * 0.86f, S.coreDepth * 0.78f);
		out.Place(Node::BackR, shoulderHalf * 0.38f, coreH * 0.86f, S.coreDepth * 0.78f);
	}

	detail::Pen K(&out);

	// ---- waist ----
	K.At(Node::Hips);
	K.Plate(Mat::Frame, 0.0f, waistH * 0.5f, 0.0f, S.waist, waistH, S.waist * 0.86f);
	K.Ring(Mat::Steel, 0.0f, waistH * 0.14f, 0.0f, S.waist * 0.80f, 0.11f);
	// As on the player frame: every piece of hip hardware hangs BELOW the hip
	// station, so the waist band carries the column alone and the measured
	// shoulder-to-waist ratio is the ratio the spec asked for.
	K.Plate(Mat::Hull, 0.0f, -0.52f, -S.coreDepth * 0.52f, S.waist * 0.90f, 0.86f, 0.28f).rx = 0.15f;
	for (int i = 0; i < 2; ++i) {
		const float s = (i == 0) ? -1.0f : 1.0f;
		K.Taper(Mat::Hull, s * S.footSpan * 0.24f, -0.58f, 0.04f, 0.32f, 1.02f, S.coreDepth * 0.80f, 0.28f, S.coreDepth * 0.58f).rz = s * 0.11f;
		K.Joint(s * S.footSpan * 0.26f, -hipDrop - 0.14f, 0.0f, 0.58f, 0.62f, -0.26f, static_cast<int>(s), -1);
		if (isAC) K.Nozzle(s * S.waist * 0.72f, -0.30f, S.coreDepth * 0.52f, 0.16f, 0.26f, 0.24f).rx = ob::PI * 0.5f;
	}

	// ---- core ----
	K.At(Node::Core);
	K.Plate(Mat::Frame, 0.0f, coreH * 0.46f, 0.06f, shoulderHalf * 0.92f, coreH * 0.72f, S.coreDepth).rx = S.leanZ;
	K.Taper(Mat::Hull, 0.0f, coreH * 0.54f, -S.coreDepth * 0.52f,
	        shoulderHalf * 0.72f, coreH * 0.52f, 0.36f, shoulderHalf * 0.98f, 0.40f).rx = -0.12f + S.leanZ;
	K.Vent(Mat::Hull3, 0.0f, coreH * 0.52f, -S.coreDepth * 0.64f, shoulderHalf * 0.40f, coreH * 0.20f, 0.14f);
	K.Plate(Mat::Hull3, 0.0f, coreH * 0.76f, 0.08f, shoulderHalf * 1.02f, coreH * 0.15f, S.coreDepth * 0.96f);  // yoke deck
	K.Plate(Mat::Hull3, 0.0f, coreH * 0.40f, S.coreDepth * 0.58f, shoulderHalf * 0.86f, coreH * 0.66f, 0.34f);
	// booster pack: SHRIKE gets a LOW-PROFILE one, everything else a block
	if (S.backUnits == 0 && kind == EK::AcLight) {
		K.Plate(Mat::Hull2, 0.0f, coreH * 0.60f, S.coreDepth * 0.74f, shoulderHalf * 0.70f, coreH * 0.26f, 0.42f);
		for (int i = 0; i < 2; ++i) {
			const float s = (i == 0) ? -1.0f : 1.0f;
			K.Nozzle(s * shoulderHalf * 0.30f, coreH * 0.52f, S.coreDepth * 0.94f, 0.28f, 0.46f, 0.36f).rx = ob::PI * 0.5f - 0.3f;
			K.Core(s * shoulderHalf * 0.30f, coreH * 0.48f, S.coreDepth * 1.02f, 0.26f).rx = ob::PI * 0.5f - 0.3f;
		}
	} else {
		K.Plate(Mat::Hull3, 0.0f, coreH * 0.34f, S.coreDepth * 0.82f, shoulderHalf * 0.78f, coreH * 0.50f, 0.62f);
		for (int i = 0; i < 2; ++i) {
			const float s = (i == 0) ? -1.0f : 1.0f;
			K.Nozzle(s * shoulderHalf * 0.28f, coreH * 0.20f, S.coreDepth * 1.06f, 0.34f, 0.56f, 0.42f).rx = ob::PI * 0.5f - 0.32f;
			K.Core(s * shoulderHalf * 0.28f, coreH * 0.15f, S.coreDepth * 1.14f, 0.30f).rx = ob::PI * 0.5f - 0.32f;
		}
	}
	out.Socketed(SocketId::ThrMainL, Node::Core, -shoulderHalf * 0.28f, coreH * 0.18f, S.coreDepth * 1.12f, 0.0f, -0.32f, 0.95f, 0.28f);
	out.Socketed(SocketId::ThrMainR, Node::Core, shoulderHalf * 0.28f, coreH * 0.18f, S.coreDepth * 1.12f, 0.0f, -0.32f, 0.95f, 0.28f);

	// ---- head ----
	K.At(Node::Head);
	if (isAC) {
		K.Taper(Mat::Hull, 0.0f, headH * 0.5f, -0.04f, headH * 1.9f, headH, headH * 1.8f, headH * 1.5f, headH * 1.4f);
		K.Plate(Mat::Frame, 0.0f, headH * 0.5f, -headH * 0.9f, headH * 1.6f, headH * 0.5f, 0.10f).rx = -0.16f;
		K.Plate(Mat::Accent, 0.0f, headH * 0.5f, -headH * 1.0f, headH * 1.3f, headH * 0.22f, 0.05f).rx = -0.16f;
		K.Rod(Mat::Steel, -headH * 0.7f, headH * 1.5f, 0.16f, 0.05f, headH * 1.5f).rz = 0.14f;
		out.Socketed(SocketId::Optic, Node::Head, 0.0f, headH * 0.5f, -headH * 1.05f, 0.0f, 0.0f, -1.0f, headH * 0.65f);
	} else {
		// MT: a bolted cockpit box with a slit, not an AC head. Beaten up.
		K.Plate(Mat::Hull4, 0.0f, headH * 0.7f, -0.10f, headH * 2.6f, headH * 1.4f, headH * 2.2f);
		K.Plate(Mat::Frame, 0.0f, headH * 0.8f, -headH * 1.2f, headH * 2.2f, headH * 0.5f, 0.10f);
		K.Plate(Mat::Accent, 0.0f, headH * 0.8f, -headH * 1.3f, headH * 1.6f, headH * 0.2f, 0.05f);
		out.Socketed(SocketId::Optic, Node::Head, 0.0f, headH * 0.8f, -headH * 1.3f, 0.0f, 0.0f, -1.0f, headH * 0.8f);
	}

	// ---- shoulders + arms ----
	for (int i = 0; i < 2; ++i) {
		const float s = (i == 0) ? -1.0f : 1.0f;
		K.At(i == 0 ? Node::YokeL : Node::YokeR);
		K.Ring(Mat::Frame, 0.0f, 0.0f, 0.0f, 0.72f, 0.18f).rz = ob::PI * 0.5f;
		K.Boss(s * 0.14f, 0.0f, 0.0f, 0.44f, 0.14f).rz = ob::PI * 0.5f;
		K.Rod(Mat::Steel, s * 0.26f, -0.24f, -0.22f, 0.11f, 0.54f).rx = 0.30f;
		if (S.bigArms) {
			// BULWARK: enormous shoulder cannons. The silhouette IS these.
			K.Plate(Mat::Hull, s * shoulderHalf * 0.33f, 0.44f, -0.10f, shoulderHalf * 0.86f, 1.36f, 2.30f);
			K.Taper(Mat::Hull3, s * shoulderHalf * 0.33f, 0.52f, -1.70f, 0.72f, 1.90f, 0.74f, 0.52f, 0.54f).rx = ob::PI * 0.5f;
			K.Rod(Mat::Steel, s * shoulderHalf * 0.33f, 0.52f, -2.90f, 0.34f, 1.10f).rx = ob::PI * 0.5f;
			K.Ring(Mat::Steel, s * shoulderHalf * 0.33f, 0.52f, -2.40f, 0.62f, 0.12f).rx = ob::PI * 0.5f;
		} else {
			K.Wedge(Mat::Hull, s * shoulderHalf * 0.42f, 0.34f, -0.20f, shoulderHalf * 0.74f, 0.86f, S.coreDepth * 1.02f).rz = -s * 0.16f;
			K.Taper(Mat::Hull2, s * shoulderHalf * 0.52f, 0.0f, 0.24f, shoulderHalf * 0.58f, 0.80f, S.coreDepth * 0.84f, shoulderHalf * 0.40f, 0.86f).rz = -s * 0.20f;
			K.Vent(Mat::Hull3, s * shoulderHalf * 0.58f, -0.14f, -0.46f, 0.40f, 0.30f, 0.12f);
		}

		K.At(i == 0 ? Node::ArmL : Node::ArmR);
		K.Taper(Mat::Hull, 0.0f, -S.armLength * 0.30f, 0.0f, 0.64f, S.armLength * 0.58f, 0.66f, 0.54f, 0.56f);
		K.Joint(0.0f, -S.armLength * 0.60f, 0.0f, 0.40f, 0.46f, -0.20f, static_cast<int>(s));
		K.Taper(Mat::Hull2, 0.0f, -S.armLength * 0.90f, -0.04f, 0.58f, S.armLength * 0.58f, 0.62f, 0.46f, 0.48f);
	}

	// ---- weapons by roster row ----
	if (kind == EK::AcLight) {
		// twin pulse blades, one per arm
		for (int i = 0; i < 2; ++i) {
			K.At(i == 0 ? Node::ArmL : Node::ArmR);
			K.Wedge(Mat::Hull3, 0.0f, -S.armLength * 1.12f, -0.52f, 0.26f, 0.40f, 0.86f);
			K.Core(0.0f, -S.armLength * 1.12f, -1.02f, 0.15f).rx = ob::PI * 0.5f;
			out.Socketed(i == 0 ? SocketId::MuzzleLArm : SocketId::MuzzleRArm,
			             i == 0 ? Node::ArmL : Node::ArmR,
			             0.0f, -S.armLength * 1.12f, -1.10f, 0.0f, 0.0f, -1.0f, 0.10f);
		}
	} else {
		// rifle on the right arm for everything else
		K.At(Node::ArmR);
		K.Plate(Mat::Frame, 0.14f, -S.armLength * 1.08f, -0.62f, 0.36f, 0.40f, 1.12f);
		K.Taper(Mat::Hull3, 0.14f, -S.armLength * 1.08f, -1.36f, 0.30f, 0.98f, 0.32f, 0.24f, 0.24f).rx = ob::PI * 0.5f;
		K.Rod(Mat::Steel, 0.14f, -S.armLength * 1.08f, -1.86f, 0.13f, 0.60f).rx = ob::PI * 0.5f;
		out.Socketed(SocketId::MuzzleRArm, Node::ArmR, 0.14f, -S.armLength * 1.08f, -2.14f, 0.0f, 0.0f, -1.0f, 0.08f);
	}

	// ---- back units on pylons, with daylight under them ----
	for (int u = 0; u < S.backUnits && u < 4; ++u) {
		const bool right = (u % 2) == 0;
		const Node n = right ? Node::BackR : Node::BackL;
		const float s = right ? 1.0f : -1.0f;
		const float tier = static_cast<float>(u / 2) * 0.74f;
		K.At(n);
		K.Rod(Mat::Frame, -s * 0.22f, -0.30f + tier, -0.14f, 0.24f, 0.78f).rz = -s * 0.32f;
		K.Plate(Mat::Hull, s * 0.26f, 0.24f + tier, 0.0f, 0.76f, 0.80f, 1.20f).rz = -s * 0.12f;
		K.Plate(Mat::Hull3, s * 0.26f, 0.64f + tier, 0.0f, 0.68f, 0.10f, 1.10f).rz = -s * 0.12f;
		for (int c = 0; c < 4; ++c) {
			const float cx = s * 0.26f + ((c % 2 == 0) ? -0.15f : 0.15f);
			const float cz = -0.32f + static_cast<float>(c / 2) * 0.44f;
			K.Nozzle(cx, 0.62f + tier, cz, 0.13f, 0.17f, 0.22f);
		}
		if (u == 0) out.Socketed(SocketId::MuzzleRBack, n, s * 0.26f, 0.74f, 0.0f, 0.0f, 1.0f, 0.0f, 0.15f);
		if (u == 1) out.Socketed(SocketId::MuzzleLBack, n, s * 0.26f, 0.74f, 0.0f, 0.0f, 1.0f, 0.0f, 0.15f);
	}

	// ---- legs ----
	const int legPairs = S.tetrapod ? 2 : 1;
	for (int pair = 0; pair < legPairs; ++pair) {
		for (int i = 0; i < 2; ++i) {
			const float s = (i == 0) ? -1.0f : 1.0f;
			const Node thigh = pair == 0 ? (i == 0 ? Node::ThighL : Node::ThighR)
			                             : (i == 0 ? Node::ThighBL : Node::ThighBR);
			const Node shin = pair == 0 ? (i == 0 ? Node::ShinL : Node::ShinR)
			                            : (i == 0 ? Node::ShinBL : Node::ShinBR);
			const float thighLen = hipY - kneeY;
			const float shinLen = kneeY - ankleY;

			K.At(thigh);
			K.Taper(Mat::Hull, 0.0f, -thighLen * 0.5f, 0.0f, 0.96f, thighLen, 1.14f, 0.78f, 0.90f);
			K.Plate(Mat::Hull2, s * 0.44f, -thighLen * 0.55f, 0.06f, 0.18f, thighLen * 0.66f, 0.90f).rz = -s * 0.05f;
			K.Rod(Mat::Frame2, s * 0.30f, -thighLen * 0.62f, 0.54f, 0.09f, thighLen * 0.62f);
			K.Rod(Mat::Steel, s * 0.14f, -thighLen * 0.70f, 0.46f, 0.12f, thighLen * 0.54f);

			K.At(shin);
			// reverse joint: the knee cap points BACK and the shin rakes forward
			K.Wedge(Mat::Hull, 0.0f, 0.08f, S.reverseJoint ? 0.40f : -0.38f, 0.88f, 0.70f, 0.78f)
				.rx = S.reverseJoint ? 0.16f : -0.10f;
			K.Joint(0.0f, 0.0f, 0.08f, 0.60f, 0.58f, S.reverseJoint ? -0.30f : 0.30f, static_cast<int>(s));
			K.Plate(Mat::Frame, 0.0f, -shinLen * 0.5f, 0.04f, 0.50f, shinLen * 0.90f, 0.54f);
			K.Taper(Mat::Hull2, 0.0f, -shinLen * 0.44f, -0.22f, 0.78f, shinLen * 0.68f, 0.66f, 0.64f, 0.54f)
				.rx = S.reverseJoint ? -0.20f : 0.0f;
			K.Plate(Mat::Hull3, s * 0.38f, -shinLen * 0.56f, 0.04f, 0.14f, shinLen * 0.56f, 0.60f);
			if (isAC) K.Nozzle(s * 0.42f, -shinLen * 0.36f, 0.40f, 0.12f, 0.18f, 0.18f).rx = ob::PI * 0.5f;
			K.Rod(Mat::Steel, s * 0.20f, -shinLen * 0.66f, 0.36f, 0.10f, shinLen * 0.46f);

			if (pair == 0) {
				K.At(i == 0 ? Node::FootL : Node::FootR);
				K.Boot(0.0f, -0.06f, 0.0f, 0.46f, 0.40f);
				K.Boss(s * 0.24f, -0.06f, 0.0f, 0.30f, 0.09f).rz = ob::PI * 0.5f;
				K.Plate(Mat::Hull, 0.0f, -0.44f, -0.10f, S.footSpan * 0.30f, 0.28f, S.footSpan * 0.48f);
				K.Wedge(Mat::Hull2, 0.0f, -0.30f, -S.footSpan * 0.26f, S.footSpan * 0.24f, 0.30f, 0.52f).rx = -0.24f;
				K.Plate(Mat::Hull3, 0.0f, -0.32f, S.footSpan * 0.20f, 0.62f, 0.36f, 0.56f).rx = 0.32f;
			}
		}
	}
}

inline void BuildFrame(Frame& out, ob::cfg::EnemyKind kind, bool player) {
	if (player) BuildPlayer(out);
	else BuildEnemy(out, kind);
}

}  // namespace obrig
