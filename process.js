const STORAGE_KEY = "announcerSourceText";
const KANJI_LEVEL_KEY = "announcerKanjiLevel";
const VOICE_KEY = "announcerVoiceUri";
const SPEED_KEY = "announcerSpeechSpeed";
const SPEED_RATE_MAP = {
  slow: 0.6,
  normal: 1.0,
  fast: 1.45
};
const KUROMOJI_DIC = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict/";
const JLPT_KANJI_URL = {
  n4: "https://unpkg.com/kanji-data@1.1.0/data/lists/jlpt-4.json",
  n3: "https://unpkg.com/kanji-data@1.1.0/data/lists/jlpt-3.json",
  n2: "https://unpkg.com/kanji-data@1.1.0/data/lists/jlpt-2.json",
  n1: "https://unpkg.com/kanji-data@1.1.0/data/lists/jlpt-1.json"
};
const JLPT_LEVEL_ORDER = ["n4", "n3", "n2", "n1"];

const exportDocxBtn = document.getElementById("exportDocxBtn");
const playToggleBtn = document.getElementById("playToggleBtn");
const levelFilter = document.getElementById("levelFilter");
const voiceSelect = document.getElementById("voiceSelect");
const speedSelect = document.getElementById("speedSelect");
const statusText = document.getElementById("status");
const furiganaOutput = document.getElementById("furiganaOutput");
const progressWrap = document.getElementById("progressWrap");
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");
const exportModal = document.getElementById("exportModal");
const closeExportModalBtn = document.getElementById("closeExportModalBtn");
const exportOptionButtons = document.querySelectorAll("[data-export-type]");

let tokenizer = null;
let tokenizerPromise = null;
let cachedVoices = [];
let processedLines = [];
let fullPlaybackState = "stopped";
let isExporting = false;
let isProcessing = false;
const jlptKanjiCache = new Map();

furiganaOutput.innerHTML = "<p class=\"line-text\">Processed lines will appear here.</p>";

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

function setPlayToggleVisual(state) {
  if (state === "playing") {
    playToggleBtn.innerHTML = '<span aria-hidden="true">&#x23F8;</span><span class="sr-only">Pause full script</span>';
    playToggleBtn.title = "Pause full script";
    playToggleBtn.setAttribute("aria-label", "Pause full script");
    playToggleBtn.setAttribute("aria-pressed", "true");
    return;
  }

  playToggleBtn.innerHTML = '<span aria-hidden="true">&#x25B6;</span><span class="sr-only">Play full script</span>';
  playToggleBtn.title = "Play full script";
  playToggleBtn.setAttribute("aria-label", "Play full script");
  playToggleBtn.setAttribute("aria-pressed", "false");
}

function resetFullPlayback() {
  fullPlaybackState = "stopped";
  setPlayToggleVisual("stopped");
}

function syncControlStates() {
  playToggleBtn.disabled = isProcessing;
  levelFilter.disabled = isProcessing || isExporting;
  const hasSpeech = "speechSynthesis" in window;
  const hasJapaneseVoices = getJapaneseVoices().length > 0;
  voiceSelect.disabled = isProcessing || isExporting || !hasSpeech || !hasJapaneseVoices;
  speedSelect.disabled = isProcessing || isExporting;
  exportDocxBtn.disabled = isProcessing || isExporting;
  closeExportModalBtn.disabled = isExporting;

  for (const optionBtn of exportOptionButtons) {
    optionBtn.disabled = isProcessing || isExporting;
  }
}

function setProcessingBusy(busy) {
  isProcessing = busy;
  syncControlStates();
}

function setProgress(percent, label) {
  const clamped = Math.max(0, Math.min(100, percent));
  progressWrap.classList.add("active");
  progressFill.style.width = `${clamped}%`;
  progressLabel.textContent = label;
}

function hideProgress() {
  progressWrap.classList.remove("active");
}

function setExportBusy(busy) {
  isExporting = busy;
  syncControlStates();
}

function openExportModal() {
  if (isExporting || isProcessing) {
    return;
  }

  if (processedLines.length === 0) {
    setStatus("Nothing to export yet.", true);
    return;
  }

  exportModal.classList.add("open");
  exportModal.setAttribute("aria-hidden", "false");
}

