let studyLevel = "root",
  studyId = "",
  librarySearch = "";
function chapterId(q) {
  return q.chapter || deckBy(q.deck)?.chapter;
}
function readPath() {
  let [tab, level, id] = location.hash.slice(1).split("/");
  if (tab === "Subjects") tab = "Dashboard";
  page = [
    "Quiz",
    "Saved",
    "Insights",
    "Dashboard",
    ...(data.admin ? ["Admin"] : []),
  ].includes(tab)
    ? tab
    : "Dashboard";
  questionOffset = 0;
  studyLevel = "root";
  studyId = "";
  if (
    page === "Dashboard" &&
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
const route = (level, id) => "Dashboard/" + level + "/" + id;
function metrics(level, id) {
  const m = { total: 0, seen: 0, learned: 0, ready: 0, missed: 0 };
  for (const group of data.groups) {
    if (level && group[level] !== id) continue;
    for (const key of Object.keys(m)) m[key] += group[key];
  }
  m.pct = m.total ? Math.floor(100 * m.learned / m.total) : 0;
  return m;
}
function bar(m) {
  const learning = m.seen - m.learned;
  const label = m.learned + " learned, " + learning + " learning, " + (m.total-m.seen) + " unattempted";
  return '<div class="mastery" role="img" aria-label="' + label + '" title="' + label +
    '"><span class="track"><i class="learned" style="flex:' + m.learned +
    '"></i><i class="learning" style="flex:' + learning +
    '"></i><i style="flex:' + (m.total-m.seen) + '"></i></span><b>' + m.pct + '%</b></div>';
}
function catalogueRows(level, items) {
  return items.length
    ? '<div class="catalogue">' +
        items
          .map((item, i) => {
            const m = metrics(level, item.id);
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
              { subject: "Dashboard", chapter: "Chapters", deck: "Decks" }[
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
  const level = studyLevel,
    id = studyId,
    obj = { subject: subjectBy, chapter: chapterBy, deck: deckBy }[level](id);
  const parent =
    level === "deck"
      ? chapterBy(obj.chapter)
      : level === "chapter"
        ? subjectBy(obj.subject)
        : null;
  const m = metrics(level, id);
  let result =
    back(
      parent
        ? route(level === "deck" ? "chapter" : "subject", parent.id)
        : "Dashboard",
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
  if (level === "deck" && m.total && m.seen === m.total)
    result += '<button class="outline" data-reset="' + esc(id) + '">Reset deck progress</button>';
  return result + '<h2 class="subheading">Questions</h2><div id="question-page">Loading questions…</div>';
}
let questionOffset = 0;
async function showQuestionPage() {
  const el = $("#question-page");
  if (!el) return;
  const offset = questionOffset, level = studyLevel, id = studyId;
  try {
    const rows = await rpc("page", { scope: level, item: id, page_offset: offset });
    if (!el.isConnected || offset !== questionOffset) return;
    el.innerHTML = rows.map((q,i) => {
      const status = !q.due ? "Unattempted" : q.stage >= 3 ? "Learned" : "Learning";
      return '<button class="qrow" data-practice="question" data-id="' + esc(q.id) +
        '" ' + (available(q) ? "" : "disabled") + '><span class="qnumber ' + status.toLowerCase() +
        '" aria-label="' + status + '">' + (offset+i+1) + '</span><span><strong>' + math(q.prompt) +
        '</strong><small>' + status + '</small></span></button>';
    }).join("") || '<p class="muted">No questions here yet.</p>';
    if (offset) el.innerHTML += '<button class="outline" data-offset="' + (offset-40) + '">Previous</button> ';
    if (offset+rows.length < metrics(level,id).total)
      el.innerHTML += '<button class="outline" data-offset="' + (offset+40) + '">Next page</button>';
  } catch (error) { el.textContent = error.message; }
}
function ranked(level) {
  const items = level === "subject" ? data.subjects : data.chapters;
  return items
    .map((item) => ({
      item,
      m: metrics(level,item.id),
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
function insights() {
  let html =
    '<h1>Learning insights</h1><section class="studyhead"><h2>Overall mastery</h2>' +
    bar(metrics()) +
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
          (metrics().seen
            ? "No current misses at this level."
            : "Answer a few questions to see your focus areas.") +
          "</div>");
  }
  return html;
}
