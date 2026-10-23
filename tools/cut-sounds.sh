#!/usr/bin/env bash
# Cuts single shots out of the source recordings and writes them to public/sounds/ as short mono WAVs.
# Sources and licences are listed in the README ("Sound credits").
#
# Usage: tools/cut-sounds.sh <path to "Prepared SFX Library"> [freesound dir]
set -euo pipefail

library="${1:?path to the extracted "Prepared SFX Library" folder}"
freesound="${2:-}"
out="$(cd "$(dirname "$0")/.." && pwd)/public/sounds"
mkdir -p "$out"

# cut <source> <start s> <length s> <target name> [fade start as fraction of the length, default 0.6]
# Starts 8 ms before the event, fades out the tail and normalises the peak to -1 dBFS.
cut() {
  local source="$1" start="$2" length="$3" name="$4" fade_at="${5:-0.6}"
  local from fade peak
  from=$(awk -v s="$start" 'BEGIN { printf "%.3f", (s > 0.008 ? s - 0.008 : 0) }')
  fade=$(awk -v l="$length" -v f="$fade_at" 'BEGIN { printf "%.3f", l * f }')
  local filters="atrim=start=${from}:duration=${length},asetpts=PTS-STARTPTS,pan=mono|c0=0.5*c0+0.5*c1,afade=t=out:st=${fade}:d=$(awk -v l="$length" -v f="$fade" 'BEGIN { printf "%.3f", l - f }')"
  peak=$(ffmpeg -hide_banner -nostats -i "$source" -af "${filters},volumedetect" -f null - 2>&1 | sed -n 's/.*max_volume: \(-*[0-9.]*\) dB/\1/p')
  ffmpeg -hide_banner -loglevel error -y -i "$source" \
    -af "${filters},volume=$(awk -v p="$peak" 'BEGIN { printf "%.2f", -1 - p }')dB" \
    -ar 44100 -c:a pcm_s16le "$out/$name.wav"
  echo "$name.wav (peak ${peak} dB)"
}

# OpenGameArt "The Free Firearm Sound Library" (CC0), near-distance recordings.
cut "$library/Walther PPQ/X_39P.wav" 1.407 0.7 pistol-1
cut "$library/Walther PPQ/X_39P.wav" 6.444 0.7 pistol-2
cut "$library/Walther PPQ/X_39P.wav" 10.660 0.7 pistol-3
cut "$library/Nova/O_21P.wav" 0.429 1.2 shotgun-1
cut "$library/Nova/O_21P.wav" 3.464 1.2 shotgun-2
cut "$library/AK-47/C_28P.wav" 0.611 0.6 ak47-1
cut "$library/AK-47/C_28P.wav" 3.257 0.6 ak47-2
cut "$library/AK-47/C_28P.wav" 6.021 0.6 ak47-3
cut "$library/AK-47/C_28P.wav" 9.156 0.6 ak47-4
# Stand-ins with the right era and cartridge: a 9 mm Carl Gustav M45 for the MP40, a .30-06 Springfield for the Garand.
cut "$library/Carl Gustav M45/G_31P.wav" 0.31 0.5 mp40-1
cut "$library/Carl Gustav M45/G_31P.wav" 3.5 0.5 mp40-2
cut "$library/Carl Gustav M45/G_31P.wav" 6.73 0.5 mp40-3
cut "$library/1917/B_24P.wav" 1.3 1.0 garand-1
cut "$library/1917/B_24P.wav" 6.73 1.0 garand-2

# loop <source> <start s> <end s> <target name>
# Seamless loop of continuous fire: the last 30 ms are crossfaded into the first 30 ms.
loop() {
  local source="$1" start="$2" end="$3" name="$4" fade=0.03
  local body_start body_end peak
  body_start=$(awk -v s="$start" -v f="$fade" 'BEGIN { printf "%.3f", s + f }')
  body_end=$(awk -v e="$end" -v f="$fade" 'BEGIN { printf "%.3f", e - f }')
  local graph="[0:a]pan=mono|c0=0.5*c0+0.5*c1,asplit=3[a][b][c];
    [a]atrim=start=${body_start}:end=${body_end},asetpts=PTS-STARTPTS[body];
    [b]atrim=start=${body_end}:end=${end},asetpts=PTS-STARTPTS,afade=t=out:d=${fade}[out];
    [c]atrim=start=${start}:end=${body_start},asetpts=PTS-STARTPTS,afade=t=in:d=${fade}[in];
    [out][in]amix=inputs=2:normalize=0[seam];
    [body][seam]concat=n=2:v=0:a=1"
  peak=$(ffmpeg -hide_banner -nostats -i "$source" -filter_complex "${graph},volumedetect" -f null - 2>&1 | sed -n 's/.*max_volume: \(-*[0-9.]*\) dB/\1/p')
  ffmpeg -hide_banner -loglevel error -y -i "$source" \
    -filter_complex "${graph},volume=$(awk -v p="$peak" 'BEGIN { printf "%.2f", -1 - p }')dB" \
    -ar 44100 -c:a pcm_s16le "$out/$name.wav"
  echo "$name.wav (loop, peak ${peak} dB)"
}

