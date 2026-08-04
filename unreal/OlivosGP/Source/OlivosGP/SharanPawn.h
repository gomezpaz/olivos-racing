#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "SharanPawn.generated.h"

class UStaticMeshComponent;
class USpringArmComponent;
class UCameraComponent;
class UInputAction;
class UInputMappingContext;
struct FInputActionValue;

/**
 * 2006 VW Sharan — arcade vehicle pawn.
 * Ported from the proven web build: kinematic bicycle model with lateral grip
 * decay, speed-sensitive steering, and line-trace ground following so it works
 * directly on streamed Cesium / Google Photorealistic 3D Tiles geometry.
 */
UCLASS()
class OLIVOSGP_API ASharanPawn : public APawn
{
    GENERATED_BODY()

public:
    ASharanPawn();

    virtual void Tick(float DeltaSeconds) override;
    virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

    UPROPERTY(VisibleAnywhere, Category = "Vehicle")
    TObjectPtr<UStaticMeshComponent> Body;

    UPROPERTY(VisibleAnywhere, Category = "Vehicle")
    TObjectPtr<USpringArmComponent> CameraArm;

    UPROPERTY(VisibleAnywhere, Category = "Vehicle")
    TObjectPtr<UCameraComponent> Camera;

    // --- tuning (matches the web build's sharan-2006 physics) ---
    UPROPERTY(EditAnywhere, Category = "Vehicle|Tuning") float TopSpeed = 5150.f;      // cm/s (~185 km/h)
    UPROPERTY(EditAnywhere, Category = "Vehicle|Tuning") float Accel = 620.f;          // cm/s^2
    UPROPERTY(EditAnywhere, Category = "Vehicle|Tuning") float BrakeDecel = 1150.f;
    UPROPERTY(EditAnywhere, Category = "Vehicle|Tuning") float ReverseSpeed = 800.f;
    UPROPERTY(EditAnywhere, Category = "Vehicle|Tuning") float Grip = 7.5f;            // 1/s lateral decay
    UPROPERTY(EditAnywhere, Category = "Vehicle|Tuning") float DriftGrip = 2.2f;
    UPROPERTY(EditAnywhere, Category = "Vehicle|Tuning") float SteerMaxDeg = 35.f;
    UPROPERTY(EditAnywhere, Category = "Vehicle|Tuning") float SteerHighSpeedDeg = 5.f;
    UPROPERTY(EditAnywhere, Category = "Vehicle|Tuning") float WheelBase = 280.f;      // cm

    // glTF forward axis vs UE forward axis — tune in editor if the car imports sideways
    UPROPERTY(EditAnywhere, Category = "Vehicle|Mesh") float MeshYawOffsetDeg = -90.f;

protected:
    virtual void BeginPlay() override;

private:
    // input state
    float ThrottleInput = 0.f;
    float BrakeInput = 0.f;
    float SteerInput = 0.f;
    bool bHandbrake = false;

    // simulation state (authoritative on owning client for now)
    FVector Velocity = FVector::ZeroVector; // world cm/s, XY plane
    float SteerAngle = 0.f;                 // degrees
    float GroundZ = 0.f;
    bool bGroundValid = false;

    UPROPERTY() TObjectPtr<UInputAction> ThrottleAction;
    UPROPERTY() TObjectPtr<UInputAction> BrakeAction;
    UPROPERTY() TObjectPtr<UInputAction> SteerAction;
    UPROPERTY() TObjectPtr<UInputAction> HandbrakeAction;
    UPROPERTY() TObjectPtr<UInputMappingContext> MappingContext;

    void BuildInputAssets();
    void OnThrottle(const FInputActionValue& Value);
    void OnBrake(const FInputActionValue& Value);
    void OnSteer(const FInputActionValue& Value);
    void OnHandbrake(const FInputActionValue& Value);
    void OnHandbrakeReleased(const FInputActionValue& Value);

    void SimulateMove(float DeltaSeconds);
    bool TraceGround(const FVector& At, float& OutZ) const;
};
