# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A SCORM 1.2 compliant e-learning quiz package for LMS deployment. UI text is in Polish. No build system, package manager, linter, or test suite — vanilla HTML/CSS/JS only. The repo is not under git.

## Running and deploying

- **Local testing:** open `index.html` directly (`file://` works for `.js` quiz files) or serve the folder over HTTP. Without an LMS, `SCORM.init()` finds no API and returns `false`; every `SCORM.*` call becomes a no-op, so the quiz renders but nothing persists.
- **Select a quiz:** `index.html?quiz=math.js`. The default is `questions.js`. Available data files: `questions.js`, `math.js`, `biology.js`, `koty.js`, `ang.js`, `barca.js`, `motor.js`, `pilka.js`, `polski.js`. `questions.json` and `math.json` are legacy copies.
- **LMS import:** ZIP the directory contents. `math-quiz-scorm-v2.zip` is a stale snapshot (it contains `CLAUDE.md` and unused assets such as `image.png` and `math.jpeg`) — rebuild it rather than trusting it. In the LMS, point the launch URL at `index.html?quiz=<file>` to choose the quiz.
- **`imsmanifest.xml` is incomplete:** its `<resource>` lists only `index.html`, `scorm.js`, `quiz.js`, `questions.js`, `style.css`, `bg-texture.svg`, and `math_boy_1.webp`. The other quiz data files and images are not declared. Add every file you want shipped (new quiz `.js`, its `.webp` images) to the manifest, since strict LMSs may reject or omit undeclared files.

## Quiz data file

Loaded at runtime by `loadQuizData()` in `quiz.js`, which reads the `?quiz=` parameter:

- **`.js` files** (the normal path): a `<script>` tag is injected, so it works on `file://` and `http://`. The file must assign `window.QUIZ_DATA`.
- **`.json` files**: loaded with `fetch`, so they work over `http://` only.

```js
window.QUIZ_DATA = {
  title: "Quiz matematyczny 2.0",   // sets document.title
  passScore: 80,                    // percent; defaults to 80 if omitted
  images: ["a.webp", "b.webp"],     // optional; shows a random image per question
  questions: [
    { id: 1, question: "2 + 3 = ?", options: ["4","5","6","7"], correct: 1 }
  ]
};
```

- `correct` is a zero-based index into the original `options` array.
- `id` must be unique and stable. Answers and shuffles are keyed by it in the saved state.
- The UI is built for exactly 4 options: `SHAPES`/`LABELS` and the `.answer-btn.a–d` CSS classes assume 4.
- Changing a quiz's questions or ids after learners have saved progress can leave `suspend_data` inconsistent with the new data.

## Architecture

- **`scorm.js`** — the global `SCORM` object, a SCORM 1.2 API wrapper. It walks `window.parent` (up to 20 levels), then `window.opener`, to find `API`. Exposes `init`, `finish`, `getValue`, `setValue`, `save` (`LMSCommit`), and error getters. Every call is guarded by `initialized`.
- **`quiz.js`** — quiz engine and renderer, in one file with module-level globals (`QUIZ`, `PASS_SCORE`, `state`, `pendingAnswer`). It also contains all result-screen animations. It is loaded after `scorm.js` and depends on its global.
- **`index.html`** — static shell. Elements are looked up by id (`questionCard`, `answersGrid`, `bottomBar`, `nextBtn`, `resultScreen`, `restoreInfo`, …) and by class (`.quiz-image-wrap`, `.quiz-image`); renaming any of them breaks `quiz.js`.
- **`style.css`** — all styling, including the Mario-themed success/failure result screens.

## Quiz flow (`quiz.js`)

There are no Save or Submit buttons. The flow is one question at a time.

1. `window.onload`: `SCORM.init()` → `loadQuizData()` → `loadStateFromSCORM()` → render. If it fails to load, the whole `<body>` is replaced with an error message.
2. `loadStateFromSCORM()` parses `cmi.suspend_data` (JSON) into `state`. If the quiz is not yet submitted, it resumes at the first unanswered question. It also sets `lesson_status` to `incomplete` when it was empty or `not attempted`.
3. Clicking an answer only sets `pendingAnswer` and highlights the choice. The answer is committed when "Następne pytanie" (`onNext`) is clicked: it is written to `state.answers[q.id]`, saved, correct/incorrect feedback is shown, and `advance()` runs after 1200 ms. Resuming mid-quiz therefore never loses a committed answer, but an uncommitted `pendingAnswer` is not persisted.
4. Answer options are shuffled per question once. `state.shuffles[q.id][displayPos] = originalIndex` is persisted so a reload shows the same order. `state.answers` always stores the **original** option index, so compare against `q.correct` directly.
5. After the last question, `calculateResult()` computes `score = round(correct / total * 100)` and writes `score.min/max/raw` and `lesson_status` (`passed` if `score >= PASS_SCORE`, otherwise `failed`). It then sets `state.submitted = true` and saves. `showFinalResult()` renders one of three screens: score 100 gives the Mario success animation, score ≤ 20 gives "GAME OVER", and anything else gives the standard result.
6. A revisit after submission goes straight to `showFinalResult()`. There is no retake path in the UI.
7. `window.onbeforeunload` calls `saveStateToSCORM()` then `SCORM.finish()`.

`saveStateToSCORM()` always writes both `cmi.suspend_data` (the full `state` as JSON) and `cmi.core.lesson_location`, then commits. SCORM 1.2 limits `suspend_data` to 4096 characters, so quizzes with many questions (the `shuffles` map grows with them) can silently exceed it.

## SCORM 1.2 data model keys used

SCORM 1.2 uses `LMSInitialize`/`LMSFinish`/`LMSGetValue`/`LMSSetValue`/`LMSCommit`. Do not confuse these with the SCORM 2004 `Initialize` family.

| Key | Purpose |
|-----|---------|
| `cmi.suspend_data` | JSON-serialized `state`: `answers`, `shuffles`, `currentIndex`, `submitted`, `score`, `passed`, `timestamp` |
| `cmi.core.lesson_location` | Current question index |
| `cmi.core.score.raw` / `.min` / `.max` | Score as a percentage (0–100) |
| `cmi.core.lesson_status` | `incomplete`, `passed`, or `failed` |

`cmi.core.session_time` is not currently written.
