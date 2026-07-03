// ==UserScript==
// @name         LALAL.AI Streaming Stem ZIP Downloader
// @namespace    extract-lalal-segments
// @version      1.5.0
// @match        https://lalal.ai/*
// @match        https://www.lalal.ai/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      d.lalal.ai
// @require      https://cdn.jsdelivr.net/npm/@zip.js/zip.js@2.7.54/dist/zip.min.js
// ==/UserScript==

(() => {
  "use strict";

  const segmentRegex = /^https:\/\/d\.lalal\.ai\/media\/split\/([^/]+)\/([^/]+)\/([^/]+)\/segment-(\d+)\.mp3([?#].*)?$/i;
  const stemsByType = new Map();

  let panel;
  let statusLine;
  let stemList;
  let downloadButton;
  let clearButton;
  let isDownloading = false;

  function safeName(value) {
    return decodeURIComponent(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  }

  function setStatus(text) {
    if (statusLine) statusLine.textContent = text;
  }

  function ensurePanel() {
    if (panel || !document.body) return;

    panel = document.createElement("div");
    panel.style.position = "fixed";
    panel.style.right = "16px";
    panel.style.bottom = "16px";
    panel.style.zIndex = "999999";
    panel.style.width = "360px";
    panel.style.padding = "12px";
    panel.style.borderRadius = "12px";
    panel.style.background = "#111";
    panel.style.color = "#fff";
    panel.style.font = "13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
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
    stemList.style.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    stemList.style.maxHeight = "150px";
    stemList.style.overflow = "auto";
    stemList.style.whiteSpace = "pre-wrap";

    downloadButton = document.createElement("button");
    downloadButton.textContent = "Start downloading ZIP";
    downloadButton.disabled = true;
    downloadButton.style.width = "100%";
    downloadButton.style.border = "0";
    downloadButton.style.borderRadius = "8px";
    downloadButton.style.padding = "8px 10px";
    downloadButton.style.cursor = "pointer";
    downloadButton.style.fontWeight = "700";
    downloadButton.style.marginBottom = "8px";

    clearButton = document.createElement("button");
    clearButton.textContent = "Clear detected stems";
    clearButton.style.width = "100%";
    clearButton.style.border = "0";
    clearButton.style.borderRadius = "8px";
    clearButton.style.padding = "8px 10px";
    clearButton.style.cursor = "pointer";
    clearButton.style.fontWeight = "700";

    downloadButton.addEventListener("click", startDownload);
    clearButton.addEventListener("click", () => {
      if (isDownloading) return;
      stemsByType.clear();
      updatePanel();
    });

    panel.append(title, statusLine, stemList, downloadButton, clearButton);
    document.body.appendChild(panel);
  }

  function updatePanel() {
    ensurePanel();

    const stems = [...stemsByType.values()].sort((a, b) => a.type.localeCompare(b.type));

    stemList.textContent = stems.length
      ? stems.map((stem) => `${stem.type} — seen: ${[...stem.seenNumbers].sort((a, b) => a - b).join(", ")}`).join("\n")
      : "No matching stems detected yet.";

    downloadButton.disabled = isDownloading || stems.length === 0;
    clearButton.disabled = isDownloading;

    if (!isDownloading) {
      setStatus(`Detected ${stems.length} unique type(s).`);
    }
  }

  function observeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return;

    const cleanUrl = rawUrl.split("#")[0];
    const match = cleanUrl.match(segmentRegex);

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
        seenNumbers: new Set([number])
      });
    } else {
      const existing = stemsByType.get(type);
      existing.seenNumbers.add(number);
      existing.width = Math.max(existing.width, rawNumber.length);

      if (!existing.suffix && suffix) {
        existing.suffix = suffix;
      }
    }

    updatePanel();
  }

  function requestArrayBuffer(url) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "arraybuffer",
        timeout: 30000,
        onload: (response) => resolve({
          status: response.status,
          body: response.response
        }),
        onerror: () => resolve({
          status: 0,
          body: null
        }),
        ontimeout: () => resolve({
          status: 0,
          body: null
        })
      });
    });
  }

  function makeSegmentUrl(stem, index) {
    const number = String(index).padStart(stem.width, "0");
    return `https://d.lalal.ai/media/split/${stem.id1}/${stem.id2}/${stem.type}/segment-${number}.mp3${stem.suffix || ""}`;
  }

  async function findStartSegment(stem) {
    const candidates = [
      0,
      1,
      ...[...stem.seenNumbers].sort((a, b) => a - b)
    ];

    for (const index of [...new Set(candidates)]) {
      const url = makeSegmentUrl(stem, index);
      const response = await requestArrayBuffer(url);

      if (response.status === 200) {
        return {
          index,
          body: response.body
        };
      }
    }

    return null;
  }

  async function createZipWriter(suggestedName) {
    const pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

    if (pageWindow.showSaveFilePicker && zip.WritableStreamWriter) {
      const handle = await pageWindow.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: "ZIP file",
            accept: {
              "application/zip": [".zip"]
            }
          }
        ]
      });

      const writable = await handle.createWritable();

      return {
        writer: new zip.ZipWriter(new zip.WritableStreamWriter(writable), {
          level: 0,
          bufferedWrite: true
        }),
        async close() {
          await this.writer.close();
          await writable.close();
        },
        mode: "stream"
      };
    }

    const blobWriter = new zip.BlobWriter("application/zip");

    return {
      writer: new zip.ZipWriter(blobWriter, {
        level: 0
      }),
      async close() {
        const blob = await this.writer.close();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = suggestedName;
        link.style.display = "none";

        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 30000);
      },
      mode: "blob"
    };
  }

  async function addStemToZip(zipWriter, stem) {
    const folderName = safeName(stem.type);
    const start = await findStartSegment(stem);

    if (!start) {
      return 0;
    }

    let index = start.index;
    let count = 0;

    while (true) {
      const number = String(index).padStart(stem.width, "0");
      const url = makeSegmentUrl(stem, index);

      setStatus(`Downloading ${folderName}/segment-${number}.mp3`);

      const response = count === 0
        ? { status: 200, body: start.body }
        : await requestArrayBuffer(url);

      if (response.status !== 200) {
        return count;
      }

      await zipWriter.add(
        `${folderName}/segment-${number}.mp3`,
        new zip.Uint8ArrayReader(new Uint8Array(response.body)),
        {
          level: 0
        }
      );

      count += 1;
      index += 1;
    }
  }

  async function startDownload() {
    if (isDownloading) return;

    const stems = [...stemsByType.values()].sort((a, b) => a.type.localeCompare(b.type));

    if (stems.length === 0) {
      setStatus("No matching stems detected yet.");
      return;
    }

    isDownloading = true;
    updatePanel();

    try {
      const firstStem = stems[0];
      const zipName = `lalal-${safeName(firstStem.id1)}-${safeName(firstStem.id2)}-stems.zip`;
      const output = await createZipWriter(zipName);
      const summary = [];

      setStatus(output.mode === "stream" ? "Choose ZIP save location..." : "Preparing ZIP...");

      for (const stem of stems) {
        const count = await addStemToZip(output.writer, stem);
        summary.push(`${safeName(stem.type)}: ${count}`);
      }

      setStatus("Finalising ZIP...");
      await output.close();

      setStatus(`Saved ZIP: ${summary.join(", ")}`);
    } catch (error) {
      setStatus(`Stopped: ${error && error.message ? error.message : String(error)}`);
    } finally {
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

  function observePerformance() {
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
      buffered: true
    });

    setInterval(scan, 2000);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== "__LALAL_SEGMENT_URL__") return;
    observeUrl(event.data.url);
  });

  if (document.documentElement) {
    installPageHook();
  } else {
    document.addEventListener("DOMContentLoaded", installPageHook, { once: true });
  }

  observePerformance();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensurePanel);
  } else {
    ensurePanel();
  }
})();