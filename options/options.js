const STORAGE_KEY = "fetchDelaySeconds";
const DEFAULT_DELAY = 3;
const MIN_DELAY = 1;
const MAX_DELAY = 60;

const input = document.getElementById("fetch-delay");
const saveBtn = document.getElementById("save-btn");
const resetBtn = document.getElementById("reset-btn");
const status = document.getElementById("status");

function showStatus(message, isError = false) {
  status.textContent = message;
  status.hidden = false;
  status.classList.toggle("error", isError);
  clearTimeout(showStatus._timer);
  showStatus._timer = setTimeout(() => {
    status.hidden = true;
  }, 3000);
}

function clamp(value) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return DEFAULT_DELAY;
  return Math.min(MAX_DELAY, Math.max(MIN_DELAY, n));
}

function load() {
  chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULT_DELAY }, (result) => {
    input.value = clamp(result[STORAGE_KEY]);
  });
}

function save(value) {
  const seconds = clamp(value);
  input.value = seconds;
  chrome.storage.sync.set({ [STORAGE_KEY]: seconds }, () => {
    if (chrome.runtime.lastError) {
      showStatus("Kaydedilemedi: " + chrome.runtime.lastError.message, true);
      return;
    }
    showStatus(`Kaydedildi — ${seconds} saniye bekleme`);
  });
}

saveBtn.addEventListener("click", () => save(input.value));

resetBtn.addEventListener("click", () => save(DEFAULT_DELAY));

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") save(input.value);
});

load();