if [[ -n "$freesound" ]]; then
  # Freesound downloads, file names as Freesound delivers them.
  mg42="$freesound/338242__lubini__mg-42-solo-ww2.wav"                           # CC BY 4.0, Lubini
  gatling="$freesound/239596__mikewest__gatling-gun-close.wav"                   # CC0, mikewest
  mossberg="$freesound/159710__anthonychan0__mossberg-500a-1-shot-and-pump.wav"  # CC0, AnthonyChan0

  loop "$mg42" 0.40 1.25 mg42-loop
  cut "$mg42" 1.25 0.6 mg42-tail
  loop "$gatling" 2.76 5.705 gatling-loop
  cut "$gatling" 5.705 0.9 gatling-tail
  cut "$mossberg" 1.24 0.65 shotgun-pump

  howitzer="$freesound/161343__qubodup__howitzer-artillery-gun-shot-sound-effect-01.flac"  # CC0, qubodup (US Army)
  mclc="$freesound/162261__qubodup__explosion-of-mine-clearing-line-charge-mclc.flac"      # CC0, qubodup (US Government)
  massive="$freesound/741175__qubodup__massive-explosion.flac"                             # CC0, qubodup

  cut "$howitzer" 0.008 0.8 flak-shot
  cut "$mclc" 0.008 1.3 flak-burst-1
  cut "$mclc" 1.4 0.95 flak-burst-2
  cut "$massive" 0.008 8 nuke-blast

  casings="$freesound/318964__gryffdavid__bouncing-shell-casings-various-sizes.wav"  # CC0, GryffDavid
  cut "$casings" 6.83 0.8 casing-1
  cut "$casings" 8.31 0.8 casing-2
  cut "$casings" 15.26 0.8 casing-3
  cut "$casings" 16.84 0.8 casing-4
  cut "$casings" 20.98 0.8 casing-5
  cut "$casings" 34.23 0.8 casing-6
  cut "$casings" 23.24 1.0 shell-drop-1
  cut "$casings" 30.37 1.0 shell-drop-2

  # Reload and handling sounds.
  pistol="$freesound/427505__anthonychan0__sw-mp9-m2.wav"                                              # CC0, AnthonyChan0
  ak="$freesound/142892__ceremonialchapstick__ak47-chambering.aiff"                                    # CC0, ceremonialchapstick
  shells="$freesound/438575__craigsmith__g35-10-gun-shots.wav"                                         # CC0, craigsmith
  rpg_load="$freesound/725401__serutonin-deprivd__inserting-a-rocket-into-an-rpg-7-rocket-launcher-full-sequence.wav"  # CC0
  whistle="$freesound/479924__craigsmith__r12-27-falling-bombs-whistle.wav"                            # CC0, craigsmith

  cut "$pistol" 31.24 0.35 mag-out
  cut "$pistol" 47.38 0.35 mag-in
  cut "$pistol" 56.08 0.4 slide-release
  cut "$ak" 8.79 0.5 ak47-charge
  cut "$ak" 2.25 0.55 mg42-cover-open
  cut "$ak" 9.85 0.45 mg42-cover-close
  cut "$shells" 0.35 0.22 shell-insert-1
  cut "$shells" 1.63 0.22 shell-insert-2
  cut "$rpg_load" 3.6 4.0 rpg-load 0.9
  cut "$whistle" 0.3 4.5 bomb-whistle 0.97

  ping="$freesound/725398__serutonin-deprivd__an-m1-garand-clip-being-ejected-w-ping.wav"                 # CC0
  garand_load="$freesound/725399__serutonin-deprivd__an-m1-garand-being-reloaded-while-empty-full-sequence.wav"  # CC0
  cut "$ping" 0.03 1.1 garand-ping 0.8
  cut "$garand_load" 3.33 0.5 garand-clip-in
  cut "$garand_load" 5.74 0.6 garand-bolt
fi
