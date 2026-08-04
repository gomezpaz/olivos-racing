#include "SharanPawn.h"

#include "Camera/CameraComponent.h"
#include "Components/StaticMeshComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"
#include "InputAction.h"
#include "InputMappingContext.h"
#include "InputModifiers.h"
#include "RaceComponent.h"
#include "UObject/ConstructorHelpers.h"

ASharanPawn::ASharanPawn()
{
    PrimaryActorTick.bCanEverTick = true;

    Body = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Body"));
    RootComponent = Body;
    Body->SetSimulatePhysics(false);
    Body->SetCollisionEnabled(ECollisionEnabled::QueryOnly);

    // placeholder box until the Sharan glTF is imported (bootstrap script swaps it)
    static ConstructorHelpers::FObjectFinder<UStaticMesh> CubeMesh(TEXT("/Engine/BasicShapes/Cube.Cube"));
    if (CubeMesh.Succeeded())
    {
        Body->SetStaticMesh(CubeMesh.Object);
        Body->SetWorldScale3D(FVector(4.6f, 1.8f, 1.6f));
    }

    CameraArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraArm"));
    CameraArm->SetupAttachment(RootComponent);
    CameraArm->TargetArmLength = 950.f;
    CameraArm->SetRelativeLocation(FVector(0.f, 0.f, 220.f));
    CameraArm->SetRelativeRotation(FRotator(-12.f, 0.f, 0.f));
    CameraArm->bEnableCameraLag = true;
    CameraArm->CameraLagSpeed = 5.f;
    CameraArm->bDoCollisionTest = true; // pulls in when foliage/buildings block

    Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
    Camera->SetupAttachment(CameraArm);
    Camera->FieldOfView = 75.f;

    Race = CreateDefaultSubobject<URaceComponent>(TEXT("Race"));

    bReplicates = true;
    SetReplicateMovement(true);
}

void ASharanPawn::BeginPlay()
{
    Super::BeginPlay();

    // prefer the imported Sharan glb over the placeholder box
    for (const TCHAR* Path : { TEXT("/Game/Vehicles/sharan.sharan"), TEXT("/Game/Vehicles/Sharan.Sharan") })
    {
        if (UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, Path))
        {
            Body->SetStaticMesh(Mesh);
            Body->SetWorldScale3D(FVector(100.f)); // glTF meters -> UE cm
            Body->SetRelativeRotation(FRotator(0.f, MeshYawOffsetDeg, 0.f));
            break;
        }
    }

    BuildInputAssets();

    if (const APlayerController* PC = Cast<APlayerController>(GetController()))
    {
        if (UEnhancedInputLocalPlayerSubsystem* Subsystem =
                ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
        {
            Subsystem->AddMappingContext(MappingContext, 0);
        }
    }
}

void ASharanPawn::BuildInputAssets()
{
    // all input assets are created in code so the project needs zero binary content
    ThrottleAction = NewObject<UInputAction>(this, TEXT("IA_Throttle"));
    ThrottleAction->ValueType = EInputActionValueType::Axis1D;
    BrakeAction = NewObject<UInputAction>(this, TEXT("IA_Brake"));
    BrakeAction->ValueType = EInputActionValueType::Axis1D;
    SteerAction = NewObject<UInputAction>(this, TEXT("IA_Steer"));
    SteerAction->ValueType = EInputActionValueType::Axis1D;
    HandbrakeAction = NewObject<UInputAction>(this, TEXT("IA_Handbrake"));
    HandbrakeAction->ValueType = EInputActionValueType::Boolean;

    MappingContext = NewObject<UInputMappingContext>(this, TEXT("IMC_Driving"));
    MappingContext->MapKey(ThrottleAction, EKeys::W);
    MappingContext->MapKey(ThrottleAction, EKeys::Up);
    MappingContext->MapKey(BrakeAction, EKeys::S);
    MappingContext->MapKey(BrakeAction, EKeys::Down);
    MappingContext->MapKey(SteerAction, EKeys::A);
    MappingContext->MapKey(SteerAction, EKeys::Left);
    FEnhancedActionKeyMapping& SteerRight = MappingContext->MapKey(SteerAction, EKeys::D);
    SteerRight.Modifiers.Add(NewObject<UInputModifierNegate>(MappingContext));
    FEnhancedActionKeyMapping& SteerRightArrow = MappingContext->MapKey(SteerAction, EKeys::Right);
    SteerRightArrow.Modifiers.Add(NewObject<UInputModifierNegate>(MappingContext));
    MappingContext->MapKey(HandbrakeAction, EKeys::SpaceBar);

    StartRaceAction = NewObject<UInputAction>(this, TEXT("IA_StartRace"));
    StartRaceAction->ValueType = EInputActionValueType::Boolean;
    MappingContext->MapKey(StartRaceAction, EKeys::Enter);
}

