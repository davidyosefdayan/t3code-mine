// Personal build: Settings → Read aloud. Voice and speed for the button next to Copy.
import { CheckIcon, SquareIcon, Volume2Icon } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import {
  deleteReadAloudModel,
  hasReadAloudModel,
  stopReadAloud,
} from "~/readAloud/readAloudPlayer";
import {
  DEFAULT_READ_ALOUD_SPEED,
  MAX_READ_ALOUD_SPEED,
  MIN_READ_ALOUD_SPEED,
  READ_ALOUD_VOICES,
  type ReadAloudVoice,
  useReadAloudSpeed,
  useReadAloudVoice,
} from "~/readAloud/readAloudSettings";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

// Recorded once with the same model, so picking a voice needs no download.
const VOICE_SAMPLES = import.meta.glob<string>("../../readAloud/previews/*.m4a", {
  eager: true,
  import: "default",
  query: "?url",
});

function voiceSampleUrl(voice: ReadAloudVoice) {
  return VOICE_SAMPLES[`../../readAloud/previews/${voice}.m4a`];
}

/** Plays one voice sample at a time, at the chosen reading speed. */
function useVoiceSample(speed: number) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<ReadAloudVoice | null>(null);

  const stop = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
  };

  const play = (voice: ReadAloudVoice) => {
    const url = voiceSampleUrl(voice);
    if (!url) return;
    stop();
    stopReadAloud();
    const audio = new Audio(url);
    // Read-aloud speeds up playback the same way, so this is what answers sound like.
    audio.preservesPitch = true;
    audio.playbackRate = speed;
    audio.addEventListener("ended", () => {
      if (audioRef.current === audio) stop();
    });
    audioRef.current = audio;
    setPlaying(voice);
    void audio.play().catch(() => {
      if (audioRef.current === audio) stop();
    });
  };

  useEffect(() => () => audioRef.current?.pause(), []);

  return { playing, play, stop };
}

export function ReadAloudSettings() {
  const [voice, setVoice] = useReadAloudVoice();
  const [speed, setSpeed] = useReadAloudSpeed();
  const sample = useVoiceSample(speed);
  const [downloaded, setDownloaded] = useState(false);
  const speedRatio = (speed - MIN_READ_ALOUD_SPEED) / (MAX_READ_ALOUD_SPEED - MIN_READ_ALOUD_SPEED);
  const speedSliderStyle = {
    "--settings-slider-progress": `${speedRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - speedRatio}rem`,
  } as CSSProperties;

  useEffect(() => {
    void hasReadAloudModel().then(setDownloaded);
  }, []);

  return (
    <SettingsPageContainer>
      <SettingsSection id="read-aloud-voice" title="Voice" variant="plain">
        <div role="radiogroup" aria-label="Voice" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {READ_ALOUD_VOICES.map((option) => {
            const preview = sample.playing === option.id;
            const selected = option.id === voice;
            return (
              <div
                key={option.id}
                className={cn(
                  "relative flex items-center rounded-xl border bg-card/40 shadow-xs/5 transition-colors",
                  selected
                    ? "border-primary/70 bg-primary/5"
                    : "border-border/60 hover:bg-accent/40",
                )}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setVoice(option.id)}
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-xl py-2.5 ps-3 pe-11 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    {option.name}
                    {selected ? <CheckIcon className="size-3.5 text-primary" /> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {option.accent} · {option.gender}
                  </span>
                </button>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label={preview ? `Stop ${option.name}` : `Hear ${option.name}`}
                        className="absolute end-2"
                        onClick={() => (preview ? sample.stop() : sample.play(option.id))}
                        size="icon-xs"
                        type="button"
                        variant="ghost-muted"
                      />
                    }
                  >
                    {preview ? (
                      <SquareIcon className="size-2.5 fill-current" />
                    ) : (
                      <Volume2Icon className="size-3.5" />
                    )}
                  </TooltipTrigger>
                  <TooltipPopup>{preview ? "Stop" : "Hear this voice"}</TooltipPopup>
                </Tooltip>
              </div>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection id="read-aloud" title="Playback">
        <SettingsRow
          {...searchableSetting("read-aloud-speed")}
          title="Speed"
          description="How fast answers are read. Voice samples above play at this speed too."
          control={
            <div className="flex w-full items-center gap-3 sm:w-56">
              <output
                className="min-w-14 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor="read-aloud-speed-input"
              >
                {speed.toFixed(2)}×
              </output>
              <input
                aria-label="Reading speed"
                className="settings-slider min-w-0 flex-1"
                id="read-aloud-speed-input"
                max={MAX_READ_ALOUD_SPEED}
                min={MIN_READ_ALOUD_SPEED}
                onChange={(event) => setSpeed(Number(event.currentTarget.value))}
                step={0.05}
                style={speedSliderStyle}
                type="range"
                value={speed}
              />
            </div>
          }
          resetAction={
            speed !== DEFAULT_READ_ALOUD_SPEED ? (
              <SettingResetButton
                label="speed"
                onClick={() => setSpeed(DEFAULT_READ_ALOUD_SPEED)}
              />
            ) : null
          }
        />
        <SettingsRow
          {...searchableSetting("read-aloud-model")}
          title="Voice model"
          description="Kokoro runs on this device, so reading aloud is free and nothing leaves your computer. It downloads once, about 330 MB, the first time you use it."
          status={downloaded ? "Downloaded" : "Not downloaded yet"}
          control={
            downloaded ? (
              <Button
                onClick={() => void deleteReadAloudModel().then(() => setDownloaded(false))}
                size="xs"
                type="button"
                variant="outline"
              >
                Delete download
              </Button>
            ) : null
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