function closeExportModal() {
  if (isExporting) {
    return;
  }

  exportModal.classList.remove("open");
  exportModal.setAttribute("aria-hidden", "true");
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function hasKanji(text) {
  return /[\u4e00-\u9faf\u3400-\u4dbf\u3005\u3006\u30f6]/.test(text);
}

function katakanaToHiragana(text) {
  return text.replace(/[\u30a1-\u30f6]/g, (char) => {
    return String.fromCharCode(char.charCodeAt(0) - 0x60);
  });
}

function getSourceText() {
  return (localStorage.getItem(STORAGE_KEY) || "").replace(/\r\n?/g, "\n");
}

function getSelectedLevel() {
  return levelFilter.value || "all";
}

function saveSelectedLevel(level) {
  localStorage.setItem(KANJI_LEVEL_KEY, level);
}

async function getLevelKanjiSet(level) {
  if (level === "all") {
    return null;
  }

  const startIndex = JLPT_LEVEL_ORDER.indexOf(level);
  if (startIndex === -1) {
    throw new Error(`Unknown JLPT level: ${level}`);
  }

  const mergedSet = new Set();

  for (let i = startIndex; i < JLPT_LEVEL_ORDER.length; i += 1) {
    const targetLevel = JLPT_LEVEL_ORDER[i];

    if (jlptKanjiCache.has(targetLevel)) {
      for (const item of jlptKanjiCache.get(targetLevel)) {
        mergedSet.add(item);
      }
      continue;
    }

    const url = JLPT_KANJI_URL[targetLevel];
    if (!url) {
      throw new Error(`Unknown JLPT level: ${targetLevel}`);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not load JLPT ${targetLevel.toUpperCase()} kanji list.`);
    }

    const list = await response.json();
    const set = new Set(list);
    jlptKanjiCache.set(targetLevel, set);

    for (const item of set) {
      mergedSet.add(item);
    }
  }

  return mergedSet;
}

function getLevelRangeLabel(level) {
  if (level === "all") {
    return "ALL";
  }

  if (level === "n1") {
    return "N1";
  }

  return `${level.toUpperCase()}-N1`;
}

function getStoredVoiceUri() {
  const stored = localStorage.getItem(VOICE_KEY) || "";
  return stored === "auto" ? "" : stored;
}

function setStoredVoiceUri(voiceUri) {
  localStorage.setItem(VOICE_KEY, voiceUri);
}

function getStoredSpeedMode() {
  const mode = localStorage.getItem(SPEED_KEY) || "normal";
  return Object.prototype.hasOwnProperty.call(SPEED_RATE_MAP, mode) ? mode : "normal";
}

function setStoredSpeedMode(mode) {
  localStorage.setItem(SPEED_KEY, mode);
}

function getSelectedSpeechRate() {
  const mode = speedSelect.value;
  return SPEED_RATE_MAP[mode] || SPEED_RATE_MAP.normal;
}

function getJapaneseVoices() {
  return cachedVoices.filter((voice) => voice.lang && voice.lang.toLowerCase().startsWith("ja"));
}

function rankVoice(voice) {
  const name = (voice.name || "").toLowerCase();
  const lang = (voice.lang || "").toLowerCase();
  let score = 0;

  if (lang === "ja-jp") {
    score += 40;
  }
  if (name.includes("microsoft")) {
    score += 150;
  }
  if (name.includes("google")) {
    score += 120;
  }
  if (name.includes("neural") || name.includes("natural")) {
    score += 80;
  }
  if (voice.localService) {
    score += 12;
  }
  if (name.includes("espeak") || name.includes("festival") || name.includes("mbrola")) {
    score -= 180;
  }

  return score;
}

function findHarukaVoice(voices) {
  return voices.find((voice) => (voice.name || "").toLowerCase().includes("haruka")) || null;
}

function populateVoiceSelect() {
  const japaneseVoices = getJapaneseVoices();
  const sorted = [...japaneseVoices].sort((a, b) => rankVoice(b) - rankVoice(a));
  const preferred = getStoredVoiceUri();

  voiceSelect.innerHTML = "";

  if (sorted.length === 0) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "No Japanese voice";
    voiceSelect.appendChild(emptyOption);
    return;
  }

  for (const voice of sorted) {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})`;
    voiceSelect.appendChild(option);
  }

  if (preferred && sorted.some((voice) => voice.voiceURI === preferred)) {
    voiceSelect.value = preferred;
    return;
  }

  const haruka = findHarukaVoice(sorted);
  voiceSelect.value = haruka ? haruka.voiceURI : sorted[0].voiceURI;
  setStoredVoiceUri(voiceSelect.value);
}

function loadVoices() {
  if (!("speechSynthesis" in window)) {
    return;
  }
  cachedVoices = window.speechSynthesis.getVoices();
  populateVoiceSelect();
  syncControlStates();
}

function pickJapaneseVoice() {
  const japaneseVoices = getJapaneseVoices();
  if (japaneseVoices.length === 0) {
    return null;
  }

  const selectedUri = voiceSelect.value || "";
  if (selectedUri) {
    const chosenVoice = japaneseVoices.find((voice) => voice.voiceURI === selectedUri);
    if (chosenVoice) {
      return chosenVoice;
    }
  }

  const sorted = [...japaneseVoices].sort((a, b) => rankVoice(b) - rankVoice(a));
  return findHarukaVoice(sorted) || sorted[0];
}

function buildUtterance(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = getSelectedSpeechRate();
  utterance.pitch = 1;
  utterance.volume = 1;

  const jpVoice = pickJapaneseVoice();
  if (jpVoice) {
    utterance.voice = jpVoice;
  }

  return utterance;
}

function speakLineOrWord(text) {
  const cleanText = text.trim();
  if (!cleanText) {
    setStatus("No text to read.", true);
    return;
  }

  if (!("speechSynthesis" in window)) {
    setStatus("Speech synthesis is not supported in this browser.", true);
    return;
  }

  window.speechSynthesis.cancel();
  resetFullPlayback();

  const utterance = buildUtterance(cleanText);
  utterance.onstart = () => setStatus("Playing Japanese voice...");
  utterance.onend = () => setStatus("Voice playback finished.");
  utterance.onerror = (event) => setStatus(`Voice playback error: ${event.error}`, true);

  window.speechSynthesis.speak(utterance);
}

function startFullScriptPlayback() {
  const cleanText = getSourceText().trim();
  if (!cleanText) {
    setStatus("No text to read.", true);
    return;
  }

  if (!("speechSynthesis" in window)) {
    setStatus("Speech synthesis is not supported in this browser.", true);
    return;
  }

  window.speechSynthesis.cancel();

  const utterance = buildUtterance(cleanText);
  utterance.onstart = () => {
    fullPlaybackState = "playing";
    setPlayToggleVisual("playing");
    setStatus("Playing full script...");
  };
  utterance.onend = () => {
    resetFullPlayback();
    setStatus("Full script finished.");
  };
  utterance.onerror = (event) => {
    resetFullPlayback();
    setStatus(`Voice playback error: ${event.error}`, true);
  };

  fullPlaybackState = "playing";
  setPlayToggleVisual("playing");
  window.speechSynthesis.speak(utterance);
}

function toggleFullPlayback() {
  if (!("speechSynthesis" in window)) {
    setStatus("Speech synthesis is not supported in this browser.", true);
    return;
  }

  if (fullPlaybackState === "playing" && !window.speechSynthesis.speaking) {
    resetFullPlayback();
  }

  if (fullPlaybackState === "paused" && !window.speechSynthesis.paused) {
    resetFullPlayback();
  }

  if (fullPlaybackState === "playing" && window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
    window.speechSynthesis.pause();
    fullPlaybackState = "paused";
    setPlayToggleVisual("paused");
    setStatus("Playback paused.");
    return;
  }

  if (fullPlaybackState === "paused" && window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
    fullPlaybackState = "playing";
    setPlayToggleVisual("playing");
    setStatus("Playback resumed.");
    return;
  }

  startFullScriptPlayback();
}

function buildTokenizer() {
  if (tokenizer) {
    return Promise.resolve(tokenizer);
  }

  if (tokenizerPromise) {
    return tokenizerPromise;
  }

  if (typeof kuromoji === "undefined") {
    return Promise.reject(new Error("kuromoji library could not be loaded."));
  }

  setStatus("Loading Japanese dictionary (first time only)...");

  tokenizerPromise = new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: KUROMOJI_DIC }).build((error, newTokenizer) => {
      if (error) {
        reject(error);
        return;
      }

      tokenizer = newTokenizer;
      resolve(tokenizer);
    });
  });

  return tokenizerPromise;
}

