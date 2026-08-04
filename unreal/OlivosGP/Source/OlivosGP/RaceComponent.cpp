#include "RaceComponent.h"

#include "CesiumGeoreference.h"
#include "Dom/JsonObject.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Actor.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

URaceComponent::URaceComponent()
{
    PrimaryComponentTick.bCanEverTick = true;
}

void URaceComponent::BeginPlay()
{
    Super::BeginPlay();
}

ACesiumGeoreference* URaceComponent::FindGeoreference() const
{
    for (TActorIterator<ACesiumGeoreference> It(GetWorld()); It; ++It)
    {
        return *It;
    }
    return nullptr;
}

bool URaceComponent::BuildTrack()
{
    ACesiumGeoreference* Geo = FindGeoreference();
    if (!Geo)
    {
        return false;
    }

    const FString Path = FPaths::Combine(FPaths::ProjectContentDir(), TEXT("Data/olivos.json"));
    FString Raw;
    if (!FFileHelper::LoadFileToString(Raw, *Path))
    {
        UE_LOG(LogTemp, Error, TEXT("RaceComponent: cannot read %s"), *Path);
        return false;
    }

    TSharedPtr<FJsonObject> Root;
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Raw);
    if (!FJsonSerializer::Deserialize(Reader, Root) || !Root.IsValid())
    {
        UE_LOG(LogTemp, Error, TEXT("RaceComponent: bad json"));
        return false;
    }

    const TArray<TSharedPtr<FJsonValue>>* Tracks;
    if (!Root->TryGetArrayField(TEXT("tracks"), Tracks))
    {
        return false;
    }

    TSharedPtr<FJsonObject> Found;
    for (const TSharedPtr<FJsonValue>& T : *Tracks)
    {
        TSharedPtr<FJsonObject> Obj = T->AsObject();
        if (Obj.IsValid() && Obj->GetStringField(TEXT("id")) == TrackId)
        {
            Found = Obj;
            break;
        }
    }
    if (!Found.IsValid())
    {
        UE_LOG(LogTemp, Error, TEXT("RaceComponent: track '%s' not found"), *TrackId);
        return false;
    }

    TotalLaps = Found->GetIntegerField(TEXT("laps"));
    const TArray<TSharedPtr<FJsonValue>>& PathArr = Found->GetArrayField(TEXT("path"));

    // convert full path, then thin to checkpoints every CheckpointSpacing
    TArray<FVector> WorldPts;
    WorldPts.Reserve(PathArr.Num());
    for (const TSharedPtr<FJsonValue>& P : PathArr)
    {
        const TArray<TSharedPtr<FJsonValue>>& LatLon = P->AsArray();
        const double Lat = LatLon[0]->AsNumber();
        const double Lon = LatLon[1]->AsNumber();
        WorldPts.Add(Geo->TransformLongitudeLatitudeHeightPositionToUnreal(
            FVector(Lon, Lat, 30.0)));
    }

    Checkpoints.Reset();
    float Acc = 0.f;
    for (int32 i = 0; i < WorldPts.Num(); i++)
    {
        const FVector& Prev = WorldPts[(i - 1 + WorldPts.Num()) % WorldPts.Num()];
        Acc += FVector::Dist2D(Prev, WorldPts[i]);
        if (i == 0 || Acc >= CheckpointSpacing)
        {
            Acc = 0.f;
            Checkpoints.Add(WorldPts[i]);
        }
    }

    UE_LOG(LogTemp, Log, TEXT("RaceComponent: %d checkpoints, %d laps"), Checkpoints.Num(), TotalLaps);
    return Checkpoints.Num() > 2;
}

FTransform URaceComponent::GetSpawnTransform(int32 GridIndex) const
{
    if (Checkpoints.Num() < 2)
    {
        return FTransform::Identity;
    }
    const FVector A = Checkpoints[0];
    const FVector B = Checkpoints[1];
    const FVector Fwd = (B - A).GetSafeNormal2D();
    const FVector Side = FVector::CrossProduct(FVector::UpVector, Fwd);
    const int32 Row = GridIndex / 2;
    const float Col = (GridIndex % 2) ? 1.f : -1.f;
    const FVector Pos = A - Fwd * (1200.f + Row * 800.f) + Side * Col * 320.f + FVector(0, 0, 200.f);
    return FTransform(Fwd.Rotation(), Pos);
}

void URaceComponent::StartRace()
{
    if (!bTrackBuilt)
    {
        return;
    }
    Lap = 1;
    NextCheckpoint = 1;
    RaceTime = 0.f;
    bRacing = true;
    bFinished = false;
}

void URaceComponent::TickComponent(float DeltaTime, ELevelTick TickType,
                                   FActorComponentTickFunction* ThisTickFunction)
{
    Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

    if (!bTrackBuilt)
    {
        bTrackBuilt = BuildTrack();
        return;
    }

    if (!bRacing || bFinished)
    {
        return;
    }

    RaceTime += DeltaTime;

    const FVector Pos = GetOwner()->GetActorLocation();
    const FVector& Cp = Checkpoints[NextCheckpoint % Checkpoints.Num()];
    if (FVector::Dist2D(Pos, Cp) < CheckpointRadius)
    {
        NextCheckpoint++;
        if ((NextCheckpoint - 1) % Checkpoints.Num() == 0)
        {
            if (Lap >= TotalLaps)
            {
                bFinished = true;
                bRacing = false;
                if (GEngine)
                {
                    GEngine->AddOnScreenDebugMessage(1, 10.f, FColor::Yellow,
                        FString::Printf(TEXT("FINISH! %.2fs"), RaceTime));
                }
                return;
            }
            Lap++;
        }
    }

    if (GEngine)
    {
        GEngine->AddOnScreenDebugMessage(2, 0.1f, FColor::White,
            FString::Printf(TEXT("Lap %d/%d  CP %d/%d  %.1fs"),
                Lap, TotalLaps, NextCheckpoint % Checkpoints.Num(), Checkpoints.Num(), RaceTime));
    }
}
