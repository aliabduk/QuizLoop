let adminTab = "Question bank", manageKind = "deck", manageId = "";
const adminTabs = ["Question bank", "Flagged questions", "Manage catalogue", "User approvals"];
function adminWorkspace() {
  const tabs = adminTabs.map(tab => '<button data-admin-tab="' + tab + '" aria-pressed="' +
    (adminTab === tab) + '">' + tab + '</button>').join("");
  let content;
  if (adminTab === "Question bank") content = admin() + reportList();
  if (adminTab === "Manage catalogue") content = catalogueEditor();
  if (adminTab === "Flagged questions") content = '<section class="panel"><h2>Flagged questions</h2>' +
    (studyTools.flags.map(q => '<button class="qrow" data-edit-flag="' + esc(q.id) + '"><span><strong>' +
      math(q.prompt) + '</strong><small>' + q.flags + (q.flags === 1 ? ' flag' : ' flags') +
      ' · Review question</small></span></button>').join("") || '<p>No flagged questions.</p>') + '</section>';
  if (adminTab === "User approvals") content = '<section class="panel"><h2>Pending accounts</h2>' +
    (studyTools.pending.map(u => '<div class="between approval"><span>' + esc(u.email) +
      '</span><button class="outline" data-approve="' + esc(u.id) + '">Approve</button></div>').join("") ||
      '<p>No accounts awaiting approval.</p>') + '</section>';
  return '<div class="tabs admin-tabs">' + tabs + '</div>' + content;
}
function catalogueEditor() {
  const items = data[manageKind + "s"];
  const selected = items.find(x => x.id === manageId) || items[0];
  manageId = selected?.id || "";
  const path = x => {
    if (manageKind === "subject") return x.name;
    const c = manageKind === "deck" ? chapterBy(x.chapter) : x;
    return [subjectBy(c.subject)?.name, c.name, ...(manageKind === "deck" ? [x.name] : [])].join(" / ");
  };
  const options = rows => rows.map(x => '<option value="' + esc(x.id) + '" ' +
    (x.id === manageId ? "selected" : "") + '>' + esc(path(x)) + '</option>').join("");
  return '<section class="panel stack"><h2>Manage catalogue</h2><label class="field">Item type<select id="manage-kind">' +
    ["subject","chapter","deck"].map(k => '<option ' + (k === manageKind ? "selected" : "") + '>' + k + '</option>').join("") +
    '</select></label>' + (!selected ? '<p>No items at this level.</p>' :
      '<label class="field">Select ' + manageKind + '<select id="manage-item">' + options(items) +
      '</select></label><form id="rename-node"><label class="field">Name<input required name="label" value="' +
      esc(selected.name) + '"></label><button class="primary">Save name</button></form>' +
      (items.length > 1 ? '<form id="merge-node"><label class="field">Merge into<select name="dest" required><option value="">Choose destination</option>' +
      options(items.filter(x => x.id !== manageId)) + '</select></label><button class="outline">Merge</button></form>' : "") +
      '<button class="outline" data-delete-node>Delete ' + manageKind + '</button>') + '</section>';
}
document.addEventListener("change", e => {
  if (e.target.id === "manage-kind") { manageKind = e.target.value; manageId = ""; render(); }
  if (e.target.id === "manage-item") { manageId = e.target.value; render(); }
});
async function reloadAdmin() {
  await Promise.all([refresh(),refreshTools()]);
  if (dlg.open) dlg.close();
  render();
}
async function adminClick(b) {
  const v = b.dataset;
  if ("offset" in v) { questionOffset = Number(v.offset); await showQuestionPage(); }
  else if (v.adminTab) { await refreshTools(); adminTab = v.adminTab; render(); }
  else if (v.editFlag) await openReport(v.editFlag,true);
  else if (v.approve) {
    await rpc("manage",{op:"approve",kind:"user",src:v.approve});
    await reloadAdmin();
  } else if (v.deleteQuestion || "deleteNode" in v) {
    const kind = v.deleteQuestion ? "question" : manageKind, src = v.deleteQuestion || manageId;
    const name = v.deleteQuestion ? editing.q.prompt : data[kind+"s"].find(x=>x.id===src).name;
    if (confirm('Delete “' + name + '”? This permanently removes its questions, flags and practice history for all learners.')) {
      await rpc("manage",{op:"delete",kind,src});
      await reloadAdmin();
    }
  } else if (v.reset) {
    if (confirm("Restart this deck from zero? Your attempt history is kept. Only your review schedule for this deck will reset.")) {
      await rpc("reset",{did:v.reset});
      await refresh(); render();
    }
  } else return false;
  return true;
}
async function adminSubmit(id, f) {
  if (id !== "rename-node" && id !== "merge-node") return false;
  const merge = id === "merge-node";
  if (merge && !confirm("Merge into the selected destination? Questions and learner progress move with it. The source item will be removed.")) return true;
  await rpc("manage",{op:merge ? "merge" : "rename",kind:manageKind,src:manageId,...f});
  if (merge) manageId = f.dest;
  await reloadAdmin();
  return true;
}
