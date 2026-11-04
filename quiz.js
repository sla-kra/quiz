let QUIZ = [];
let PASS_SCORE = 80;

function loadQuizData() {
  const params = new URLSearchParams(window.location.search);
  const file = params.get("quiz") || "questions.js";

  function applyData(data) {
    if (!data || !Array.isArray(data.questions) || data.questions.length === 0) {
      throw new Error("Plik nie zawiera poprawnych pytań: " + file);
    }
    QUIZ = data.questions;
    PASS_SCORE = data.passScore ?? 80;
    if (data.title) document.title = data.title;
    applyQuizImage(data.images);
  }

  if (file.endsWith(".json")) {
    // JSON — wymaga http:// (nie działa z file://)
    return fetch(file)
      .then(r => { if (!r.ok) throw new Error("Nie można załadować: " + file); return r.json(); })
      .then(applyData);
  }

  // JS — wstrzyknięcie <script>, działa też z file://
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = file;
    script.onload = () => {
      try { applyData(window.QUIZ_DATA); resolve(); }
      catch (e) { reject(e); }
    };
    script.onerror = () => reject(new Error("Nie można załadować pliku: " + file));
    document.head.appendChild(script);
  });
}
const SHAPES = ["▲", "◆", "●", "■"];
const LABELS = ["a", "b", "c", "d"];

let pendingAnswer = null; // wybrana ale jeszcze niezatwierdzona odpowiedź
let advanceTimer = null;  // opóźnione przejście dalej po poprawnej odpowiedzi

const PRAISE = [
  "Super! To dobra odpowiedź.",
  "Brawo! Tak trzymaj!",
  "Świetnie! Dokładnie tak.",
  "Doskonale! Idzie Ci znakomicie.",
  "Tak jest! Poprawna odpowiedź.",
  "Rewelacja! Dobrze liczysz.",
  "Dobra robota! Jedziemy dalej.",
  "Znakomicie! Nic Cię nie zatrzyma.",
  "Pięknie! Właśnie o to chodziło.",
  "Mistrzowsko! Kolejny punkt dla Ciebie."
];

// Losowanie "z talii": każdy tekst wraca dopiero po wykorzystaniu wszystkich
// pozostałych. Na styku talii 3 ostatnio pokazane teksty trafiają na koniec
// nowej talii, więc ten sam tekst nie wraca wcześniej niż po 4 pytaniach.
let praiseDeck = [];
let recentPraise = [];

function nextPraise() {
  if (praiseDeck.length === 0) {
    const shuffled = PRAISE.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    // losujemy od końca tablicy: świeże teksty na końcu, ostatnio użyte na początku
    praiseDeck = shuffled.filter(t => recentPraise.includes(t))
      .concat(shuffled.filter(t => !recentPraise.includes(t)));
  }
  const text = praiseDeck.pop();
  recentPraise.push(text);
  if (recentPraise.length > 3) recentPraise.shift();
  return text;
}

function showPraise() {
  const el = document.getElementById("praiseToast");
  el.classList.remove("hidden");
  // restart animacji przy kolejnym pokazaniu
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
  el.textContent = nextPraise();
}

function hidePraise() {
  document.getElementById("praiseToast").classList.add("hidden");
}

let quizImages = [];
let lastImage  = null;

function applyQuizImage(images) {
  const wrap = document.querySelector(".quiz-image-wrap");
  if (Array.isArray(images) && images.length > 0) {
    quizImages = images;
    wrap.classList.remove("hidden");
  } else {
    quizImages = [];
    wrap.classList.add("hidden");
  }
}

function randomizeImage() {
  if (quizImages.length === 0) return;
  const pool = quizImages.length > 1 ? quizImages.filter(i => i !== lastImage) : quizImages;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  lastImage = picked;
  document.querySelector(".quiz-image").src = picked;
}

