import { Sun, Moon, CloudRain, CloudFog, Eye, Car, Video, TriangleAlert, Gamepad2, Volume2, VolumeX } from "lucide-react";
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
            style={isActive ? { background: "#262723", borderColor: "#3f403f" } : undefined}
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
  const audioMuted = useStore((s) => s.audioMuted);
  const toggleAudioMuted = useStore((s) => s.toggleAudioMuted);

  return (
    <>
      <div
        className="absolute top-4 right-4 z-30 rounded-xl border border-ink-600/70 px-2.5 py-2 flex items-center gap-2.5 bg-ink-850 shadow-panel"
      >
        <IconToggleRow options={WEATHER_OPTIONS} active={weatherPreset} onSelect={setWeatherPreset} />
        <div className="h-5 w-px bg-white/10" />
        <IconToggleRow options={CAMERA_OPTIONS} active={cameraPreset} onSelect={setCameraPreset} />
        <div className="h-5 w-px bg-white/10" />
        <button
          onClick={toggleAudioMuted}
          title={audioMuted ? "Unmute ambience" : "Mute ambience"}
          className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-all ${
            audioMuted ? "text-ink-400 border-transparent hover:text-white hover:bg-white/5" : "text-brand"
          }`}
          style={!audioMuted ? { background: "#262723", borderColor: "#3f403f" } : undefined}
        >
          {audioMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
      </div>

      {/* Confirms the mode actually switched (the icon alone is easy to miss)
          and surfaces the controls, which have no other on-screen hint. */}
      {cameraPreset === "free_fly" && (
        <div
          className="absolute top-16 right-4 z-30 rounded-lg border border-brand/40 px-3 py-1.5 mono text-2xs text-brand bg-ink-850 shadow-panel"
        >
          Free Cam — click to look around (Esc to release) · WASD move · Shift boost · Space/Q up-down
        </div>
      )}
    </>
  );
}