function getRubyReading(token) {
  if (!token.reading || token.reading === "*") {
    return "";
  }
  const reading = katakanaToHiragana(token.reading);
  return reading && reading !== token.surface_form ? reading : "";
}

function shouldAnnotateForLevel(surface, level, levelSet) {
  if (level === "all") {
    return true;
  }

  if (!levelSet) {
    return false;
  }

  const kanjiChars = [...surface].filter((char) => hasKanji(char));
  if (kanjiChars.length === 0) {
    return false;
  }

  return kanjiChars.every((char) => levelSet.has(char));
}

function tokenToRubyHtml(token, level, levelSet) {
  const surface = token.surface_form || "";
  const escapedSurface = escapeHtml(surface);
  const rubyReading = hasKanji(surface) && shouldAnnotateForLevel(surface, level, levelSet) ? getRubyReading(token) : "";

  if (!rubyReading) {
    return escapedSurface;
  }

  return `<ruby data-speak="${escapeHtml(surface)}">${escapedSurface}<rt>${escapeHtml(rubyReading)}</rt></ruby>`;
}

function tokenToExportSegment(token, level, levelSet) {
  const surface = token.surface_form || "";
  const rubyReading = hasKanji(surface) && shouldAnnotateForLevel(surface, level, levelSet) ? getRubyReading(token) : "";

  if (!rubyReading) {
    return { kind: "text", text: surface };
  }

  return {
    kind: "ruby",
    base: surface,
    reading: rubyReading
  };
}

