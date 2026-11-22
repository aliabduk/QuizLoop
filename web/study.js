let studyLevel = "root",
  studyId = "",
  librarySearch = "";
function chapterId(q) {
  return q.chapter || deckBy(q.deck)?.chapter;
}
function belongs(q, level, id) {
  if (level === "question") return q.id === id;
  if (level === "deck") return q.deck === id;
  const chapter = chapterId(q);
  return level === "chapter"
    ? chapter === id
    : chapterBy(chapter)?.subject === id;
}
function readPath() {
  const [tab, level, id] = location.hash.slice(1).split("/");
  page = [
    "Subjects",
    "Insights",
    "Dashboard",
    ...(data.admin ? ["Admin"] : []),
  ].includes(tab)
    ? tab
    : "Dashboard";
  studyLevel = "root";
  studyId = "";
  if (
    page === "Subjects" &&
    { subject: subjectBy, chapter: chapterBy, deck: deckBy }[level]?.(id)
  ) {
    studyLevel = level;
    studyId = id;
  }
}
function openPath(path) {
  session = null;
  if (location.hash.slice(1) === path) {
    readPath();
    render();
  } else location.hash = path;
  scrollTo(0, 0);
}
window.addEventListener("hashchange", () => {
  if (!user || !data) return;
  session = null;
  readPath();
  render();
  scrollTo(0, 0);
});
const route = (level, id) => "Subjects/" + level + "/" + id;
function metrics(qs) {
  const seen = qs.filter((q) => q.due),
    missed = seen.filter((q) => q.stage === 0).length;
  return {
    total: qs.length,
    seen: seen.length,
    missed,
    pct: qs.length ? Math.round((100 * seen.length) / qs.length) : 0,
    ready: qs.filter(available).length,
  };
}
function bar(m) {
  return (
    '<div class="progresslabel"><span>' +
    m.seen +
    " / " +
    m.total +
    " reviewed</span><strong>" +
    m.pct +
    '%</strong></div><progress aria-label="Questions reviewed" max="100" value="' +
    m.pct +
    '"></progress>'
  );
}
function catalogueRows(level, items) {
  return items.length
    ? '<div class="catalogue">' +
        items
          .map((item, i) => {
            const m = metrics(
              data.questions.filter((q) => belongs(q, level, item.id)),
            );
            const chapters =
              level === "subject"
                ? data.chapters.filter((c) => c.subject === item.id).length
                : 0;
            const detail =
              level === "subject"
                ? chapters + " chapter" + (chapters === 1 ? "" : "s")
                : m.ready + " ready to practise";
            return (
              '<button class="catalogrow" data-path="' +
              route(level, item.id) +
              '"><span class="tile ' +
              colors[i % 4] +
              '">' +
              icon(
                level === "subject"
                  ? i % 2
                    ? "matrix"
                    : "gear"
                  : level === "chapter"
                    ? "book"
                    : "layers",
                23,
              ) +
              '</span><span class="rowbody"><strong>' +
              esc(item.name) +
              "</strong><small>" +
              detail +
              "</small>" +
              bar(m) +
              '</span><span class="chev" aria-hidden="true">›</span></button>'
            );
          })
          .join("") +
        "</div>"
    : '<p class="panel muted">No ' +
        { subject: "subjects", chapter: "chapters", deck: "decks" }[level] +
        " yet.</p>";
}
function back(path, label) {
  return (
    '<button class="back" data-path="' +
    esc(path) +
    '">‹ &nbsp;' +
    esc(label) +
    "</button>"
  );
}
function matchingRows() {
  const needle = librarySearch.trim().toLowerCase();
  if (!needle) return catalogueRows("subject", data.subjects);
  const groups = [
    ["subject", data.subjects],
    ["chapter", data.chapters],
    ["deck", data.decks],
  ];
  return (
    groups
      .map(([type, items]) => {
        const found = items.filter((x) =>
          x.name.toLowerCase().includes(needle),
        );
        return found.length
          ? '<h2 class="subheading">' +
              { subject: "Subjects", chapter: "Chapters", deck: "Decks" }[
                type
              ] +
              "</h2>" +
              catalogueRows(type, found)
          : "";
      })
      .join("") ||
    '<p class="panel muted">No matching subjects, chapters or decks.</p>'
  );
}
document.addEventListener("input", (event) => {
  if (event.target.id === "library-search") {
    librarySearch = event.target.value;
    document.querySelector("#matches").innerHTML = matchingRows();
  }
});
function studyLibrary() {
  if (studyLevel === "root")
    return (
      '<div class="intro"><h1>Subjects</h1></div><input class="findstudy" id="library-search" type="search" aria-label="Search subjects, chapters and decks" placeholder="Search subjects, chapters and decks" value="' +
      esc(librarySearch) +
      '"><div id="matches">' +
      matchingRows() +
      "</div>"
    );
  const level = studyLevel,
    id = studyId,
    obj = { subject: subjectBy, chapter: chapterBy, deck: deckBy }[level](id);
  const parent =
    level === "deck"
      ? chapterBy(obj.chapter)
      : level === "chapter"
        ? subjectBy(obj.subject)
        : null;
  const qs = data.questions.filter((q) => belongs(q, level, id)),
    m = metrics(qs);
  let result =
    back(
      parent
        ? route(level === "deck" ? "chapter" : "subject", parent.id)
        : "Subjects",
      parent?.name || "Subjects",
    ) +
    '<section class="studyhead"><small>' +
    esc(level) +
    "</small><h1>" +
    esc(obj.name) +
    "</h1>" +
    bar(m) +
    '<button class="primary" data-practice="' +
    level +
    '" data-id="' +
    esc(id) +
    '" ' +
    (m.ready ? "" : "disabled") +
    ">" +
    icon("play", 15) +
    (m.ready
      ? "Practise " + level + " · " + m.ready + " ready"
      : "No questions due") +
    "</button></section>";
  if (level === "subject")
    return (
      result +
      '<h2 class="subheading">Chapters</h2>' +
      catalogueRows(
        "chapter",
        data.chapters.filter((c) => c.subject === id),
      )
    );
  const decks =
    level === "chapter" ? data.decks.filter((d) => d.chapter === id) : [];
  if (decks.length)
    result +=
      '<h2 class="subheading">Decks</h2>' + catalogueRows("deck", decks);
  result +=
    '<h2 class="subheading">' +
    (level === "chapter" ? "All chapter questions" : "Questions") +
    " <small>" +
    qs.length +
    "</small></h2>";
  return (
    result +
    (qs.length
      ? '<div class="qlist">' +
        qs
          .map(
            (q, i) =>
              '<button class="qrow" data-practice="question" data-id="' +
              esc(q.id) +
              '" ' +
              (available(q) ? "" : "disabled") +
              '><span class="qnumber">' +
              (i + 1) +
              "</span><span><strong>" +
              math(q.prompt || "Review question " + (i + 1)) +
              "</strong><small>" +
              esc(deckBy(q.deck)?.name || "Chapter question") +
              " · " +
              (q.due
                ? available(q)
                  ? "Due now"
                  : "Due " + new Date(q.due).toLocaleDateString()
                : "New") +
              "</small></span></button>",
          )
          .join("") +
        "</div>"
      : '<p class="panel muted">No questions in this ' + level + " yet.</p>")
  );
}
function ranked(level) {
  const items = level === "subject" ? data.subjects : data.chapters;
  return items
    .map((item) => ({
      item,
      m: metrics(data.questions.filter((q) => belongs(q, level, item.id))),
    }))
    .filter((x) => x.m.missed)
    .sort(
      (a, b) =>
        b.m.missed / b.m.seen - a.m.missed / a.m.seen ||
        b.m.missed - a.m.missed ||
        a.item.name.localeCompare(b.item.name),
    );
}
function focusRow(level, { item, m }) {
  return (
    '<button class="focusrow" data-path="' +
    route(level, item.id) +
    '"><span><strong>' +
    esc(item.name) +
    "</strong><small>" +
    (level === "chapter" ? esc(subjectBy(item.subject).name) + " · " : "") +
    m.missed +
    " of " +
    m.seen +
    ' reviewed questions missed on the latest attempt</small></span><span class="chev">›</span></button>'
  );
}
function focusPreview() {
  const r = ranked("chapter")[0];
  return (
    '<div class="sectionhead"><h2>Learning insights</h2><button class="textbtn" data-nav="Insights">View insights</button></div>' +
    (r
      ? focusRow("chapter", r)
      : '<div class="panel muted">' +
        (data.answered
          ? "No chapters currently have missed questions."
          : "Answer questions to see which chapters need more practice.") +
        "</div>")
  );
}
function insights() {
  let html =
    '<h1>Learning insights</h1><section class="studyhead"><h2>Overall coverage</h2>' +
    bar(metrics(data.questions)) +
    "</section>";
  for (const level of ["subject", "chapter"]) {
    const list = ranked(level);
    html +=
      '<h2 class="subheading">' +
      (level === "subject" ? "Subjects" : "Chapters") +
      " to focus on</h2>" +
      (list.length
        ? '<p class="insightnote">Highest share of questions missed on the latest attempt first.</p>' +
          list.map((x) => focusRow(level, x)).join("")
        : '<div class="panel muted">' +
          (data.answered
            ? "No current misses at this level."
            : "Answer a few questions to see your focus areas.") +
          "</div>");
  }
  return html;
}
