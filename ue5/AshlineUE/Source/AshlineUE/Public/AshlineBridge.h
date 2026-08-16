// =============================================================================
// AshlineBridge.h — コア（メートル/Y-up/three-style yaw）と Unreal（cm/Z-up/左手系）
//                   の間の座標・単位変換。変換をしてよい場所はこのファイルだけ。
//
// なぜ一箇所に閉じ込めるのか
//   単位や軸の変換は、散らばった瞬間に「どこかで2回かかっている」「どこかで
//   かかっていない」が起き、症状は必ず遠くに出る（弾が当たらない、カメラが
//   90度ずれる、敵が壁にめり込む）。原因の場所と症状の場所が離れるバグは、
//   規模が大きくなるほど直せなくなる。だから入口と出口を1つにする。
//
// 絶対にやってはいけないこと
//   ・AshlineCore の中に cm や Z-up を持ち込む
//   ・この関数を通さずに *100 や /100 を手書きする
//   ・「ここだけ符号を反転させれば直る」という直し方をする
//     （下の導出に戻って、どこが食い違っているのかを特定すること）
// =============================================================================
#pragma once

#include "CoreMinimal.h"

/* -----------------------------------------------------------------------------
   座標系の定義（両方とも「事実」であって、選択の余地はない）

   コア（three.js 由来）
     単位   : メートル
     軸     : +X = 右, +Y = 上, +Z = 手前（右手系）
     yaw y  : 前方向 = (-sin y, 0, -cos y)
              → yaw 0 のとき前は (0,0,-1) すなわち -Z
              → yaw が増えると前方向は -Z から -X へ回る = 左を向く

   Unreal
     単位   : センチメートル
     軸     : +X = 前, +Y = 右, +Z = 上（左手系）
     Yaw    : 度。FRotator(0,Yaw,0).Vector() = (cos Yaw, sin Yaw, 0)
              → Yaw 0 のとき前は +X
              → Yaw が増えると前方向は +X から +Y へ回る = 右を向く
     Pitch  : 度。上を向くと正（Vector() の Z 成分 = sin Pitch）

   ---------------------------------------------------------------------------
   軸の対応をどう決めたか

   決めたい条件は2つだけ。
     (a) コアの「上」は Unreal の「上」であること      → core.y  →  UE.Z
     (b) コアの「前（yaw 0 の向き）」は Unreal の「前」であること
         コアの yaw 0 の前は -Z。Unreal の前は +X。したがって core.-z → UE.+X。
     残った軸は自動的に決まる                          → core.x  →  UE.Y

   まとめると
       UE.X = -core.z
       UE.Y =  core.x
       UE.Z =  core.y

   これで右も一致するか（＝鏡像になっていないか）の確認：
     コアで右手系のまま右方向を求めると
       right = forward × up = (0,0,-1) × (0,1,0) = (+1, 0, 0)   … コアの +X が右
     上の対応で写すと core.x → UE.Y、Unreal の +Y は右。一致する。
     数としての行列式は -1 になるが、これは右手系→左手系の乗り換えなので正しい。
     行列式が +1 になる対応を選ぶと、右手系のまま左手系の座標に書き込むことになり、
     ゲーム全体が鏡像に反転する（左右の乗り出しが逆になる形で必ず露見する）。

   ---------------------------------------------------------------------------
   yaw の式の導出（ここを間違えるとゲーム全体が90度ずれる。暗記せず導出を追うこと）

     1) コアの前方向        : F_core = (-sin y, 0, -cos y)
     2) 上の対応で写す      : F_ue = (-F_core.z, F_core.x, F_core.y)
                                   = ( cos y, -sin y, 0 )
     3) Unreal の前方向の式 : F_ue = ( cos Y, sin Y, 0 )        （Y は度→ラジアン）
     4) 2 と 3 を突き合わせる:  cos Y =  cos y
                                sin Y = -sin y
        両方を同時に満たすのは Y = -y のみ。

                       Yaw_ue[deg] = -yaw_core[rad] * 180/π

     直感での再確認：
       コアは yaw が増えると左を向き、Unreal は Yaw が増えると右を向く。
       回る向きが逆なのだから、符号が反転するのが正しい。
     数値での再確認：
       core yaw = +90°（左を向く）→ 前は (-1,0,0) = コアの -X = コアの左
       式より UE Yaw = -90° → 前は (cos-90, sin-90, 0) = (0,-1,0) = UE の -Y = UE の左
       どちらも「左」。一致。

   pitch は符号が反転しない。理由も導出しておく：
     コアの視線（yaw y, pitch p）  = (-sin y·cos p, sin p, -cos y·cos p)
     上の対応で写すと              = ( cos y·cos p, -sin y·cos p, sin p )
     Unreal の視線 (Pitch P, Yaw Y)= ( cos P·cos Y, cos P·sin Y, sin P )
     Y = -y を入れて突き合わせると sin P = sin p, cos P = cos p → P = p。
     yaw だけが反転し pitch は素通し、という非対称は覚えにくいが、
     これは「上下方向の軸（core.y → UE.Z）は反転させていない」ことの帰結である。
   --------------------------------------------------------------------------- */

