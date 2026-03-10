const STORAGE_KEY = "announcerSourceText";
const KANJI_LEVEL_KEY = "announcerKanjiLevel";

const sourceText = document.getElementById("sourceText");
const kanjiLevelSelect = document.getElementById("kanjiLevelSelect");
const openProcessBtn = document.getElementById("openProcessBtn");
const clearBtn = document.getElementById("clearBtn");
const charCount = document.getElementById("charCount");
const statusText = document.getElementById("status");

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

function saveText() {
  localStorage.setItem(STORAGE_KEY, sourceText.value);
}

function saveKanjiLevel() {
  localStorage.setItem(KANJI_LEVEL_KEY, kanjiLevelSelect.value);
}

function updateLiveStatus() {
  const length = sourceText.value.length;
  const level = (kanjiLevelSelect.value || "all").toUpperCase();
  charCount.textContent = `Characters: ${length}`;
  setStatus(`Saved. ${length} characters ready. Kanji filter: ${level}.`);
}

function openProcessPage() {
  const text = sourceText.value.trim();
  if (!text) {
    setStatus("Please paste text before opening process page.", true);
    return;
  }

  saveText();
  saveKanjiLevel();
  window.location.href = "./process.html";
}

function clearText() {
  sourceText.value = "";
  saveText();
  setStatus("Text cleared.");
  sourceText.focus();
}

sourceText.value = localStorage.getItem(STORAGE_KEY) || "";
kanjiLevelSelect.value = localStorage.getItem(KANJI_LEVEL_KEY) || "all";
updateLiveStatus();

sourceText.addEventListener("input", () => {
  saveText();
  updateLiveStatus();
});

kanjiLevelSelect.addEventListener("change", () => {
  saveKanjiLevel();
  updateLiveStatus();
});

sourceText.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") {
    openProcessPage();
  }
});

openProcessBtn.addEventListener("click", openProcessPage);
clearBtn.addEventListener("click", clearText);
