# LALAL.AI Downloader

Tiny tutorial repo for saving LALAL.AI preview stem segments and merging them into MP3 files.

## Install the Tampermonkey Script

Install Tampermonkey, then open:

https://raw.githubusercontent.com/rohanod/lalalai-downloader/main/lalalai-streaming-stem-zip-downloader.user.js

Tampermonkey should show an install screen.

## Download Segments

1. Open `https://lalal.ai/`.
2. Upload or open a track so the preview stems load.
3. The downloader panel appears bottom-right after matching segment requests are detected.
4. Click `Start downloading ZIP`.
5. Unzip the downloaded file. Each stem type gets its own folder of MP3 segments.

## Merge Segments

Install ffmpeg:

```bash
brew install ffmpeg
```

Merge one or more unzipped stem folders:

```bash
chmod +x merge-lalal-segments.sh
./merge-lalal-segments.sh vocal instrumental
```

Each folder creates one MP3 in the current directory, for example `vocal.mp3`.

## Files

- `lalalai-streaming-stem-zip-downloader.user.js` - Tampermonkey userscript.
- `merge-lalal-segments.sh` - ffmpeg concat helper.
