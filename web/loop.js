let studyTools = { marks: [], reports: [] },
  quiz = null,
  quizIndex = 0,
  quizSetup = false,
  clockOffset = 0,
  collection = "saved",
  editing = null,
  requestId = null;
const mobileView = matchMedia("(max-width: 680px)");
mobileView.addEventListener("change", () => {
  if (user && data) render();
});
const desktopMessage = () =>
  '<section class="panel"><h1>Question bank</h1><p>Open Quiz Loop on a desktop to add or correct questions.</p></section>';
async function refreshTools() {
  studyTools = await rpc("tools");
}
const marked = (id, kind) =>
  studyTools.marks.some((m) => m.id === id && m.kind === kind);
function questionTools(id) {
  return (
    '<div class="qtools">' +
    [
      ["saved", "Save", "Saved"],
      ["flagged", "Flag", "Flagged"],
    ]
      .map(
        ([kind, off, on]) =>
          '<button data-mark="' +
          kind +
          '" data-id="' +
          esc(id) +
          '" aria-pressed="' +
          marked(id, kind) +
          '">' +
          (marked(id, kind) ? on : off) +
          "</button>",
      )
      .join("") +
    '<button data-report="' +
    esc(id) +
    '">Report error</button></div>'
  );
}
function collectionView() {
  const qs = data.questions.filter((q) => marked(q.id, collection));
  return (
    '<h1>My collection</h1><div class="tabs">' +
    ["saved", "flagged"]
      .map(
        (k) =>
          '<button aria-pressed="' +
          (collection === k) +
          '" data-collection="' +
          k +
          '">' +
          (k === "saved" ? "Saved" : "Flagged") +
          "</button>",
      )
      .join("") +
    "</div>" +
    (qs.length
      ? qs
          .map(
            (q) =>
              '<button class="qrow" data-reference="' +
              esc(q.id) +
              '"><span><strong>' +
              math(q.prompt) +
              "</strong><small>" +
              esc(chapterBy(chapterId(q))?.name) +
              "</small></span></button>",
          )
          .join("")
      : '<div class="panel muted">Questions you ' +
        (collection === "saved" ? "save" : "flag") +
        " during practice will appear here.</div>")
  );
}
function modal(title, body) {
  dlg.innerHTML =
    '<div class="between"><h2>' +
    esc(title) +
    '</h2><button class="outline" data-action="close">Close</button></div>' +
    body;
  if (!dlg.open) dlg.showModal();
}
function reportList() {
  return (
    '<section class="panel"><h2>Question reports</h2>' +
    (studyTools.reports.length
      ? studyTools.reports
          .map(
            (r) =>
              '<button class="qrow" data-edit-report="' +
              esc(r.id) +
              '"><span><strong>' +
              esc(r.note) +
              "</strong><small>" +
              math(data.questions.find((q) => q.id === r.qid)?.prompt) +
              "</small></span></button>",
          )
          .join("")
      : '<p class="muted">No open reports.</p>') +
    "</section>"
  );
}
async function openReport(id) {
  const r = studyTools.reports.find((x) => x.id === id),
    q = await rpc("reference", { qid: r.qid });
  editing = { r, q };
  modal(
    "Review report",
    '<p class="feedback">' +
      esc(r.note) +
      '</p><form id="correct"><label class="field">Question<textarea required name="prompt">' +
      esc(q.prompt) +
      "</textarea></label>" +
      Object.entries(q.choices)
        .map(
          ([k, v], i) =>
            '<label class="field">Option ' +
            String.fromCharCode(65 + i) +
            '<input required name="' +
            esc(k) +
            '" value="' +
            esc(v) +
            '"></label>',
        )
        .join("") +
      '<label class="field">Correct option<select name="answer">' +
      Object.keys(q.choices)
        .map(
          (k, i) =>
            '<option value="' +
            esc(k) +
            '" ' +
            (q.answer === k ? "selected" : "") +
            ">Option " +
            String.fromCharCode(65 + i) +
            "</option>",
        )
        .join("") +
      '</select></label><label class="field">Explanation<textarea name="explanation">' +
      esc(q.explanation) +
      '</textarea></label><button class="primary">Save correction and resolve</button></form><button class="textbtn" data-dismiss-report="' +
      esc(id) +
      '">Resolve without editing</button>',
  );
}
function acceptQuiz(value) {
  quiz = value;
  if (!quiz) return;
  clockOffset = Date.parse(quiz.now) - Date.now();
  quizIndex = Math.min(quizIndex, quiz.cards.length - 1);
}
async function syncQuiz() {
  acceptQuiz(await rpc("quiz", { op: "state" }));
}
function remaining() {
  return Math.max(
    0,
    Math.ceil((Date.parse(quiz.deadline) - Date.now() - clockOffset) / 1000),
  );
}
function clock() {
  let n = remaining();
  return Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
}
let nextSync = 0;
setInterval(async () => {
  const label = document.querySelector("#quiz-clock");
  if (!label || !quiz || quiz.finished) return;
  label.textContent = clock();
  if (!remaining() && !busy && Date.now() > nextSync) {
    nextSync = Date.now() + 5000;
    await run(async () => {
      await syncQuiz();
      render();
    });
  }
}, 500);
function quizView() {
  if (!quiz || (quiz.finished && quizSetup))
    return (
      '<div class="intro"><h1>Timed quiz</h1></div><form class="panel stack narrow" id="new-quiz"><fieldset><legend>Subjects</legend>' +
      data.subjects
        .map(
          (s) =>
            '<label class="tick"><input type="checkbox" name="subject" value="' +
            esc(s.id) +
            '" checked>' +
            esc(s.name) +
            "</label>",
        )
        .join("") +
      '</fieldset><div class="grid"><label class="field">Questions<input type="number" min="1" max="100" required name="quantity" value="' +
      Math.max(1, Math.min(10, data.questions.length)) +
      '"></label><label class="field">Minutes<input type="number" min="1" max="180" required name="minutes" value="10"></label></div><small id="pool">' +
      data.questions.length +
      ' questions available</small><p><button class="primary" ' +
      (data.questions.length ? "" : "disabled") +
      ">Start timed quiz</button></p></form>"
    );
  if (quiz.finished) {
    let hits = quiz.cards.filter((c) => quiz.picks[c.id] === c.answer).length,
      n = Object.keys(quiz.picks).length;
    return (
      '<div class="intro"><h1>Quiz results</h1><button class="primary" data-new-quiz>New quiz</button></div><div class="panel"><h2>' +
      hits +
      " / " +
      quiz.cards.length +
      " correct</h2><p>" +
      (n - hits) +
      " incorrect · " +
      (quiz.cards.length - n) +
      " unanswered</p></div>" +
      quiz.cards
        .map(
          (c, i) =>
            '<article class="panel stack"><strong>' +
            (i + 1) +
            ". " +
            math(c.prompt) +
            "</strong><p>Your answer · " +
            (quiz.picks[c.id]
              ? math(c.choices[quiz.picks[c.id]])
              : "Unanswered") +
            "</p><p>Correct · " +
            math(c.choices[c.answer]) +
            "</p><small>" +
            math(c.explanation) +
            "</small></article>",
        )
        .join("")
    );
  }
  const c = quiz.cards[quizIndex],
    order = Object.keys(c.choices).sort(
      (a, b) => optionRank(c.id + a) - optionRank(c.id + b),
    );
  return (
    '<section class="panel narrow"><div class="between"><small>Question ' +
    (quizIndex + 1) +
    " of " +
    quiz.cards.length +
    '</small><button class="textbtn" data-nav="Dashboard">Leave quiz</button><strong id="quiz-clock">' +
    clock() +
    '</strong></div><div class="q">' +
    math(c.prompt) +
    '</div><div class="choices">' +
    order
      .map(
        (k, i) =>
          '<button class="option" data-quiz-pick="' +
          esc(k) +
          '" aria-pressed="' +
          (quiz.picks[c.id] === k) +
          '"><span class="letter">' +
          String.fromCharCode(65 + i) +
          "</span>" +
          math(c.choices[k]) +
          "</button>",
      )
      .join("") +
    '</div><div class="between"><button class="outline" data-step="-1" ' +
    (!quizIndex ? "disabled" : "") +
    ">Previous</button>" +
    (quizIndex < quiz.cards.length - 1
      ? '<button class="primary" data-step="1">Next</button>'
      : '<button class="primary" data-finish-quiz>Finish quiz</button>') +
    "</div></section>"
  );
}
function optionRank(text) {
  let hash = 2166136261;
  for (const c of quiz.id + text)
    hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return hash >>> 0;
}
document.addEventListener("change", (e) => {
  if (!e.target.closest("#new-quiz")) return;
  const ids = new FormData(e.target.form).getAll("subject");
  $("#pool").textContent =
    data.questions.filter((q) => ids.includes(chapterBy(chapterId(q))?.subject))
      .length + " questions available";
});
async function loopClick(b) {
  const v = b.dataset;
  if (v.mark) {
    const enabled = !marked(v.id, v.mark);
    await rpc("mark", { qid: v.id, kind: v.mark, enabled });
    await refreshTools();
    if (dlg.open) dlg.close();
    render();
  } else if (v.report)
    modal(
      "Report a question",
      '<form id="report-error"><input type="hidden" name="qid" value="' +
        esc(v.report) +
        '"><label class="field">What needs correcting?<textarea name="note" required maxlength="1000" placeholder="Describe the error or suggest a correction"></textarea></label><button class="primary">Send report</button></form>',
    );
  else if (v.collection) {
    collection = v.collection;
    render();
  } else if (v.reference) {
    const q = await rpc("reference", { qid: v.reference });
    modal(
      "Question reference",
      '<div class="q">' +
        math(q.prompt) +
        "</div><p><b>Correct answer</b></p><p>" +
        math(q.choices[q.answer]) +
        "</p><p>" +
        math(q.explanation) +
        "</p>" +
        questionTools(q.id),
    );
  } else if (v.editReport) await openReport(v.editReport);
  else if (v.dismissReport) {
    await rpc("resolve", { rid: v.dismissReport, changes: null });
    await refreshTools();
    dlg.close();
    render();
  } else if ("newQuiz" in v) {
    quizSetup = true;
    requestId = null;
    render();
  } else if (v.step) {
    quizIndex += Number(v.step);
    render();
  } else if (v.quizPick) {
    acceptQuiz(
      await rpc("quiz", {
        op: "pick",
        run_id: quiz.id,
        qid: quiz.cards[quizIndex].id,
        picked: v.quizPick,
      }),
    );
    render();
  } else if ("finishQuiz" in v) {
    modal(
      "Finish quiz?",
      '<p class="field">' +
        Object.keys(quiz.picks).length +
        " of " +
        quiz.cards.length +
        ' answered.</p><button class="primary" data-confirm-finish>Submit quiz</button>',
    );
  } else if ("confirmFinish" in v) {
    acceptQuiz(await rpc("quiz", { op: "finish", run_id: quiz.id }));
    dlg.close();
    render();
  } else return false;
  return true;
}
async function loopSubmit(id, form, f) {
  if (id === "report-error") {
    await rpc("report", { qid: f.qid, note: f.note });
    await refreshTools();
    dlg.close();
    toast("Report sent to the question bank administrator.");
  } else if (id === "correct") {
    const { r, q } = editing;
    await rpc("resolve", {
      rid: r.id,
      changes: {
        prompt: f.prompt,
        explanation: f.explanation,
        answer: f.answer,
        choices: Object.fromEntries(
          Object.keys(q.choices).map((k) => [k, f[k]]),
        ),
        revision: q.revision,
      },
    });
    dlg.close();
    await Promise.all([refresh(), refreshTools()]);
    render();
    toast("Correction saved.");
  } else if (id === "new-quiz") {
    const subjects = new FormData(form).getAll("subject");
    if (!subjects.length) throw Error("Select at least one subject.");
    requestId ??= crypto.randomUUID();
    acceptQuiz(
      await rpc("quiz", {
        op: "start",
        run_id: requestId,
        subjects,
        quantity: Number(f.quantity),
        minutes: Number(f.minutes),
      }),
    );
    quizIndex = 0;
    quizSetup = false;
    requestId = null;
    render();
  } else return false;
  return true;
}
