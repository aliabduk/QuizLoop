const $ = (s) => document.querySelector(s),
  app = $("#app"),
  dlg = $("#dialog");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  layers: "M3 8l9-5 9 5-9 5z M3 12l9 5 9-5 M3 16l9 5 9-5",
  home: "M3 10l9-7 9 7v10h-6v-7H9v7H3z",
  book: "M3 4q6-2 9 2 3-4 9-2v14q-6-2-9 2-3-4-9-2z M12 6v14",
  clock: "M12 3a9 9 0 1 0 .1 0 M12 7v6l4 2",
  check: "M3 12l6 6L21 6",
  chart: "M4 20V10 M11 20V4 M18 20v-7",
  calendar: "M3 6h18v15H3z M7 3v6 M17 3v6 M3 11h18",
  play: "M7 4l13 8-13 8z",
  shaft: "M3 10h18v4H3z M6 6v12 M18 6v12",
  heat: "M5 19c-5-5 6-8 1-15 M12 19c-5-5 6-8 1-15 M19 19c-5-5 6-8 1-15",
  drop: "M12 2C9 7 4 11 4 15a8 8 0 0 0 16 0c0-4-5-8-8-13z",
  matrix: "M8 3H4v18h4 M16 3h4v18h-4 M9 8h1 M14 8h1 M9 15h1 M14 15h1",
  gear: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
  user: "M8 8a4 4 0 1 0 8 0 4 4 0 1 0-8 0 M4 21a8 8 0 0 1 16 0",
  volume: "M3 9h4l5-5v16l-5-5H3z M16 8q5 4 0 8",
};
const icon = (n, size = 20) =>
  '<svg width="' +
  size +
  '" height="' +
  size +
  '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' +
  paths[n] +
  '"/></svg>';
function math(text) {
  return String(text ?? "")
    .split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g)
    .map((s) =>
      s.startsWith("$") && s.endsWith("$") && s.length > 2
        ? katex.renderToString(
            s.startsWith("$$") ? s.slice(2, -2) : s.slice(1, -1),
            {
              displayMode: s.startsWith("$$"),
              throwOnError: false,
              trust: false,
            },
          )
        : esc(s).replace(/\n/g, "<br>"),
    )
    .join("");
}
const colors = ["sage", "sand", "blue", "lilac"],
  symbols = ["shaft", "heat", "drop", "matrix"];
let db,
  user,
  data = null,
  page = "Dashboard",
  session = null,
  sound = localStorage.getItem("recall-muted") !== "1",
  ac,
  busy = false,
  adminMode = "Question",
  importRows = [],
  adminMessage = "",
  toastTimer;
function toast(s) {
  $("#toast").textContent = s;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").textContent = ""), 4500);
}
async function rpc(name, args = {}) {
  let { data: d, error } = await db.rpc("recall_" + name, args);
  if (error) throw Error(error.message);
  return d;
}
async function refresh() {
  data = await rpc("dashboard");
}
function available(q) {
  return !q.due || new Date(q.due) <= new Date();
}
const deckBy = (id) => data.decks.find((d) => d.id === id),
  chapterBy = (id) => data.chapters.find((c) => c.id === id),
  subjectBy = (id) => data.subjects.find((s) => s.id === id);
