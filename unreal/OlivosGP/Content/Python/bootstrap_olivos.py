"""One-shot level bootstrap for Olivos GP (run inside the Unreal editor).

Creates /Game/Maps/Olivos with:
  - CesiumGeoreference at the circuit origin
  - Cesium3DTileset streaming Google Photorealistic 3D Tiles
  - CesiumSunSky (golden hour)
  - PlayerStart at the Circuito Quinta de Olivos start line

Run from the editor's Python console (Window > Output Log > Python):
    import bootstrap_olivos; bootstrap_olivos.run("YOUR_GOOGLE_MAPS_API_KEY")
The key can also come from the GOOGLE_MAPS_API_KEY environment variable.
"""
import json
import os
import unreal

# Circuito Quinta de Olivos start (Libertador y Corrientes) — from the baked
# track data in the web build (tools/bake_map.py output).
ORIGIN = {"lat": -34.517468, "lon": -58.489959, "height": 25.0}
START = {"lat": -34.50838, "lon": -58.47945, "heading_deg": 155.0}

MAP_PATH = "/Game/Maps"
MAP_NAME = "Olivos"


def run(api_key=None):
    api_key = api_key or os.environ.get("GOOGLE_MAPS_API_KEY", "")
    if not api_key:
        unreal.log_error("bootstrap_olivos: pass an API key or set GOOGLE_MAPS_API_KEY")
        return

    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

    if not unreal.EditorAssetLibrary.does_asset_exist(f"{MAP_PATH}/{MAP_NAME}"):
        les.new_level(f"{MAP_PATH}/{MAP_NAME}")
    else:
        les.load_level(f"{MAP_PATH}/{MAP_NAME}")

    # georeference anchored at the circuit
    geo = eas.spawn_actor_from_class(unreal.CesiumGeoreference, unreal.Vector(0, 0, 0))
    geo.set_editor_property("origin_latitude", ORIGIN["lat"])
    geo.set_editor_property("origin_longitude", ORIGIN["lon"])
    geo.set_editor_property("origin_height", ORIGIN["height"])

    # Google Photorealistic 3D Tiles
    tileset = eas.spawn_actor_from_class(unreal.Cesium3DTileset, unreal.Vector(0, 0, 0))
    tileset.set_editor_property("tileset_source", unreal.ETilesetSource.FROM_URL)
    tileset.set_editor_property(
        "url", f"https://tile.googleapis.com/v1/3dtiles/root.json?key={api_key}")
    tileset.set_editor_property("maximum_screen_space_error", 8.0)
    tileset.set_editor_property("enable_fog_culling", True)

    # sky + golden-hour sun
    sunsky = eas.spawn_actor_from_class(unreal.CesiumSunSky, unreal.Vector(0, 0, 0))
    sunsky.set_editor_property("solar_time", 18.6)
    sunsky.set_editor_property("time_zone", -3.0)
    sunsky.set_editor_property("month", 2)
    sunsky.set_editor_property("day", 15)

    # player start on the Libertador start line
    wgs = unreal.Vector(START["lon"], START["lat"], ORIGIN["height"] + 1.0)
    ue_pos = geo.transform_longitude_latitude_height_position_to_unreal(wgs)
    start = eas.spawn_actor_from_class(
        unreal.PlayerStart, unreal.Vector(ue_pos.x, ue_pos.y, ue_pos.z + 150.0))
    start.set_actor_rotation(unreal.Rotator(0.0, 0.0, START["heading_deg"]), False)

    les.save_current_level()
    unreal.log("bootstrap_olivos: level ready — /Game/Maps/Olivos")
