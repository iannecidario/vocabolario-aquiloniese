const grid = document.querySelector("#wordGrid");
const statusEl = document.querySelector("#status");
const template = document.querySelector("#wordTemplate");
const searchInput = document.querySelector("#searchInput");
const italianFilter = document.querySelector("#italianFilter");
const englishFilter = document.querySelector("#englishFilter");
const semanticFilter = document.querySelector("#semanticFilter");
const clearFilters = document.querySelector("#clearFilters");
const loadMore = document.querySelector("#loadMore");
const alphabetBar = document.querySelector("#alphabetBar");
const semanticActive = document.querySelector("#semanticActive");
const semanticActiveLabel = document.querySelector("#semanticActiveLabel");
const clearSemanticFilter = document.querySelector("#clearSemanticFilter");
const detailOverlay = document.querySelector("#detailOverlay");
const detailClose = document.querySelector("#detailClose");
const detailWord = document.querySelector("#detailWord");
const detailPhonetic = document.querySelector("#detailPhonetic");
const detailDefinition = document.querySelector("#detailDefinition");
const detailEnglish = document.querySelector("#detailEnglish");
const detailExtra = document.querySelector("#detailExtra");
const detailTags = document.querySelector("#detailTags");
const detailPlay = document.querySelector("#detailPlay");
const detailAudio = document.querySelector("#detailAudio");

let vocabulary = [];
let currentAudio = null;
let visibleLimit = 96;
let renderTimer = null;
let activeLetter = "";

const initialVisibleLimit = 96;
const visibleLimitStep = 96;
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function clean(value) {
  return String(value || "").trim();
}

