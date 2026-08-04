using UnrealBuildTool;
using System.Collections.Generic;

public class OlivosGPEditorTarget : TargetRules
{
    public OlivosGPEditorTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Editor;
        DefaultBuildSettings = BuildSettingsVersion.V5;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("OlivosGP");
    }
}