void ASharanPawn::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);
    if (UEnhancedInputComponent* Input = Cast<UEnhancedInputComponent>(PlayerInputComponent))
    {
        BuildInputAssets();
        Input->BindAction(ThrottleAction, ETriggerEvent::Triggered, this, &ASharanPawn::OnThrottle);
        Input->BindAction(ThrottleAction, ETriggerEvent::Completed, this, &ASharanPawn::OnThrottle);
        Input->BindAction(BrakeAction, ETriggerEvent::Triggered, this, &ASharanPawn::OnBrake);
        Input->BindAction(BrakeAction, ETriggerEvent::Completed, this, &ASharanPawn::OnBrake);
        Input->BindAction(SteerAction, ETriggerEvent::Triggered, this, &ASharanPawn::OnSteer);
        Input->BindAction(SteerAction, ETriggerEvent::Completed, this, &ASharanPawn::OnSteer);
        Input->BindAction(HandbrakeAction, ETriggerEvent::Started, this, &ASharanPawn::OnHandbrake);
        Input->BindAction(HandbrakeAction, ETriggerEvent::Completed, this, &ASharanPawn::OnHandbrakeReleased);
        Input->BindActionValueLambda(StartRaceAction, ETriggerEvent::Started,
            [this](const FInputActionValue&) { if (Race) Race->StartRace(); });
    }
}

void ASharanPawn::OnThrottle(const FInputActionValue& Value) { ThrottleInput = Value.Get<float>(); }
void ASharanPawn::OnBrake(const FInputActionValue& Value) { BrakeInput = Value.Get<float>(); }
void ASharanPawn::OnSteer(const FInputActionValue& Value) { SteerInput = Value.Get<float>(); }
void ASharanPawn::OnHandbrake(const FInputActionValue&) { bHandbrake = true; }
void ASharanPawn::OnHandbrakeReleased(const FInputActionValue&) { bHandbrake = false; }

void ASharanPawn::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    if (IsLocallyControlled())
    {
        SimulateMove(FMath::Min(DeltaSeconds, 0.05f));
    }
}

void ASharanPawn::SimulateMove(float Dt)
{
    const FVector Fwd = GetActorForwardVector();
    float FwdSpeed = FVector::DotProduct(Velocity, Fwd);
    FVector Lateral = Velocity - Fwd * FwdSpeed;

    // steering with speed falloff
    const float SpeedFrac = FMath::Clamp(FMath::Abs(FwdSpeed) / TopSpeed, 0.f, 1.f);
    const float SteerTarget = SteerInput * FMath::Lerp(SteerMaxDeg, SteerHighSpeedDeg, SpeedFrac);
    SteerAngle = FMath::FInterpTo(SteerAngle, SteerTarget, Dt, 6.f);
    if (FMath::Abs(FwdSpeed) > 30.f)
    {
        const float YawRateRad = (FwdSpeed / WheelBase) * FMath::Tan(FMath::DegreesToRadians(SteerAngle));
        AddActorWorldRotation(FRotator(0.f, -FMath::RadiansToDegrees(YawRateRad) * Dt, 0.f));
    }

    // longitudinal
    float AccelSum = 0.f;
    if (ThrottleInput > 0.f)
    {
        AccelSum += ThrottleInput * Accel * (0.35f + 0.65f * (1.f - SpeedFrac));
    }
    if (BrakeInput > 0.f)
    {
        if (FwdSpeed > 50.f) AccelSum -= BrakeInput * BrakeDecel;
        else AccelSum -= BrakeInput * Accel * 0.7f * (1.f - FMath::Clamp(-FwdSpeed / ReverseSpeed, 0.f, 1.f));
    }
    AccelSum -= FwdSpeed * 0.35f * 0.01f * FMath::Abs(FwdSpeed) * 0.018f + FwdSpeed * 0.35f;
    FwdSpeed += AccelSum * Dt;

    // lateral grip
    const float GripNow = bHandbrake ? DriftGrip : Grip;
    Lateral *= FMath::Exp(-GripNow * Dt);
    if (bHandbrake && FMath::Abs(FwdSpeed) > 100.f)
    {
        FwdSpeed *= FMath::Exp(-0.6f * Dt);
    }

    const FVector NewFwd = GetActorForwardVector();
    Velocity = NewFwd * FwdSpeed + Lateral;
    Velocity.Z = 0.f;

    FVector NewLoc = GetActorLocation() + Velocity * Dt;

    // ground follow on streamed tiles
    float Z;
    if (TraceGround(NewLoc, Z))
    {
        GroundZ = bGroundValid ? FMath::FInterpTo(GroundZ, Z, Dt, 12.f) : Z;
        bGroundValid = true;
    }
    NewLoc.Z = GroundZ + 60.f; // half body height
    SetActorLocation(NewLoc, /*bSweep=*/false);
}

bool ASharanPawn::TraceGround(const FVector& At, float& OutZ) const
{
    FHitResult Hit;
    const FVector Start = At + FVector(0, 0, 30000.f);
    const FVector End = At - FVector(0, 0, 30000.f);
    FCollisionQueryParams Params;
    Params.AddIgnoredActor(this);
    if (GetWorld()->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility, Params))
    {
        // prefer continuity with the current ground to avoid tree canopies
        OutZ = Hit.ImpactPoint.Z;
        return true;
    }
    return false;
}