function normalizeText(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function uniqueOptions(items, key) {
  return [...new Set(items.flatMap((item) => clean(item[key]).split(",").map((value) => clean(value))).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "it"));
}

function fillSelect(select, values) {
  const first = select.querySelector("option");
  select.replaceChildren(first);
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
}

function searchableText(item) {
  return [
    item.word,
    item.phonetic,
    item.definition,
    item.english,
    item.semantic,
    item.language,
    item.category
  ].map(clean).join(" ").toLowerCase();
}

function prepareItem(item) {
  const semanticValues = clean(item.semantic).split(",").map((value) => clean(value)).filter(Boolean);
  return {
    ...item,
    _definitionText: clean(item.definition).toLowerCase(),
    _englishText: clean(item.english).toLowerCase(),
    _searchText: searchableText(item),
    _lemmaInitial: normalizeText(item.word).charAt(0).toUpperCase(),
    _semanticValues: semanticValues
  };
}

function getFilteredItems() {
  const query = clean(searchInput.value).toLowerCase();
  const italian = clean(italianFilter.value).toLowerCase();
  const english = clean(englishFilter.value).toLowerCase();
  const semantic = semanticFilter.value;

  return vocabulary.filter((item) => {
    const matchesLetter = !activeLetter || item._lemmaInitial === activeLetter;
    const matchesQuery = !query || item._searchText.includes(query);
    const matchesItalian = !italian || item._definitionText.includes(italian);
    const matchesEnglish = !english || item._englishText.includes(english);
    const matchesSemantic = !semantic || item._semanticValues.includes(semantic);
    return matchesLetter && matchesQuery && matchesItalian && matchesEnglish && matchesSemantic;
  });
}

function makeTag(text, className = "") {
  const tag = document.createElement("span");
  tag.className = `tag ${className}`.trim();
  tag.textContent = text;
  return tag;
}

function makeSemanticTag(text) {
  const tag = document.createElement("button");
  tag.className = "tag semantic";
  tag.type = "button";
  tag.textContent = text;
  tag.dataset.semanticValue = text;
  tag.classList.toggle("is-active", semanticFilter.value === text);
  tag.setAttribute("aria-pressed", String(semanticFilter.value === text));
  tag.title = `Filtra per ${text}`;
  tag.addEventListener("click", (event) => {
    event.stopPropagation();
    applySemanticFilter(text);
  });
  return tag;
}

function applySemanticFilter(value) {
  semanticFilter.value = value;
  visibleLimit = initialVisibleLimit;
  updateSemanticState();
  render();
}

function updateSemanticState() {
  const value = clean(semanticFilter.value);
  semanticActive.hidden = !value;
  semanticActiveLabel.textContent = value;
}

function sortByLemma(items) {
  return [...items].sort((a, b) => clean(a.word).localeCompare(clean(b.word), "it", { sensitivity: "base" }));
}

function setElementText(element, value) {
  const text = clean(value);
  element.textContent = text;
  element.hidden = !text;
}

function makeDetailRow(label, value) {
  const text = clean(value);
  if (!text) return null;
  const row = document.createElement("section");
  row.className = "detail-row";
  const title = document.createElement("h3");
  const content = document.createElement("p");
  title.textContent = label;
  content.textContent = text;
  row.append(title, content);
  return row;
}

function localAudioSource(item, audio) {
  if (!item?.id || !audio?.id) return null;
  return {
    ...audio,
    url: `/api/audio/${encodeURIComponent(item.id)}/${encodeURIComponent(audio.id)}`
  };
}

function closeDetail() {
  detailOverlay.hidden = true;
  detailAudio.pause();
  detailAudio.removeAttribute("src");
  delete detailAudio.dataset.src;
  delete detailAudio.dataset.type;
  detailPlay.dataset.state = "idle";
  document.body.classList.remove("detail-open");
}

function openDetail(item) {
  if (currentAudio) currentAudio.pause();

  detailWord.textContent = item.word || "Senza parola";
  setElementText(detailPhonetic, item.phonetic);
  setElementText(detailDefinition, item.definition);
  setElementText(detailEnglish, item.english);
  detailExtra.replaceChildren();
  detailTags.replaceChildren();

  const firstAudio = localAudioSource(item, item.audio?.[0]);
  if (firstAudio) {
    detailAudio.dataset.src = firstAudio.url;
    detailAudio.dataset.type = firstAudio.type || "audio/mpeg";
    detailAudio.removeAttribute("src");
    detailPlay.disabled = false;
    detailPlay.title = firstAudio.filename || "Riproduci audio";
  } else {
    detailAudio.removeAttribute("src");
    delete detailAudio.dataset.src;
    delete detailAudio.dataset.type;
    detailPlay.disabled = true;
    detailPlay.title = "Nessun audio disponibile";
  }

  [
    makeDetailRow("Grammatica", item.grammar),
    makeDetailRow("Etimologia", item.etymology)
  ].filter(Boolean).forEach((row) => detailExtra.append(row));

  if (item.images?.length) {
    const gallery = document.createElement("section");
    gallery.className = "detail-row detail-gallery";
    const title = document.createElement("h3");
    title.textContent = "Immagine";
    const images = document.createElement("div");
    images.className = "detail-images";
    item.images.forEach((image) => {
      const img = document.createElement("img");
      img.src = image.url;
      img.alt = image.filename || item.word || "Immagine";
      img.loading = "lazy";
      images.append(img);
    });
    gallery.append(title, images);
    detailExtra.append(gallery);
  }

  clean(item.semantic).split(",").map((value) => clean(value)).filter(Boolean).forEach((value) => {
    detailTags.append(makeSemanticTag(value));
  });
  if (clean(item.language)) detailTags.append(makeTag(item.language));
  if (clean(item.category)) detailTags.append(makeTag(item.category, "category"));

  detailOverlay.hidden = false;
  document.body.classList.add("detail-open");
}

function playAudio(audio, play, source) {
  if (!source?.url) return;
  const nextUrl = new URL(source.url, window.location.href).href;
  if (audio.src !== nextUrl) {
    audio.src = nextUrl;
    audio.type = source.type || "audio/mpeg";
    audio.load();
  }
  if (currentAudio && currentAudio !== audio) currentAudio.pause();
  currentAudio = audio;
  if (audio.paused) {
    return audio.play()
      .then(() => {
        play.dataset.state = "playing";
      })
      .catch((error) => {
        play.dataset.state = "idle";
        console.warn("Audio non avviato:", error.message);
      });
  }
  audio.pause();
  return Promise.resolve();
}

function buildAlphabetBar() {
  alphabet.forEach((letter) => {
    const button = document.createElement("button");
    button.className = "alpha-button";
    button.type = "button";
    button.dataset.letter = letter;
    button.textContent = letter;
    alphabetBar.append(button);
  });
}

function updateActiveLetter() {
  document.querySelectorAll("[data-letter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.letter === activeLetter);
  });
}

function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, 120);
}