struct FAshlineBridge
{
	/** メートル → センチメートル。UEの長さは全部これを掛けたもの。 */
	static constexpr float MetresToUE = 100.0f;
	/** センチメートル → メートル。 */
	static constexpr float UEToMetres = 0.01f;

	/** 位置：コア(m, Y-up) → Unreal(cm, Z-up)。 */
	static FVector ToUnreal(float x, float y, float z)
	{
		return FVector(-z * MetresToUE, x * MetresToUE, y * MetresToUE);
	}

	/** 位置：Unreal(cm, Z-up) → コア(m, Y-up)。ToUnreal の完全な逆。 */
	static void FromUnreal(const FVector& V, float& x, float& y, float& z)
	{
		x = V.Y * UEToMetres;
		y = V.Z * UEToMetres;
		z = -V.X * UEToMetres;
	}

	/**
	 * 方向ベクトル：コア → Unreal。
	 * 長さの単位が無い量（正規化された向き、速度の向きなど）に使う。
	 * 位置用の ToUnreal をそのまま向きに流用すると 100 倍された向きが出てきて、
	 * 正規化を忘れた場所で静かに壊れるので、意図を分けて別関数にしてある。
	 */
	static FVector DirToUnreal(float x, float y, float z)
	{
		return FVector(-z, x, y);
	}

	/** ヨー：コア(rad, three-style) → Unreal(deg)。導出は上のコメント。 */
	static float YawToUnreal(float coreYaw)
	{
		return -FMath::RadiansToDegrees(coreYaw);
	}

	/** ヨー：Unreal(deg) → コア(rad)。YawToUnreal の逆。 */
	static float YawFromUnreal(float ueYaw)
	{
		return -FMath::DegreesToRadians(ueYaw);
	}

	/** ピッチ：コア(rad) → Unreal(deg)。符号は反転しない（導出は上のコメント）。 */
	static float PitchToUnreal(float corePitch)
	{
		return FMath::RadiansToDegrees(corePitch);
	}

	/** ピッチ：Unreal(deg) → コア(rad)。 */
	static float PitchFromUnreal(float uePitch)
	{
		return FMath::DegreesToRadians(uePitch);
	}

	/** 視線の姿勢をまとめて FRotator にする（ロールは常に0）。 */
	static FRotator RotatorFromCore(float coreYaw, float corePitch)
	{
		return FRotator(PitchToUnreal(corePitch), YawToUnreal(coreYaw), 0.0f);
	}

	/**
	 * 画角：コア(three.js の PerspectiveCamera.fov = 垂直画角) → Unreal。
	 *
	 * ここは軸や単位と同じくらい間違えやすい割に、間違えても「なんとなく広い/狭い」
	 * としか見えないので気づきにくい。
	 *   three.js の fov は【垂直】画角
	 *   UCameraComponent::FieldOfView は【水平】画角
	 * したがって画面のアスペクト比 A (= 幅/高さ) を使って
	 *     水平 = 2·atan( tan(垂直/2) · A )
	 * を通す必要がある。16:9 の場合、垂直65度は水平約97.1度になる。
	 * 単純に 65 をそのまま入れると、実際にはかなり狭い絵になる。
	 */
	static float FovToUnreal(float coreVerticalFovDeg, float AspectRatio)
	{
		const float SafeAspect = (AspectRatio > KINDA_SMALL_NUMBER) ? AspectRatio : (16.0f / 9.0f);
		const float HalfV = FMath::DegreesToRadians(FMath::Clamp(coreVerticalFovDeg, 1.0f, 170.0f)) * 0.5f;
		const float HalfH = FMath::Atan(FMath::Tan(HalfV) * SafeAspect);
		return FMath::RadiansToDegrees(HalfH) * 2.0f;
	}
};