function nav(p, ic) {
  return (
    '<button class="nav ' +
    (page === p ? "on" : "") +
    '" data-nav="' +
    p +
    '">' +
    icon(ic) +
    esc(p) +
    "</button>"
  );
}
function render() {
  document.body.classList.toggle(
    "reading",
    Boolean(session || (page === "Quiz" && quiz && !quiz.finished)),
  );
  let title = session ? "Revision session" : page;
  app.innerHTML =
    '<aside class="side"><div class="brand"><span class="mark">' +
    icon("layers", 24) +
    "</span>Quiz Loop</div>" +
    nav("Dashboard", "home") +
    nav("Quiz", "clock") +
    nav("Saved", "layers") +
    nav("Insights", "chart") +
    (data.admin ? nav("Admin", "gear") : "") +
    '<div class="bottom"><button class="nav" data-action="sound">' +
    icon("volume") +
    "Sound " +
    (sound ? "on" : "off") +
    '</button></div></aside><div class="shell"><header class="top"><div><span class="mobilebrand mark">' +
    icon("layers", 18) +
    "</span>Quiz Loop <span>/</span> <strong>" +
    title +
    '</strong></div><button data-action="account" class="row"><span class="avatar">' +
    icon("user", 17) +
    "</span>" +
    "My account" +
    '</button></header><main class="wrap" id="main"></main></div>';
  $("#main").innerHTML = session
    ? review()
    : page === "Admin" && data.admin
      ? adminWorkspace()
      : page === "Quiz"
        ? quizView()
        : page === "Saved"
          ? collectionView()
          : page === "Dashboard" && studyLevel !== "root"
            ? studyLibrary()
            : page === "Insights"
              ? insights()
              : dashboard();
  showQuestionPage();
}
function dashboard() {
  const m = metrics(), fresh = m.total - m.seen, due = m.ready - fresh;
  return (
    '<div class="intro"><h1>Today</h1><small>' +
    esc(
      new Date().toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    ) +
    '</small></div><section class="today"><h2>Daily practice</h2><p>' +
    due +
    " due for review · " +
    fresh +
    ' new questions</p><button class="light" data-action="start" ' +
    (m.ready ? "" : "disabled") +
    ">" +
    icon("play", 16) +
    (m.ready ? "Start practice" : "All caught up") +
    '</button></section><div class="sectionhead"><h2>Your subjects</h2></div><input class="findstudy" id="library-search" type="search" aria-label="Search subjects, chapters and decks" placeholder="Search subjects, chapters and decks" value="' +
    esc(librarySearch) + '"><div id="matches">' + matchingRows() + '</div>' 
  );
}
function shuffle(xs) {
  for (let i = xs.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}
async function start(level, id) {
  session = { level: level || "all", id: id || null, idx: 0, hits: 0 };
  try { await loadCard(); } catch (e) { session = null; throw e; }
}
async function loadCard() {
  const s = session, midnight = new Date();
  midnight.setHours(0,0,0,0);
  const card = await rpc("next", {scope:s.level, item:s.id, day_start:midnight.toISOString()});
  if (session !== s) return;
  s.card = card;
  s.result = null;
  if (card) {
    s.order = shuffle(Object.keys(card.choices));
    s.token = crypto.randomUUID();
    s.pending = null;
  }
  render();
  scrollTo(0, 0);
}
function review() {
  let s = session;
  if (!s.card)
    return (
      '<div class="narrow panel stack"><span class="tile sage">' +
      icon("check") +
      "</span><h1>Session complete</h1><p>" +
      s.hits +
      " correct out of " +
      s.idx +
      '. Your next reviews are scheduled.</p><button class="primary" data-action="end">Return to study</button></div>'
    );
  let q = s.card,
    r = s.result,
    d = deckBy(q.deck) || chapterBy(q.chapter);
  return (
    '<div class="narrow"><div class="intro"><h2>' +
    esc(d?.name) +
    '</h2><button class="outline" data-action="end">End session</button></div><section class="panel"><div class="between"><small>Question ' +
    (s.idx + 1) +
    '</small><button class="textbtn" data-action="sound">Sound ' +
    (sound ? "on" : "off") +
    '</button></div><div class="q">' +
    math(q.prompt) +
    '</div><div class="choices">' +
    s.order
      .map(
        (k, i) =>
          '<button class="option ' +
          (r ? (k === r.answer ? "good" : k === s.pick ? "bad" : "") : "") +
          '" data-pick="' +
          esc(k) +
          '" ' +
          (r || (s.pending && s.pending !== k) ? "disabled" : "") +
          '><span class="letter">' +
          String.fromCharCode(65 + i) +
          "</span><span>" +
          math(q.choices[k]) +
          "</span>" +
          (r && k === r.answer ? icon("check") : "") +
          "</button>",
      )
      .join("") +
    "</div>" +
    (r
      ? '<div class="feedback" role="status"><b>' +
        (s.pick === r.answer
          ? "Correct"
          : "Incorrect · Correct answer highlighted") +
        "</b><p>" +
        math(r.explanation) +
        '</p></div><button class="primary" data-action="next">Next question' +
        "</button>"
      : "") +
    questionTools(q.id) +
    "</section></div>"
  );
}
function beep() {
  if (!sound || !ac) return;
  [660, 880].forEach((f, i) => {
    let o = ac.createOscillator(),
      g = ac.createGain(),
      t = ac.currentTime + i * 0.09;
    o.frequency.value = f;
    o.connect(g);
    g.connect(ac.destination);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.075, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.start(t);
    o.stop(t + 0.15);
  });
}
async function answer(key) {
  let s = session;
  if (!s || s.result) return;
  if (sound) {
    try {
      ac ??= new AudioContext();
      await ac.resume();
    } catch {}
  }
  s.pending = key;
  const r = await rpc("answer", {
    qid: s.card.id,
    picked: key,
    attempt: s.token,
  });
  s.pick = key;
  s.result = r;
  if (key === r.answer) {
    s.hits++;
    beep();
  }
  render();
}
const headers = [
  "Subject",
  "Chapter",
  "Deck",
  "Question",
  "Option A",
  "Option B",
  "Option C",
  "Option D",
  "Explanation",
];
const field = (label, name, extra = "") =>
  '<label class="field">' +
  label +
  '<input name="' +
  name +
  '" ' +
  extra +
  "></label>";
const heros = ["Subject", "Chapter", "Deck", "Question", "Excel import"];
function admin() {
  const n = heros.indexOf(adminMode);
  const datalist = (id, items) =>
    '<datalist id="' +
    id +
    '">' +
    [...new Set(items.map((x) => x.name))]
      .map((x) => '<option value="' + esc(x) + '"></option>')
      .join("") +
    "</datalist>";
  return (
    '<div class="intro"><h1>Question bank</h1><span class="chip">Administrator</span></div><div class="panel"><label class="field">Add to question bank<select id="mode">' +
    heros
      .map(
        (x) =>
          "<option " +
          (x === adminMode ? "selected" : "") +
          ">" +
          x +
          "</option>",
      )
      .join("") +
    "</select></label>" +
    (n === 4
      ? '<div class="stack"><p>Use the first worksheet. Enter the correct answer under Option A. Leave Deck blank to add a question directly to the chapter. Options C and D are optional. Up to 1,000 rows per import.</p><button class="outline" data-action="template">Download Excel template</button><label class="field">Select workbook<input type="file" id="workbook" accept=".xlsx"></label><p id="import-info">' +
        esc(adminMessage) +
        '</p><button class="primary" data-action="import" ' +
        (!importRows.length ? "disabled" : "") +
        ">Import questions</button></div>"
      : '<form id="editor">' +
        field("Subject", "subject", 'list="subjects" required') +
        datalist("subjects", data.subjects) +
        (n > 0
          ? field("Chapter", "chapter", 'list="chapters" required') +
            datalist("chapters", data.chapters)
          : "") +
        (n > 1
          ? field(
              n === 3 ? "Deck (optional)" : "Deck",
              "deck",
              n === 3 ? 'list="decknames"' : 'list="decknames" required',
            ) + datalist("decknames", data.decks)
          : "") +
        (n === 3
          ? '<label class="field">Question<textarea name="prompt" required></textarea></label><p class="muted">Type formulas between $ signs, for example $T/J = G\\theta/L$.</p><div class="grid">' +
            ["A (correct)", "B", "C (optional)", "D (optional)"]
              .map((x, i) =>
                field("Option " + x, "o" + i, i < 2 ? "required" : ""),
              )
              .join("") +
            '</div><label class="field">Explanation<textarea name="explanation"></textarea></label><div class="feedback" id="preview">Formula preview</div>'
          : "") +
        '<button class="primary">Save ' +
        adminMode.toLowerCase() +
        "</button></form>") +
    "</div>"
  );
}
function template() {
  let wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      headers,
      [
        "Mechanical Engineering",
        "Mechanics of Solids",
        "Torsion of shafts",
        "For a uniform circular shaft, which expression gives the angle of twist?",
        "$TL/(GJ)$",
        "$GJ/(TL)$",
        "$TJ/(GL)$",
        "$GL/(TJ)$",
        "Assume linear elasticity and constant torque.",
      ],
    ]),
    "Questions",
  );
  XLSX.writeFile(wb, "Quiz_Loop_Questions.xlsx");
}
function parseRows(sheet) {
  let [head, ...rows] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  let cols = headers.map((h) =>
    (head || []).findIndex(
      (x) => String(x).trim().toLowerCase() === h.toLowerCase(),
    ),
  );
  if ([0, 1, 3, 4, 5].some((i) => cols[i] < 0))
    throw Error("Missing required headings. Use the Excel template.");
  let items = [];
  rows.forEach((row, i) => {
    if (!row.some((v) => String(v).trim())) return;
    let [subject, chapter, deck, prompt, a, b, c, d, explanation] = cols.map(
        (j) => String(row[j] ?? "").trim(),
      ),
      options = [a, b, c, d].filter(Boolean);
    if (!subject || !chapter || !prompt || !a || !b)
      throw Error("Row " + (i + 2) + " is missing a required value.");
    if (new Set(options.map((v) => v.toLowerCase())).size !== options.length)
      throw Error("Duplicate options in row " + (i + 2) + ".");
    items.push({ subject, chapter, deck, prompt, options, explanation });
  });
  if (!items.length || items.length > 1000)
    throw Error("Choose a workbook containing 1–1,000 questions.");
  return items;
}
function account() {
  dlg.innerHTML =
    '<div class="between"><h2>My account</h2><button class="outline" data-action="close">Close</button></div><p class="field">' +
    esc(user.email) +
    '</p><button class="outline" data-action="logout">Sign out</button>';
  if (!dlg.open) dlg.showModal();
}
async function run(fn) {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } catch (e) {
    toast(e.message || "Please try again.");
    if ($("#dialog-status")) $("#dialog-status").textContent = e.message;
    if (session?.pending && !session.result) render();
  } finally {
    busy = false;
  }
}
document.addEventListener("click", (e) => {
  let b = e.target.closest("button");
  if (!b || b.disabled || busy || (b.form && b.type === "submit")) return;
  if (b.dataset.nav) {
    openPath(b.dataset.nav);
    return;
  }
  run(async () => {
    if (await adminClick(b) || await loopClick(b)) return;
    if (b.dataset.path) return openPath(b.dataset.path);
    if (b.dataset.practice) return start(b.dataset.practice, b.dataset.id);
    if (b.dataset.action === "end") {
      await refresh();
      session = null;
      render();
      return;
    }

    if (b.dataset.pick) return answer(b.dataset.pick);
    switch (b.dataset.action) {
      case "next":
        session.idx++;
        try {
          await loadCard();
        } catch (e) {
          session.idx--;
          throw e;
        }
        break;
      case "start":
        await start();
        break;
      case "account":
        account();
        break;
      case "close":
        dlg.close();
        break;
      case "sound":
        sound = !sound;
        localStorage.setItem("recall-muted", sound ? "0" : "1");
        render();
        break;
      case "template":
        template();
        break;
      case "import": {
        if (!data.chapterQuestions && importRows.some((r) => !r.deck))
          throw Error(
            "Run the updated setup.sql to import chapter questions without a deck.",
          );
        let n = await rpc("import", { items: importRows });
        adminMessage =
          n + " added, " + (importRows.length - n) + " duplicates skipped.";
        importRows = [];
        await refresh();
        render();
        break;
      }
      case "logout": {
        let { error } = await db.auth.signOut();
        if (error) throw error;
        location.reload();
        break;
      }
    }
  });
});
document.addEventListener("input", (e) => {
  if (e.target.closest("#editor") && $("#preview")) {
    let f = new FormData($("#editor"));
    $("#preview").innerHTML =
      ["prompt", "o0", "o1", "o2", "o3", "explanation"]
        .map((k) => f.get(k))
        .filter(Boolean)
        .map((x) => "<p>" + math(x) + "</p>")
        .join("") || "Formula preview";
  }
});
document.addEventListener("change", async (e) => {
  if (e.target.id === "mode") {
    adminMode = e.target.value;
    render();
  }
  if (e.target.id === "workbook") {
    let file = e.target.files[0];
    importRows = [];
    adminMessage = "";
    if (file) {
      try {
        if (file.size > 5e6)
          throw Error("Choose a workbook smaller than 5 MB.");
        let wb = XLSX.read(await file.arrayBuffer(), {
          type: "array",
          sheets: 0,
          sheetRows: 1002,
        });
        let sheet = wb.Sheets[wb.SheetNames[0]];
        if (
          sheet["!fullref"] &&
          XLSX.utils.decode_range(sheet["!fullref"]).e.r > 1000
        )
          throw Error("Split the worksheet into batches of 1,000 rows.");
        importRows = parseRows(sheet);
        adminMessage =
          importRows.length +
          " valid rows · First question: " +
          importRows[0].prompt;
      } catch (err) {
        adminMessage = err.message;
      }
    }
    render();
  }
});
document.addEventListener("submit", (e) => {
  e.preventDefault();
  let f = Object.fromEntries(new FormData(e.target)),
    id = e.target.id,
    action = e.submitter?.value;
  run(async () => {
    if (await adminSubmit(id, f) || await loopSubmit(id, e.target, f)) return;
    if (id === "auth") {
      let resp =
        action === "signup"
          ? await db.auth.signUp(f)
          : await db.auth.signInWithPassword(f);
      if (resp.error) throw resp.error;
      if (!resp.data.session) {
        $("#dialog-status").textContent =
          "Check your email to confirm your account, then sign in.";
        return;
      }
      location.reload();
    } else if (id === "editor") {
      if (adminMode === "Question" && !f.deck.trim() && !data.chapterQuestions)
        throw Error(
          "Run the updated setup.sql to enable questions without a deck.",
        );
      let item = {
        ...f,
        options: [f.o0, f.o1, f.o2, f.o3]
          .map((x) => (x || "").trim())
          .filter(Boolean),
      };
      let n = await rpc("import", { items: [item] });
      toast(
        adminMode === "Question"
          ? n
            ? "Question saved."
            : "This question already exists."
          : "Saved.",
      );
      await refresh();
      render();
    }
  });
});
async function boot() {
  const config = window.RECALL_CONFIG;
  if (!config?.url || !config?.key)
    throw Error(
      "Supabase configuration missing. Check the Vercel environment variables and redeploy.",
    );
  db = supabase.createClient(config.url, config.key);
  const { data: auth, error } = await db.auth.getSession();
  if (error) throw error;
  user = auth.session?.user;
  if (!user) {
    app.innerHTML =
      '<main class="wrap narrow"><section class="panel stack"><span class="mark">' +
      icon("layers") +
      '</span><h1>Quiz Loop</h1><p>Sign in to review your subjects and track your progress.</p><form id="auth">' +
      field("Email", "email", 'type="email" required autocomplete="email"') +
      field(
        "Password",
        "password",
        'type="password" required minlength="6" autocomplete="current-password"',
      ) +
      '<div class="row"><button class="primary" value="login">Sign in</button><button class="outline" value="signup">Create account</button></div></form><p role="status" id="dialog-status"></p></section></main>';
    return;
  }
  db.auth.onAuthStateChange((event, current) => {
    if (
      event === "SIGNED_OUT" ||
      (current?.user && current.user.id !== user.id)
    )
      location.reload();
  });
  if (!await rpc("access")) {
    app.innerHTML = '<main class="wrap narrow"><section class="panel stack"><h1>Awaiting approval</h1><p>Your account (' + esc(user.email) + ') needs administrator approval before you can practise.</p><button class="primary" onclick="location.reload()">Check approval</button><button class="outline" data-action="logout">Sign out</button></section></main>';
    return;
  }
  await Promise.all([refresh(), refreshTools(), syncQuiz()]);
  readPath();
  render();
}
boot().catch((e) => {
  app.innerHTML =
    '<main class="panel narrow stack"><h2>Workspace unavailable</h2><p>' +
    esc(e.message) +
    '</p><button class="outline" id="retry">Retry</button></main>';
  $("#retry").onclick = () => location.reload();
});
document.addEventListener("visibilitychange", () => {
  if (
    user &&
    data &&
    !document.hidden &&
    !session &&
    !busy &&
    !dlg.open &&
    page === "Dashboard"
  )
    refresh()
      .then(render)
      .catch((e) => toast(e.message));
});
setInterval(() => {
  if (!session && !busy && !dlg.open && page === "Dashboard" && $("#main"))
    refresh().then(render).catch(e => toast(e.message));
}, 60000);