function defaultState() {
  return {
    answers: {},
    shuffles: {},   // question id → shuffled original-index array
    currentIndex: 0,
    retry: null,    // id-ki pytań w trwającej rundzie poprawek (null = zwykły przebieg)
    round: 0,       // liczba rozpoczętych rund poprawek
    submitted: false,
    score: null,
    passed: null,
    timestamp: null
  };
}

// Pytania aktualnego przebiegu: wszystkie albo tylko te do poprawy
function currentList() {
  return state.retry ? QUIZ.filter(q => state.retry.includes(q.id)) : QUIZ;
}

// Returns array where shuffle[displayPos] = originalIndex
function getShuffledOptions(q) {
  if (!state.shuffles[q.id]) {
    const indices = q.options.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    state.shuffles[q.id] = indices;
  }
  return state.shuffles[q.id];
}

let state = defaultState();

function safeParseSuspendData(raw) {
  if (!raw || raw === "null" || raw === "undefined") return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch (e) {
    console.warn("Cannot parse suspend_data:", e);
  }
  return null;
}

function loadStateFromSCORM() {
  const raw = SCORM.getValue("cmi.suspend_data");
  const saved = safeParseSuspendData(raw);

  if (saved) {
    state = { ...defaultState(), ...saved, answers: saved.answers || {} };

    if (state.retry && currentList().length === 0) state.retry = null;

    if (!state.submitted) {
      // Find first unanswered question to resume from
      const list = currentList();
      let firstUnanswered = list.length;
      for (let i = 0; i < list.length; i++) {
        if (state.answers[list[i].id] === undefined) {
          firstUnanswered = i;
          break;
        }
      }
      state.currentIndex = firstUnanswered;
    }

    showRestoreInfo("Przywrócono zapisany postęp.");
  }

  const lessonStatus = SCORM.getValue("cmi.core.lesson_status");
  if (!lessonStatus || lessonStatus === "not attempted") {
    SCORM.setValue("cmi.core.lesson_status", "incomplete");
    SCORM.save();
  }
}

function saveStateToSCORM() {
  state.timestamp = new Date().toISOString();
  SCORM.setValue("cmi.suspend_data", JSON.stringify(state));
  SCORM.setValue("cmi.core.lesson_location", String(state.currentIndex));
  SCORM.save();
}

function updateScoreCounter() {
  let correct = 0, wrong = 0;
  QUIZ.forEach(q => {
    const a = state.answers[q.id];
    if (a === undefined) return;
    if (a === q.correct) correct++; else wrong++;
  });
  document.getElementById("correctCount").textContent = correct;
  document.getElementById("wrongCount").textContent = wrong;
}

function updateTopBar() {
  updateScoreCounter();
  const total = currentList().length;
  const current = Math.min(state.currentIndex + 1, total);
  document.getElementById("questionCounter").textContent =
    (state.retry ? "Poprawa " : "Pytanie ") + current + "/" + total;
  document.getElementById("progressFill").style.width =
    Math.round((state.currentIndex / total) * 100) + "%";
}

function renderCurrentQuestion() {
  randomizeImage();
  const q = currentList()[state.currentIndex];
  const alreadyAnswered = state.answers[q.id] !== undefined;

  document.getElementById("questionCard").textContent = q.question;
  updateTopBar();

  const grid = document.getElementById("answersGrid");
  grid.innerHTML = "";

  const shuffle = getShuffledOptions(q);   // shuffle[displayPos] = originalIndex

  shuffle.forEach((origIdx, displayPos) => {
    const btn = document.createElement("button");
    btn.className = "answer-btn " + LABELS[displayPos];

    const shape = document.createElement("span");
    shape.className = "shape";
    shape.textContent = SHAPES[displayPos];

    const text = document.createElement("span");
    text.textContent = q.options[origIdx];

    btn.appendChild(shape);
    btn.appendChild(text);

    if (alreadyAnswered) {
      btn.disabled = true;
      if (origIdx === q.correct) {
        btn.classList.add("reveal-correct");
      } else if (state.answers[q.id] === origIdx) {
        btn.classList.add("incorrect");
      }
    } else {
      btn.addEventListener("click", () => onAnswerClick(origIdx));
    }

    grid.appendChild(btn);
  });

  const bottomBar = document.getElementById("bottomBar");
  if (alreadyAnswered) {
    bottomBar.classList.remove("hidden");
    updateNextButton();
  } else {
    bottomBar.classList.add("hidden");
  }
}

