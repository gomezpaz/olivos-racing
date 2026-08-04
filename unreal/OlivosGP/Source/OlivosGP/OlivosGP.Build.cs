using UnrealBuildTool;

public class OlivosGP : ModuleRules
{
    public OlivosGP(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "InputCore",
            "EnhancedInput",
            "ChaosVehicles",
            "PhysicsCore",
            "Json",
            "JsonUtilities",
            "CesiumRuntime"
        });
    }
}
