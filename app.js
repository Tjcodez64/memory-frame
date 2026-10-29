const storyBox = document.getElementById("story");
const saveButton = document.getElementById("save");
const playButton = document.getElementById("play");
const stopButton = document.getElementById("stop");
const status = document.getElementById("status");

const storageKey = "memory-frame-story";
const canSpeak = "speechSynthesis" in window;

let savedStory = "";
let currentSpeech = null;

try {
  savedStory = localStorage.getItem(storageKey) || "";
  storyBox.value = savedStory;

  if (savedStory) {
    status.textContent = "Your saved memory is ready.";
  }
} catch (error) {
  status.textContent = "Browser storage is unavailable.";
}

playButton.disabled = !savedStory || !canSpeak;

if (!canSpeak) {
  status.textContent = "Try opening this page in Chrome for voice playback.";
}

storyBox.addEventListener("input", () => {
  status.textContent = "You have unsaved changes. Tap Save memory.";
});

saveButton.addEventListener("click", () => {
  const text = storyBox.value.trim();

  if (!text) {
    status.textContent = "Write a memory first.";
    return;
  }

  savedStory = text;
  playButton.disabled = !canSpeak;

  try {
    localStorage.setItem(storageKey, savedStory);
    status.textContent = "Memory saved! Tap Touch to hear.";
  } catch (error) {
    status.textContent =
      "You can play this memory, but the browser could not save it.";
  }
});

playButton.addEventListener("click", () => {
  if (!savedStory || !canSpeak) return;

  speechSynthesis.cancel();
  currentSpeech = new SpeechSynthesisUtterance(savedStory);
  currentSpeech.lang = "en-GB";
  currentSpeech.rate = 0.9;

  currentSpeech.onstart = () => {
    status.textContent = "Telling your memory...";
  };

  currentSpeech.onend = () => {
    status.textContent = "Touch again to hear your memory.";
  };

  currentSpeech.onerror = (event) => {
    if (event.error !== "interrupted" && event.error !== "canceled") {
      status.textContent =
        "Voice playback failed. Check your media volume and try again.";
    }
  };

  speechSynthesis.speak(currentSpeech);
});

stopButton.addEventListener("click", () => {
  if (canSpeak) speechSynthesis.cancel();
  status.textContent = "Playback stopped.";
});