function onAnswerClick(origIdx) {
  pendingAnswer = origIdx;

  const q = currentList()[state.currentIndex];
  const shuffle = state.shuffles[q.id];
  document.querySelectorAll(".answer-btn").forEach((btn, displayPos) => {
    btn.classList.toggle("selected", shuffle[displayPos] === origIdx);
  });

  document.getElementById("bottomBar").classList.remove("hidden");
  updateNextButton();
}

function updateNextButton() {
  const isLast = state.currentIndex === currentList().length - 1;
  document.getElementById("nextBtn").textContent =
    isLast ? "Zobacz wynik →" : "Następne pytanie →";
}

function onNext() {
  if (pendingAnswer !== null) {
    // Zatwierdź odpowiedź i pokaż feedback
    const q = currentList()[state.currentIndex];
    state.answers[q.id] = pendingAnswer;
    saveStateToSCORM();
    updateScoreCounter();

    const selected = pendingAnswer;
    pendingAnswer = null;

    const shuffle = state.shuffles[q.id];
    document.querySelectorAll(".answer-btn").forEach((btn, displayPos) => {
      const origIdx = shuffle[displayPos];
      btn.disabled = true;
      btn.classList.remove("selected");
      if (origIdx === q.correct) {
        btn.classList.add(selected === origIdx ? "correct" : "reveal-correct");
      } else if (origIdx === selected) {
        btn.classList.add("incorrect");
      }
    });

    document.getElementById("bottomBar").classList.add("hidden");
    if (selected === q.correct) {
      showPraise();
      advanceTimer = setTimeout(advance, 1200);
    } else {
      showWrongAnswerModal(q);
    }
    return;
  }

  advance();
}

function showWrongAnswerModal(q) {
  document.getElementById("wrongQuestion").textContent = q.question;
  document.getElementById("wrongCorrectAnswer").textContent = q.options[q.correct];

  const btn = document.getElementById("wrongContinueBtn");
  btn.textContent = state.currentIndex === currentList().length - 1 ? "Zobacz wynik →" : "Dalej →";

  document.getElementById("wrongModal").classList.remove("hidden");
  btn.focus();
}

function onWrongContinue() {
  document.getElementById("wrongModal").classList.add("hidden");
  advance();
}

function restartQuiz() {
  clearTimeout(advanceTimer);
  advanceTimer = null;
  hidePraise();
  pendingAnswer = null;
  state = defaultState();
  saveStateToSCORM();

  document.getElementById("restartModal").classList.add("hidden");
  showQuestionScreen();
  renderCurrentQuestion();
}

// Cofnij ekran wyniku, jeśli był pokazany
function showQuestionScreen() {
  const screen = document.getElementById("resultScreen");
  screen.classList.add("hidden");
  screen.classList.remove("mario-success", "mario-failure");
  screen.innerHTML = "";
  document.getElementById("questionWrap").classList.remove("hidden");
  document.getElementById("answersGrid").classList.remove("hidden");
}

// Runda poprawek: wraca tylko do pytań, na które odpowiedź była błędna
function startRetryRound() {
  clearTimeout(advanceTimer);
  advanceTimer = null;
  pendingAnswer = null;

  const wrongIds = QUIZ
    .filter(q => state.answers[q.id] !== q.correct)
    .map(q => q.id);
  if (wrongIds.length === 0) return;

  wrongIds.forEach(id => {
    delete state.answers[id];
    delete state.shuffles[id];   // nowa kolejność odpowiedzi
  });
  state.retry = wrongIds;
  state.round++;
  state.currentIndex = 0;
  state.submitted = false;
  saveStateToSCORM();

  showQuestionScreen();
  renderCurrentQuestion();
}

