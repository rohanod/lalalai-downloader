// ==UserScript==
// @name         LALAL.AI Stem ZIP Downloader
// @namespace    extract-lalal-segments
// @version      1.9.1
// @match        https://lalal.ai/*
// @match        https://www.lalal.ai/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        unsafeWindow
// @connect      d.lalal.ai
// @require      https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.7.54/dist/zip-full.min.js
// ==/UserScript==

(() => {
  "use strict";

  const segmentRegex =
    /^https:\/\/d\.lalal\.ai\/media\/split\/([^/]+)\/([^/]+)\/([^/]+)\/segment-(\d+)\.mp3([?#].*)?$/i;
  const stemsByType = new Map();

  let panel;
  let statusLine;
  let stemList;
  let startButton;
  let clearButton;
  let isDownloading = false;

  function safeName(value) {
    return decodeURIComponent(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  }

  function setStatus(text) {
    console.log("[LALAL ZIP]", text);
    if (statusLine) statusLine.textContent = text;
  }

  function ensurePanel() {
    if (panel || !document.body) return;

    panel = document.createElement("div");
    panel.style.position = "fixed";
    panel.style.right = "16px";
    panel.style.bottom = "16px";
    panel.style.zIndex = "2147483647";
    panel.style.width = "370px";
    panel.style.padding = "12px";
    panel.style.borderRadius = "12px";
    panel.style.background = "#111";
    panel.style.color = "#fff";
    panel.style.font =
      "13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    panel.style.boxShadow = "0 8px 30px rgba(0,0,0,.35)";

    const title = document.createElement("div");
    title.textContent = "LALAL ZIP downloader";
    title.style.fontWeight = "700";
    title.style.marginBottom = "8px";

    statusLine = document.createElement("div");
    statusLine.textContent = "Waiting for matching segment requests...";
    statusLine.style.marginBottom = "8px";
    statusLine.style.lineHeight = "1.35";

    stemList = document.createElement("pre");
    stemList.textContent = "No matching stems detected yet.";
    stemList.style.margin = "0 0 10px 0";
    stemList.style.padding = "8px";
    stemList.style.borderRadius = "8px";
    stemList.style.background = "#222";
    stemList.style.color = "#fff";
    stemList.style.font =
      "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    stemList.style.maxHeight = "160px";
    stemList.style.overflow = "auto";
    stemList.style.whiteSpace = "pre-wrap";

    startButton = document.createElement("button");
    startButton.textContent = "Start ZIP download";
    startButton.disabled = true;
    startButton.style.width = "100%";
    startButton.style.border = "0";
    startButton.style.borderRadius = "8px";
    startButton.style.padding = "8px 10px";
    startButton.style.cursor = "pointer";
    startButton.style.fontWeight = "700";
    startButton.style.marginBottom = "8px";

    clearButton = document.createElement("button");
    clearButton.textContent = "Clear detected stems";
    clearButton.style.width = "100%";
    clearButton.style.border = "0";
    clearButton.style.borderRadius = "8px";
    clearButton.style.padding = "8px 10px";
    clearButton.style.cursor = "pointer";
    clearButton.style.fontWeight = "700";

    startButton.addEventListener("click", startDownload);

    clearButton.addEventListener("click", () => {
      if (isDownloading) return;
      stemsByType.clear();
      updatePanel();
      setStatus("Cleared detected stems.");
    });

    panel.append(title, statusLine, stemList, startButton, clearButton);
    document.body.appendChild(panel);
  }

  function updatePanel() {
    ensurePanel();

    const stems = [...stemsByType.values()].sort((a, b) =>
      a.type.localeCompare(b.type),
    );

    stemList.textContent = stems.length
      ? stems
          .map(
            (stem) =>
              `${stem.type} — seen: ${[...stem.seenNumbers].sort((a, b) => a - b).join(", ")}`,
          )
          .join("\n")
      : "No matching stems detected yet.";

    startButton.disabled = isDownloading || stems.length === 0;
    clearButton.disabled = isDownloading;

    if (!isDownloading) {
      setStatus(`Detected ${stems.length} unique type(s).`);
    }
  }

  function observeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return;

    const match = rawUrl.match(segmentRegex);

    if (!match) return;

    const [, id1, id2, type, rawNumber, suffix = ""] = match;
    const number = Number.parseInt(rawNumber, 10);

    if (!Number.isFinite(number)) return;

    if (!stemsByType.has(type)) {
      stemsByType.set(type, {
        id1,
        id2,
        type,
        suffix,
        width: rawNumber.length,
        seenNumbers: new Set([number]),
      });
    } else {
      const stem = stemsByType.get(type);
      stem.seenNumbers.add(number);
      stem.width = Math.max(stem.width, rawNumber.length);
      if (!stem.suffix && suffix) stem.suffix = suffix;
    }

    updatePanel();
  }

  function requestArrayBuffer(url) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "arraybuffer",
        timeout: 60000,
        onload: (response) =>
          resolve({
            status: response.status,
            body: response.response,
          }),
        onerror: () =>
          resolve({
            status: 0,
            body: null,
          }),
        ontimeout: () =>
          resolve({
            status: 0,
            body: null,
          }),
      });
    });
  }

  function makeSegmentUrl(stem, index) {
    const number = String(index).padStart(stem.width, "0");
    return `https://d.lalal.ai/media/split/${stem.id1}/${stem.id2}/${stem.type}/segment-${number}.mp3${stem.suffix || ""}`;
  }

  async function findStartSegment(stem) {
    const candidates = [0, 1, ...[...stem.seenNumbers].sort((a, b) => a - b)];

    for (const index of [...new Set(candidates)]) {
      const number = String(index).padStart(stem.width, "0");
      const url = makeSegmentUrl(stem, index);

      setStatus(`Testing ${safeName(stem.type)} segment-${number}.mp3`);

      const response = await requestArrayBuffer(url);

      if (response.status === 200 && response.body) {
        return {
          index,
          body: response.body,
        };
      }
    }

    return null;
  }

  async function chooseZipFile(filename) {
    const pageWindow =
      typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

    if (!pageWindow.showSaveFilePicker) {
      throw new Error(
        "Save location picker is not available. Use Chrome or Edge.",
      );
    }

    return await pageWindow.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: "ZIP file",
          accept: {
            "application/zip": [".zip"],
          },
        },
      ],
    });
  }

  async function addStemToZip(zipWriter, stem, ZipLib) {
    const folderName = safeName(stem.type);
    const start = await findStartSegment(stem);

    if (!start) {
      setStatus(`Skipping ${folderName}: no valid start segment.`);
      return 0;
    }

    let index = start.index;
    let count = 0;

    while (true) {
      const number = String(index).padStart(stem.width, "0");
      const url = makeSegmentUrl(stem, index);

      setStatus(`Downloading ${folderName}/segment-${number}.mp3`);

      const response =
        count === 0
          ? { status: 200, body: start.body }
          : await requestArrayBuffer(url);

      if (response.status !== 200 || !response.body) {
        setStatus(`Finished ${folderName}: ${count} segment(s).`);
        return count;
      }

      const blob = new Blob([response.body], {
        type: "audio/mpeg",
      });

      await zipWriter.add(
        `${folderName}/segment-${number}.mp3`,
        new ZipLib.BlobReader(blob),
        {
          level: 0,
        },
      );

      count += 1;
      index += 1;

      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  function getStitchScript() {
    return `#!/usr/bin/env bash
set -euo pipefail

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required. Install it with: brew install ffmpeg"
  exit 1
fi

dirs=("$@")

if [ "$#" -eq 0 ]; then
  dirs=()

  for item in */; do
    [ -d "$item" ] || continue
    dirs+=("\${item%/}")
  done
fi

if [ "\${#dirs[@]}" -eq 0 ]; then
  echo "No input directories found."
  echo "Usage: ./stitch.sh [input_dir...]"
  exit 1
fi

for input_dir in "\${dirs[@]}"; do
  if [ ! -d "$input_dir" ]; then
    echo "Skipping, not a directory: $input_dir"
    continue
  fi

  dir_name="$(basename "\${input_dir%/}")"
  output_name="./\${dir_name}.mp3"
  list_file="./.\${dir_name}-concat-list.txt"

  rm -f "$list_file"

  found=0

  while IFS= read -r file; do
    abs_file="$(cd "$(dirname "$file")" && pwd)/$(basename "$file")"
    printf "file '%s'\\n" "$abs_file" >> "$list_file"
    found=1
  done < <(find "$input_dir" -maxdepth 1 -type f -name "*.mp3" | LC_ALL=C sort)

  if [ "$found" -eq 0 ]; then
    rm -f "$list_file"
    echo "Skipping, no .mp3 files found in: $input_dir"
    continue
  fi

  ffmpeg -hide_banner -y \\
    -f concat \\
    -safe 0 \\
    -i "$list_file" \\
    -vn \\
    -c:a libmp3lame \\
    -b:a 192k \\
    "$output_name"

  rm -f "$list_file"

  echo "Created: $output_name"
done
`;
  }

  async function addSupportFilesToZip(zipWriter, ZipLib) {
    const stitchBlob = new Blob([getStitchScript()], {
      type: "text/x-shellscript",
    });

    await zipWriter.add("stitch.sh", new ZipLib.BlobReader(stitchBlob), {
      level: 0,
    });
  }

  async function startDownload() {
    if (isDownloading) return;

    ensurePanel();

    const ZipLib = globalThis.zip;

    if (
      !ZipLib ||
      !ZipLib.ZipWriter ||
      !ZipLib.WritableStreamWriter ||
      !ZipLib.BlobReader
    ) {
      setStatus("zip.js did not load fully. Refresh the page and try again.");
      return;
    }

    const stems = [...stemsByType.values()].sort((a, b) =>
      a.type.localeCompare(b.type),
    );

    if (stems.length === 0) {
      setStatus(
        "No matching stems detected yet. Play/preview the stems first.",
      );
      return;
    }

    const firstStem = stems[0];
    const filename = `lalal-${safeName(firstStem.id1)}-${safeName(firstStem.id2)}-stems.zip`;

    isDownloading = true;
    updatePanel();

    let writable = null;
    let zipWriter = null;

    try {
      setStatus("Choose where to save the ZIP...");

      const fileHandle = await chooseZipFile(filename);

      setStatus("Preparing ZIP file...");
      writable = await fileHandle.createWritable();

      zipWriter = new ZipLib.ZipWriter(
        new ZipLib.WritableStreamWriter(writable),
        {
          level: 0,
          bufferedWrite: true,
          useWebWorkers: false,
        },
      );

      window.onbeforeunload = () => "A LALAL ZIP download is still running.";

      const summary = [];

      for (const stem of stems) {
        const count = await addStemToZip(zipWriter, stem, ZipLib);
        summary.push(`${safeName(stem.type)}: ${count}`);
      }

      setStatus("Adding stitch.sh...");
      await addSupportFilesToZip(zipWriter, ZipLib);

      setStatus("Finalising ZIP...");
      await zipWriter.close();
      await writable.close();

      setStatus(`Saved ZIP: ${summary.join(", ")}`);

      try {
        GM_notification({
          title: "LALAL ZIP saved",
          text: summary.join(", "),
          timeout: 5000,
        });
      } catch {}
    } catch (error) {
      try {
        if (zipWriter) await zipWriter.close();
      } catch {}

      try {
        if (writable) await writable.abort();
      } catch {}

      setStatus(
        `Stopped: ${error && error.message ? error.message : String(error)}`,
      );
      console.error(error);
    } finally {
      window.onbeforeunload = null;
      isDownloading = false;
      updatePanel();
    }
  }

  function installPageHook() {
    const code = `
      (() => {
        const send = (url) => {
          if (typeof url === "string") {
            window.postMessage({ type: "__LALAL_SEGMENT_URL__", url }, "*");
          }
        };

        const originalFetch = window.fetch;
        window.fetch = function(input, init) {
          send(typeof input === "string" ? input : input && input.url);
          return originalFetch.apply(this, arguments);
        };

        const originalOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
          send(url);
          return originalOpen.apply(this, arguments);
        };
      })();
    `;

    const script = document.createElement("script");
    script.textContent = code;
    document.documentElement.appendChild(script);
    script.remove();
  }

  function observePerformanceOnceAndBuffered() {
    const scan = () => {
      for (const entry of performance.getEntriesByType("resource")) {
        observeUrl(entry.name);
      }
    };

    scan();

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        observeUrl(entry.name);
      }
    });

    observer.observe({
      type: "resource",
      buffered: true,
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== "__LALAL_SEGMENT_URL__") return;
    observeUrl(event.data.url);
  });

  if (document.documentElement) {
    installPageHook();
  } else {
    document.addEventListener("DOMContentLoaded", installPageHook, {
      once: true,
    });
  }

  observePerformanceOnceAndBuffered();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensurePanel);
  } else {
    ensurePanel();
  }
})();