async function processFurigana() {
  const rawText = getSourceText();
  if (!rawText.trim()) {
    setStatus("No input text found. Go back to Input page first.", true);
    furiganaOutput.innerHTML = '<p class="line-text">No source text found.</p>';
    hideProgress();
    return;
  }

  setProcessingBusy(true);
  setProgress(4, "Preparing text...");

  try {
    setProgress(12, "Loading Japanese dictionary...");
    const activeTokenizer = await buildTokenizer();

    const level = getSelectedLevel();
    setProgress(22, `Loading JLPT ${getLevelRangeLabel(level)} filter...`);
    const levelSet = await getLevelKanjiSet(level);

    const lines = rawText.split("\n");
    const htmlRows = [];
    processedLines = [];

    setProgress(30, `Processing 0/${lines.length} lines...`);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.trim()) {
        htmlRows.push('<div class="blank"></div>');
        processedLines.push({ type: "blank", raw: "", segments: [] });
      } else {
        const tokens = activeTokenizer.tokenize(line);
        const lineHtml = tokens.map((token) => tokenToRubyHtml(token, level, levelSet)).join("");
        const segments = tokens.map((token) => tokenToExportSegment(token, level, levelSet));

        htmlRows.push(
          `<div class="line-row"><button type="button" class="line-speak" data-text="${escapeHtml(line)}" title="Play line" aria-label="Play line">&#x25B6;</button><p class="line-text">${lineHtml}</p></div>`
        );
        processedLines.push({ type: "line", raw: line, segments });
      }

      if (i % 25 === 0 || i === lines.length - 1) {
        const progress = 30 + Math.round(((i + 1) / lines.length) * 65);
        setProgress(progress, `Processing ${i + 1}/${lines.length} lines...`);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    furiganaOutput.innerHTML = htmlRows.join("");
    setProgress(100, "Done.");
    setStatus(`Loaded ${lines.length} line(s). Furigana level: ${getLevelRangeLabel(level)}.`);
    setTimeout(() => {
      hideProgress();
    }, 350);
  } catch (error) {
    hideProgress();
    setStatus(`Could not process furigana: ${error.message || error}`, true);
  } finally {
    setProcessingBusy(false);
  }
}

