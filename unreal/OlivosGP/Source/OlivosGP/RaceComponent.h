#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "RaceComponent.generated.h"

class ACesiumGeoreference;

/**
 * Checkpoint race logic, ported from the web build's track.js.
 * Reads Content/Data/olivos.json (baked from OSM by tools/bake_map.py),
 * converts the circuit's lat/lon path into engine space through the level's
 * CesiumGeoreference, and tracks checkpoint/lap/timing progress for the owner.
 */
UCLASS(ClassGroup = (Custom), meta = (BlueprintSpawnableComponent))
class OLIVOSGP_API URaceComponent : public UActorComponent
{
    GENERATED_BODY()

public:
    URaceComponent();

    virtual void BeginPlay() override;
    virtual void TickComponent(float DeltaTime, ELevelTick TickType,
                               FActorComponentTickFunction* ThisTickFunction) override;

    UPROPERTY(EditAnywhere, Category = "Race") FString TrackId = TEXT("quinta-de-olivos");
    UPROPERTY(EditAnywhere, Category = "Race") float CheckpointSpacing = 15000.f; // cm
    UPROPERTY(EditAnywhere, Category = "Race") float CheckpointRadius = 1600.f;   // cm

    UFUNCTION(BlueprintCallable, Category = "Race") void StartRace();

    UPROPERTY(BlueprintReadOnly, Category = "Race") int32 Lap = 0;
    UPROPERTY(BlueprintReadOnly, Category = "Race") int32 TotalLaps = 3;
    UPROPERTY(BlueprintReadOnly, Category = "Race") int32 NextCheckpoint = 0;
    UPROPERTY(BlueprintReadOnly, Category = "Race") bool bRacing = false;
    UPROPERTY(BlueprintReadOnly, Category = "Race") bool bFinished = false;
    UPROPERTY(BlueprintReadOnly, Category = "Race") float RaceTime = 0.f;

    // world-space checkpoint centers (built after georeference is available)
    TArray<FVector> Checkpoints;

    FTransform GetSpawnTransform(int32 GridIndex) const;

private:
    bool BuildTrack();
    ACesiumGeoreference* FindGeoreference() const;
    bool bTrackBuilt = false;
};