function advance() {
  hidePraise();
  state.currentIndex++;
  if (state.currentIndex >= currentList().length) {
    calculateResult();
  } else {
    renderCurrentQuestion();
  }
}

function calculateResult() {
  let correctCount = 0;
  QUIZ.forEach(q => {
    if (state.answers[q.id] === q.correct) correctCount++;
  });

  const score = Math.round((correctCount / QUIZ.length) * 100);
  const passed = score >= PASS_SCORE;

  state.retry = null;
  state.submitted = true;
  state.score = score;
  state.passed = passed;

  SCORM.setValue("cmi.core.score.min", "0");
  SCORM.setValue("cmi.core.score.max", "100");
  SCORM.setValue("cmi.core.score.raw", String(score));
  SCORM.setValue("cmi.core.lesson_status", passed ? "passed" : "failed");
  saveStateToSCORM();

  showFinalResult();
}

function showFinalResult() {
  const correctCount = QUIZ.filter(q => state.answers[q.id] === q.correct).length;

  document.getElementById("questionWrap").classList.add("hidden");
  document.getElementById("answersGrid").classList.add("hidden");
  document.getElementById("bottomBar").classList.add("hidden");
  document.getElementById("questionCounter").textContent = "Quiz zakończony";
  updateScoreCounter();
  document.getElementById("progressFill").style.width = "100%";

  const screen = document.getElementById("resultScreen");
  screen.classList.remove("hidden");

  if (state.score === 100) {
    showMarioSuccess(screen, correctCount);
  } else if (state.score <= 20) {
    showMarioFailure(screen, correctCount);
  } else {
    screen.innerHTML = `
      <div class="trophy">${state.passed ? "🏆" : "📚"}</div>
      <h2>${state.passed ? "Brawo!" : "Nie tym razem"}</h2>
      <div class="score-big">${state.score}%</div>
      <p>Poprawne odpowiedzi: ${correctCount} / ${QUIZ.length}</p>
      <span class="status-badge ${state.passed ? "passed" : "failed"}">
        ${state.passed ? "ZALICZONO" : "NIEZALICZONE"}
      </span>
    `;
  }

  const wrongCount = QUIZ.length - correctCount;
  if (wrongCount > 0) {
    // ekran "GAME OVER" pokazuje swoje elementy do ok. 3 s
    appendRetryPrompt(screen, wrongCount, state.score <= 20 ? 3 : 0.4);
  }
}

// Na końcu podsumowania: pytanie, czy poprawić błędne odpowiedzi
function appendRetryPrompt(screen, wrongCount, delaySec) {
  const box = document.createElement("div");
  box.className = "retry-prompt";
  box.style.animationDelay = delaySec + "s";

  const text = document.createElement("p");
  text.textContent = "Niepoprawne odpowiedzi: " + wrongCount + ". Czy chcesz je poprawić?";

  const actions = document.createElement("div");
  actions.className = "retry-actions";

  const yes = document.createElement("button");
  yes.type = "button";
  yes.textContent = "Tak, popraw";
  yes.addEventListener("click", startRetryRound);

  const no = document.createElement("button");
  no.type = "button";
  no.className = "secondary";
  no.textContent = "Nie";
  no.addEventListener("click", () => box.remove());

  actions.append(yes, no);
  box.append(text, actions);
  screen.appendChild(box);
}

