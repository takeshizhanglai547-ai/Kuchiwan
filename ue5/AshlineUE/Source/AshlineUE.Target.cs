// ASHLINE — 製品（スタンドアロン実行ファイル）ターゲット。
// エディタ用は AshlineUEEditor.Target.cs。両方が同じ設定を持っていないと
// 「エディタでは動くがパッケージすると壊れる」という一番追いにくい壊れ方をする。
using UnrealBuildTool;
using System.Collections.Generic;

public class AshlineUETarget : TargetRules
{
	public AshlineUETarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;

		// V5 / Unreal5_5 を明示する理由：
		// 既定値はエンジンのバージョンごとに変わる。明示しておかないと、
		// 将来 5.6 で開いた瞬間に暗黙のうちにヘッダの読み込み順が変わり、
		// 「触っていないのにビルドが壊れる」ことになる。
		DefaultBuildSettings = BuildSettingsVersion.V5;
		// Latest にしておく。Unreal5_5 という名前の列挙子が UE 5.5 に実在するかを
		// この環境で確認できず、初回ビルドを落とす候補になっていたため。
		// Latest はどのバージョンにも存在し、意味も「そのエンジンの最新の並び」で
		// 新規プロジェクトとしては正しい。特定バージョンに固定したくなったときだけ
		// 実機で名前を確かめてから書き換えること。
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;

		ExtraModuleNames.Add("AshlineUE");
	}
}