function segmentToWordXml(segment) {
  if (segment.kind === "ruby") {
    return (
      `<w:ruby>` +
      `<w:rubyPr>` +
      `<w:rubyAlign w:val="center"/>` +
      `<w:hps w:val="16"/>` +
      `<w:hpsRaise w:val="24"/>` +
      `<w:hpsBaseText w:val="24"/>` +
      `<w:lid w:val="ja-JP"/>` +
      `</w:rubyPr>` +
      `<w:rt>` +
      `<w:r>` +
      `<w:rPr><w:rFonts w:eastAsia="Yu Mincho"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>` +
      `<w:t>${escapeXml(segment.reading)}</w:t>` +
      `</w:r>` +
      `</w:rt>` +
      `<w:rubyBase>` +
      `<w:r>` +
      `<w:rPr><w:rFonts w:eastAsia="Yu Mincho"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>` +
      `<w:t>${escapeXml(segment.base)}</w:t>` +
      `</w:r>` +
      `</w:rubyBase>` +
      `</w:ruby>`
    );
  }

  return (
    `<w:r>` +
    `<w:rPr><w:rFonts w:eastAsia="Yu Mincho"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(segment.text)}</w:t>` +
    `</w:r>`
  );
}

function buildDocumentXml() {
  const paragraphs = processedLines
    .map((line) => {
      if (line.type === "blank") {
        return "<w:p/>";
      }

      const runs = line.segments.map(segmentToWordXml).join("");
      return `<w:p>${runs}</w:p>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>` +
    paragraphs +
    `<w:sectPr>` +
    `<w:pgSz w:w="11906" w:h="16838"/>` +
    `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>` +
    `</w:sectPr>` +
    `</w:body>` +
    `</w:document>`
  );
}

function buildContentTypesXml() {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`
  );
}

function buildRootRelsXml() {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`
  );
}

function createExportRenderRoot() {
  const mount = document.createElement("div");
  mount.style.position = "fixed";
  mount.style.left = "-10000px";
  mount.style.top = "0";
  mount.style.width = "794px";
  mount.style.background = "#ffffff";

  const page = document.createElement("div");
  page.style.width = "100%";
  page.style.background = "#ffffff";
  page.style.color = "#171717";
  page.style.padding = "56px 64px";
  page.style.fontFamily = '"Noto Serif JP", serif';
  page.style.fontSize = "26px";
  page.style.lineHeight = "2.1";
  page.style.wordBreak = "break-word";

  for (const line of processedLines) {
    const paragraph = document.createElement("p");
    paragraph.style.margin = "0 0 14px 0";

    if (line.type === "blank") {
      paragraph.innerHTML = "&nbsp;";
      page.appendChild(paragraph);
      continue;
    }

    for (const segment of line.segments) {
      if (segment.kind === "ruby") {
        const ruby = document.createElement("ruby");
        ruby.textContent = segment.base;

        const rt = document.createElement("rt");
        rt.textContent = segment.reading;
        rt.style.fontSize = "0.5em";
        rt.style.color = "#2e2e2e";

        ruby.appendChild(rt);
        paragraph.appendChild(ruby);
      } else {
        paragraph.appendChild(document.createTextNode(segment.text));
      }
    }

    page.appendChild(paragraph);
  }

  mount.appendChild(page);
  document.body.appendChild(mount);

  return { mount, page };
}

async function captureOutputCanvas() {
  if (typeof html2canvas === "undefined") {
    throw new Error("Image/PDF library could not be loaded.");
  }

  const { mount, page } = createExportRenderRoot();

  try {
    return await html2canvas(page, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      width: page.scrollWidth,
      height: page.scrollHeight,
      windowWidth: Math.max(document.documentElement.clientWidth, page.scrollWidth),
      windowHeight: Math.max(document.documentElement.clientHeight, page.scrollHeight)
    });
  } finally {
    mount.remove();
  }
}

async function exportImage() {
  setExportBusy(true);

  try {
    const canvas = await captureOutputCanvas();
    const imageBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!imageBlob) {
      throw new Error("Could not create image file.");
    }

    downloadBlob(imageBlob, "Announcer Script_JP_furigana.png");
    setStatus("Image exported.");
  } catch (error) {
    setStatus(`Image export failed: ${error.message || error}`, true);
  } finally {
    setExportBusy(false);
  }
}