function showMarioSuccess(screen, correctCount) {
  screen.classList.add("mario-success");
  screen.innerHTML = `
    <div class="level-clear-text">✨ LEVEL CLEAR! ✨</div>
    <div class="mario-hero">🍄</div>
    <div class="score-big golden">100%</div>
    <p>Wszystkie odpowiedzi poprawne! ${correctCount}/${QUIZ.length}</p>
    <span class="status-badge passed" style="margin-top:20px">ZALICZONO</span>
  `;

  // Coins flying up continuously
  let coinWave = 0;
  const coinInterval = setInterval(() => {
    for (let i = 0; i < 4; i++) {
      const coin = document.createElement("div");
      coin.className = "coin-particle";
      coin.textContent = "🪙";
      coin.style.left = (4 + Math.random() * 92) + "%";
      coin.style.bottom = "-10px";
      coin.style.animationDuration = (0.8 + Math.random() * 0.65) + "s";
      coin.style.animationDelay = (Math.random() * 0.15) + "s";
      screen.appendChild(coin);
      setTimeout(() => coin.remove(), 1700);
    }
    if (++coinWave > 24) clearInterval(coinInterval);
  }, 160);

  // Fireworks bursting at random positions
  const fwColors = ["#FFD700", "#FF69B4", "#00FFFF", "#FF4500", "#7FFF00", "#FF1493", "#fff"];
  let fwWave = 0;
  const fwInterval = setInterval(() => {
    const cx = 10 + Math.random() * 80;
    const cy = 8  + Math.random() * 65;
    for (let i = 0; i < 14; i++) {
      const dot = document.createElement("div");
      dot.className = "firework-dot";
      dot.style.left = cx + "%";
      dot.style.top  = cy + "%";
      dot.style.background = fwColors[Math.floor(Math.random() * fwColors.length)];
      screen.appendChild(dot);
      const angle = (i / 14) * 2 * Math.PI;
      const dist  = 55 + Math.random() * 65;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      // double rAF so transition fires after element is in DOM
      requestAnimationFrame(() => requestAnimationFrame(() => {
        dot.style.transform = `translate(${dx}px, ${dy}px) scale(0)`;
        dot.style.opacity   = "0";
      }));
      setTimeout(() => dot.remove(), 850);
    }
    if (++fwWave > 14) clearInterval(fwInterval);
  }, 380);
}

function showMarioFailure(screen, correctCount) {
  screen.classList.add("mario-failure");
  screen.innerHTML = `
    <div class="mario-death-char">💀</div>
    <div class="game-over-text">GAME OVER</div>
    <div class="game-over-sub">
      <div class="score-big" style="color:#ff4444;margin-top:16px">${state.score}%</div>
      <p style="margin-top:10px">Poprawne odpowiedzi: ${correctCount} / ${QUIZ.length}</p>
      <span class="status-badge failed" style="margin-top:20px">NIEZALICZONE</span>
    </div>
  `;
}

function showRestoreInfo(message) {
  const el = document.getElementById("restoreInfo");
  el.textContent = message;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3000);
}

window.onload = async function () {
  SCORM.init();

  try {
    await loadQuizData();
  } catch (e) {
    document.body.innerHTML =
      `<div style="color:white;font-family:sans-serif;padding:40px;text-align:center">
         <h2>Błąd ładowania quizu</h2>
         <p>${e.message}</p>
         <p style="opacity:.6;font-size:14px">Sprawdź parametr <code>?quiz=</code> w adresie URL.</p>
       </div>`;
    return;
  }

  loadStateFromSCORM();

  if (state.submitted) {
    showFinalResult();
  } else if (state.currentIndex >= currentList().length) {
    calculateResult();
  } else {
    renderCurrentQuestion();
  }

  document.getElementById("nextBtn").addEventListener("click", onNext);
  document.getElementById("wrongContinueBtn").addEventListener("click", onWrongContinue);

  const restartModal = document.getElementById("restartModal");
  document.getElementById("restartBtn").addEventListener("click", () => {
    restartModal.classList.remove("hidden");
    document.getElementById("restartCancelBtn").focus();
  });
  document.getElementById("restartCancelBtn").addEventListener("click", () => {
    restartModal.classList.add("hidden");
  });
  document.getElementById("restartConfirmBtn").addEventListener("click", restartQuiz);
};

window.onbeforeunload = function () {
  saveStateToSCORM();
  SCORM.finish();
};
