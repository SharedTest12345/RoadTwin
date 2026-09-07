import { Sun, Moon, CloudRain, CloudFog, Eye, Car, Video, TriangleAlert, Gamepad2 } from "lucide-react";
import { useStore } from "../../state/store";
import type { WeatherPreset, CameraPreset } from "../../state/store";

const WEATHER_OPTIONS: { id: WeatherPreset; icon: typeof Sun; label: string }[] = [
  { id: "clear_day", icon: Sun, label: "Clear Day" },
  { id: "night", icon: Moon, label: "Night" },
  { id: "rain", icon: CloudRain, label: "Rain" },
  { id: "fog", icon: CloudFog, label: "Fog" },
];

const CAMERA_OPTIONS: { id: CameraPreset; icon: typeof Eye; label: string }[] = [
  { id: "overview", icon: Eye, label: "Overview" },
  { id: "driver_pov", icon: Car, label: "Driver POV" },
  { id: "cctv", icon: Video, label: "CCTV Overlook" },
  { id: "hazard_inspect", icon: TriangleAlert, label: "Hazard Inspect" },
  { id: "free_fly", icon: Gamepad2, label: "Free Cam (WASD + drag to look)" },
];

function IconToggleRow<T extends string>({
  options, active, onSelect,
}: {
  options: { id: T; icon: typeof Sun; label: string }[];
  active: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {options.map((o) => {
        const Icon = o.icon;
        const isActive = o.id === active;
        return (
          <button
            key={o.id}
            onClick={() => onSelect(o.id)}
            title={o.label}
            className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-all ${
              isActive
                ? "text-brand"
                : "text-ink-400 border-transparent hover:text-white hover:bg-white/5"
            }`}
            style={isActive ? {
              background: "linear-gradient(135deg, rgba(0,240,255,0.2) 0%, rgba(0,112,243,0.25) 100%)",
              borderColor: "rgba(0,240,255,0.4)", boxShadow: "0 0 10px rgba(0,240,255,0.25)",
            } : undefined}
          >
            <Icon size={15} />
          </button>
        );
      })}
    </div>
  );
}

/** Floating HUD in the twin workspace's free top-right corner (TwinHeader
 * owns top-left, PlaybackDock owns bottom-center) — switches the scene's
 * atmosphere (real lighting/sky/fog changes, see Scene.tsx's WEATHER table)
 * and the camera's framing preset (see CameraRig.tsx). */
export function AtmosphereDock() {
  const weatherPreset = useStore((s) => s.weatherPreset);
  const setWeatherPreset = useStore((s) => s.setWeatherPreset);
  const cameraPreset = useStore((s) => s.cameraPreset);
  const setCameraPreset = useStore((s) => s.setCameraPreset);

  return (
    <>
      <div
        className="absolute top-4 right-4 z-30 rounded-xl border border-white/10 px-2.5 py-2 flex items-center gap-2.5"
        style={{ background: "rgba(12,18,30,0.78)", backdropFilter: "blur(20px)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}
      >
        <IconToggleRow options={WEATHER_OPTIONS} active={weatherPreset} onSelect={setWeatherPreset} />
        <div className="h-5 w-px bg-white/10" />
        <IconToggleRow options={CAMERA_OPTIONS} active={cameraPreset} onSelect={setCameraPreset} />
      </div>

      {/* Confirms the mode actually switched (the icon alone is easy to miss)
          and surfaces the controls, which have no other on-screen hint. */}
      {cameraPreset === "free_fly" && (
        <div
          className="absolute top-16 right-4 z-30 rounded-lg border border-brand/40 px-3 py-1.5 mono text-2xs text-brand"
          style={{ background: "rgba(12,18,30,0.78)", backdropFilter: "blur(20px)" }}
        >
          Free Cam — click to look around (Esc to release) · WASD move · Shift boost · Space/Q up-down
        </div>
      )}
    </>
  );
}