async function exportPdf() {
  setExportBusy(true);

  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error("PDF library could not be loaded.");
    }

    const canvas = await captureOutputCanvas();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;
    const pixelsPerMm = canvas.width / usableWidth;
    const pageHeightPx = Math.max(1, Math.floor(usableHeight * pixelsPerMm));

    let currentY = 0;
    let pageIndex = 0;

    while (currentY < canvas.height) {
      const sliceHeight = Math.min(pageHeightPx, canvas.height - currentY);
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = sliceHeight;

      const context = pageCanvas.getContext("2d");
      if (!context) {
        throw new Error("Could not prepare PDF canvas context.");
      }

      context.drawImage(canvas, 0, currentY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

      if (pageIndex > 0) {
        pdf.addPage();
      }

      const sliceHeightMm = sliceHeight / pixelsPerMm;
      const imageData = pageCanvas.toDataURL("image/png");
      pdf.addImage(imageData, "PNG", margin, margin, usableWidth, sliceHeightMm, undefined, "FAST");

      currentY += sliceHeight;
      pageIndex += 1;
    }

    pdf.save("Announcer Script_JP_furigana.pdf");
    setStatus("PDF exported.");
  } catch (error) {
    setStatus(`PDF export failed: ${error.message || error}`, true);
  } finally {
    setExportBusy(false);
  }
}

async function exportDocx() {
  if (processedLines.length === 0) {
    setStatus("Nothing to export yet.", true);
    return;
  }

  if (typeof JSZip === "undefined") {
    setStatus("ZIP library could not be loaded.", true);
    return;
  }

  setExportBusy(true);

  try {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", buildContentTypesXml());
    zip.folder("_rels").file(".rels", buildRootRelsXml());
    zip.folder("word").file("document.xml", buildDocumentXml());

    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, "Announcer Script_JP_furigana.docx");

    setStatus("DOCX exported with top furigana.");
  } catch (error) {
    setStatus(`DOCX export failed: ${error.message || error}`, true);
  } finally {
    setExportBusy(false);
  }
}

playToggleBtn.addEventListener("click", toggleFullPlayback);
exportDocxBtn.addEventListener("click", openExportModal);
levelFilter.addEventListener("change", async () => {
  saveSelectedLevel(getSelectedLevel());
  await processFurigana();
});

voiceSelect.addEventListener("change", () => {
  setStoredVoiceUri(voiceSelect.value || "");

  if (!("speechSynthesis" in window)) {
    return;
  }

  window.speechSynthesis.cancel();
  resetFullPlayback();

  const pickedVoice = pickJapaneseVoice();
  if (!pickedVoice) {
    setStatus("No Japanese voice found in this browser.", true);
    return;
  }

  setStatus(`Voice selected: ${pickedVoice.name}. Press play to start.`);
});

speedSelect.addEventListener("change", () => {
  const mode = Object.prototype.hasOwnProperty.call(SPEED_RATE_MAP, speedSelect.value) ? speedSelect.value : "normal";
  speedSelect.value = mode;
  setStoredSpeedMode(mode);

  if (!("speechSynthesis" in window)) {
    return;
  }

  window.speechSynthesis.cancel();
  resetFullPlayback();
  setStatus(`Speed set to ${mode} (x${SPEED_RATE_MAP[mode].toFixed(2)}). Press play to start.`);
});

closeExportModalBtn.addEventListener("click", closeExportModal);

for (const optionBtn of exportOptionButtons) {
  optionBtn.addEventListener("click", async () => {
    closeExportModal();
    const exportType = optionBtn.dataset.exportType;

    if (exportType === "docx") {
      await exportDocx();
      return;
    }

    if (exportType === "pdf") {
      await exportPdf();
      return;
    }

    if (exportType === "image") {
      await exportImage();
    }
  });
}

exportModal.addEventListener("click", (event) => {
  if (event.target === exportModal) {
    closeExportModal();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeExportModal();
  }
});

furiganaOutput.addEventListener("click", (event) => {
  const lineButton = event.target.closest(".line-speak");
  if (lineButton) {
    speakLineOrWord(lineButton.dataset.text || "");
    return;
  }

  const ruby = event.target.closest("ruby");
  if (ruby) {
    speakLineOrWord(ruby.dataset.speak || ruby.textContent || "");
  }
});

if ("speechSynthesis" in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
} else {
  voiceSelect.disabled = true;
}

levelFilter.value = localStorage.getItem(KANJI_LEVEL_KEY) || "all";
speedSelect.value = getStoredSpeedMode();
setPlayToggleVisual("stopped");
syncControlStates();
processFurigana();