function render() {
  const filteredItems = sortByLemma(getFilteredItems());
  const items = filteredItems.slice(0, visibleLimit);
  grid.replaceChildren();

  items.forEach((item) => {
    const node = template.content.firstElementChild.cloneNode(true);
    const title = node.querySelector("h2");
    const phonetic = node.querySelector(".phonetic");
    const definition = node.querySelector(".definition");
    const english = node.querySelector(".english");
    const play = node.querySelector(".play");
    const audio = node.querySelector("audio");
    const tags = node.querySelector(".tags");
    const firstAudio = localAudioSource(item, item.audio?.[0]);

    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `Apri ${item.word || "vocabolo"}`);
    title.textContent = item.word || "Senza parola";
    phonetic.textContent = item.phonetic;
    definition.textContent = item.definition;
    definition.hidden = !clean(item.definition);
    english.textContent = item.english;
    english.hidden = !clean(item.english);

    clean(item.semantic).split(",").map((value) => clean(value)).filter(Boolean).forEach((value) => {
      tags.append(makeSemanticTag(value));
    });
    if (clean(item.language)) tags.append(makeTag(item.language));
    if (clean(item.category)) tags.append(makeTag(item.category, "category"));

    if (firstAudio) {
      play.title = firstAudio.filename || "Riproduci audio";
      play.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        event.preventDefault();
        playAudio(audio, play, firstAudio);
      });
      play.addEventListener("click", (event) => {
        event.stopPropagation();
        if (event.detail === 0) playAudio(audio, play, firstAudio);
      });
      audio.addEventListener("pause", () => {
        play.dataset.state = "idle";
      });
      audio.addEventListener("ended", () => {
        play.dataset.state = "idle";
      });
    } else {
      play.disabled = true;
      play.title = "Nessun audio disponibile";
    }

    node.addEventListener("click", () => openDetail(item));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetail(item);
      }
    });

    grid.append(node);
  });

  const total = vocabulary.length;
  const shown = filteredItems.length;
  const visible = items.length;
  loadMore.hidden = visible >= shown;
  setStatus(total ? `${visible} di ${shown} voci` : "Nessuna voce trovata.");
}

async function loadVocabulary() {
  try {
    const response = await fetch("/api/vocabulary");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Errore di caricamento.");

    vocabulary = sortByLemma((payload.items || []).map(prepareItem));
    fillSelect(semanticFilter, uniqueOptions(vocabulary, "semantic"));
    updateSemanticState();
    render();
  } catch (error) {
    setStatus(error.message, true);
  }
}

[searchInput, italianFilter, englishFilter, semanticFilter].forEach((control) => {
  control.addEventListener("input", () => {
    visibleLimit = initialVisibleLimit;
    if (control === semanticFilter) updateSemanticState();
    scheduleRender();
  });
});

document.querySelector(".alphabet-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-letter]");
  if (!button) return;
  activeLetter = button.dataset.letter;
  visibleLimit = initialVisibleLimit;
  updateActiveLetter();
  render();
});

clearFilters.addEventListener("click", () => {
  searchInput.value = "";
  italianFilter.value = "";
  englishFilter.value = "";
  semanticFilter.value = "";
  activeLetter = "";
  visibleLimit = initialVisibleLimit;
  updateActiveLetter();
  updateSemanticState();
  window.clearTimeout(renderTimer);
  render();
});

clearSemanticFilter.addEventListener("click", () => {
  semanticFilter.value = "";
  visibleLimit = initialVisibleLimit;
  updateSemanticState();
  render();
});

loadMore.addEventListener("click", () => {
  visibleLimit += visibleLimitStep;
  render();
});

detailClose.addEventListener("click", closeDetail);

detailOverlay.addEventListener("click", (event) => {
  if (event.target === detailOverlay) closeDetail();
});

detailPlay.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
  event.preventDefault();
  playAudio(detailAudio, detailPlay, {
    url: detailAudio.dataset.src,
    type: detailAudio.dataset.type
  });
});

detailPlay.addEventListener("click", (event) => {
  event.stopPropagation();
  if (event.detail === 0) {
    playAudio(detailAudio, detailPlay, {
      url: detailAudio.dataset.src,
      type: detailAudio.dataset.type
    });
  }
});

detailAudio.addEventListener("pause", () => {
  detailPlay.dataset.state = "idle";
});

detailAudio.addEventListener("ended", () => {
  detailPlay.dataset.state = "idle";
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !detailOverlay.hidden) closeDetail();
});

buildAlphabetBar();
loadVocabulary();
