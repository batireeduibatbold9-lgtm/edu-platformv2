import { sb } from "./supabase.js";
import { $, toast, setContent, setTitle, escapeHtml, formatDate, openModal, closeModal } from "./ui.js";

export async function renderTeacher(page, profile){
  if(page==="dashboard") return dashboard(profile);
  if(page==="courses") return courses(profile);
  if(page==="exams") return exams(profile);
  if(page==="results") return results(profile);
  if(page==="notifications") return notifications(profile);
}

async function dashboard(profile){
  setTitle("Teacher Dashboard","Manage classes, lessons, exams and results");
  const [{count:classes},{count:subjects},{count:exams},{count:students}] = await Promise.all([
    sb.from("classes").select("*",{count:"exact",head:true}).eq("teacher_id",profile.id),
    sb.from("subjects").select("*, classes!inner(teacher_id)",{count:"exact",head:true}).eq("classes.teacher_id",profile.id),
    sb.from("exams").select("*, subjects!inner(classes!inner(teacher_id))",{count:"exact",head:true}).eq("subjects.classes.teacher_id",profile.id),
    sb.from("class_members").select("*, classes!inner(teacher_id)",{count:"exact",head:true}).eq("classes.teacher_id",profile.id)
  ]);
  setContent(`
    <div class="grid">
      <div class="card"><div class="muted">Classes</div><div class="stat">${classes||0}</div></div>
      <div class="card"><div class="muted">Subjects</div><div class="stat">${subjects||0}</div></div>
      <div class="card"><div class="muted">Exams</div><div class="stat">${exams||0}</div></div>
      <div class="card"><div class="muted">Students</div><div class="stat">${students||0}</div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Quick actions</h2>
      <div class="actions">
        <button class="primary" id="new-class">+ New class</button>
        <button class="secondary" id="new-subject">+ New subject</button>
        <button class="secondary" id="new-exam">+ New exam</button>
      </div>
    </div>`);
  $("#new-class").onclick=()=>classModal(profile);
  $("#new-subject").onclick=()=>subjectModal(profile);
  $("#new-exam").onclick=()=>examModal(profile);
}

async function courses(profile){
  setTitle("Courses","Classes, subjects, lessons and PDF materials");
  const {data,error}=await sb.from("classes").select("*, subjects(*)").eq("teacher_id",profile.id).order("created_at",{ascending:false});
  if(error)return toast(error.message);
  setContent(`
    <div class="row space"><h2>Your classes</h2><button class="primary" id="add-class">+ Class</button></div>
    <div class="grid">${(data||[]).map(c=>`
      <div class="card">
        <span class="badge">${escapeHtml(c.name)}</span>
        <h3>${escapeHtml(c.name)}</h3>
        <p class="muted">${c.subjects?.length||0} subjects</p>
        <div class="actions">
          <button class="secondary manage-class" data-id="${c.id}">Manage</button>
          <button class="primary add-subject" data-id="${c.id}">+ Subject</button>
        </div>
      </div>`).join("")||`<div class="empty">No classes yet.</div>`}</div>`);
  $("#add-class").onclick=()=>classModal(profile);
  document.querySelectorAll(".add-subject").forEach(b=>b.onclick=()=>subjectModal(profile,b.dataset.id));
  document.querySelectorAll(".manage-class").forEach(b=>b.onclick=()=>manageClass(profile,b.dataset.id));
}

async function manageClass(profile,classId){
  const {data:c}=await sb.from("classes").select("*, subjects(*)").eq("id",classId).single();
  if(!c)return;
  openModal(`
    <h2>${escapeHtml(c.name)}</h2>
    <p class="muted">Subjects</p>
    <div class="list">${(c.subjects||[]).map(s=>`
      <div class="list-item"><div class="row space"><div><b>${escapeHtml(s.name)}</b></div>
      <button class="secondary manage-subject" data-id="${s.id}">Open</button></div></div>`).join("")||"<div class='empty'>No subjects</div>"}</div>
  `);
  document.querySelectorAll(".manage-subject").forEach(b=>b.onclick=()=>manageSubject(profile,b.dataset.id));
}

async function manageSubject(profile,subjectId){
  const {data:s}=await sb.from("subjects").select("*, lessons(*)").eq("id",subjectId).single();
  if(!s)return;
  openModal(`
    <h2>${escapeHtml(s.name)}</h2>
    <button class="primary" id="add-lesson">+ Add lesson</button>
    <div class="list" style="margin-top:15px">${(s.lessons||[]).sort((a,b)=>a.lesson_order-b.lesson_order).map(l=>`
      <div class="list-item"><div class="row space"><div><b>${escapeHtml(l.title)}</b><div class="muted">${escapeHtml(l.description||"")}</div></div>
      <button class="secondary lesson-materials" data-id="${l.id}">Materials</button></div></div>`).join("")||"<div class='empty'>No lessons</div>"}</div>
  `);
  $("#add-lesson").onclick=()=>lessonModal(subjectId);
  document.querySelectorAll(".lesson-materials").forEach(b=>b.onclick=()=>materialsModal(b.dataset.id));
}

async function materialsModal(lessonId){
  const {data:lesson}=await sb.from("lessons").select("*, materials(*)").eq("id",lessonId).single();
  openModal(`
    <h2>${escapeHtml(lesson?.title||"Lesson")}</h2>
    <form id="material-form">
      <label>PDF file</label><input id="pdf" type="file" accept="application/pdf" required>
      <button class="primary full" type="submit">Upload PDF</button>
    </form>
    <div class="list" style="margin-top:15px">${(lesson?.materials||[]).map(m=>`<div class="list-item">${escapeHtml(m.title)}</div>`).join("")}</div>`);
  $("#material-form").onsubmit=async e=>{
    e.preventDefault();
    const f=$("#pdf").files[0]; if(!f)return;
    const safe=`${crypto.randomUUID()}-${f.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
    const path=`${lessonId}/${safe}`;
    const up=await sb.storage.from("materials").upload(path,f,{contentType:"application/pdf"});
    if(up.error)return toast(up.error.message);
    const ins=await sb.from("materials").insert({lesson_id:lessonId,title:f.name,file_path:path,file_type:"pdf"}).select().single();
    if(ins.error)return toast(ins.error.message);
    toast("PDF uploaded"); materialsModal(lessonId);
  };
}

async function exams(profile){
  setTitle("Exams","Create timed exams and manage questions");
  const {data,error}=await sb.from("exams").select("*, subjects(name,classes(name))").eq("teacher_id",profile.id).order("created_at",{ascending:false});
  if(error)return toast(error.message);
  setContent(`
    <div class="row space"><h2>Your exams</h2><button class="primary" id="create-exam">+ Create exam</button></div>
    <div class="list">${(data||[]).map(e=>`
      <div class="list-item">
        <div class="row space"><div><h3>${escapeHtml(e.title)}</h3><div class="muted">${escapeHtml(e.subjects?.name||"")} · ${e.duration_minutes} min</div></div>
        <span class="badge ${e.status==="published"?"success":"warn"}">${escapeHtml(e.status)}</span></div>
        <p class="muted">Start: ${formatDate(e.start_time)}<br>End: ${formatDate(e.end_time)}</p>
        <div class="actions"><button class="primary edit-exam" data-id="${e.id}">Questions</button><button class="secondary publish-exam" data-id="${e.id}">${e.status==="published"?"Unpublish":"Publish"}</button></div>
      </div>`).join("")||"<div class='empty'>No exams yet.</div>"}</div>`);
  $("#create-exam").onclick=()=>examModal(profile);
  document.querySelectorAll(".edit-exam").forEach(b=>b.onclick=()=>questionManager(b.dataset.id));
  document.querySelectorAll(".publish-exam").forEach(b=>b.onclick=()=>togglePublish(b.dataset.id));
}

async function results(profile){
  setTitle("Results","Student attempts and scores");
  const {data,error}=await sb.from("exam_attempts").select("*, exams!inner(title,teacher_id), profiles!inner(full_name,email)").eq("exams.teacher_id",profile.id).order("submitted_at",{ascending:false});
  if(error)return toast(error.message);
  setContent(`<div class="list">${(data||[]).map(a=>`
    <div class="list-item"><div class="row space"><div><b>${escapeHtml(a.profiles?.full_name||"Student")}</b><div class="muted">${escapeHtml(a.exams?.title||"")}</div></div>
    <b>${a.score ?? 0}%</b></div><div class="muted">${a.status} · ${formatDate(a.submitted_at)}</div></div>`).join("")||"<div class='empty'>No results yet.</div>"}</div>`);
}

async function notifications(profile){
  setTitle("Notifications","Teacher notifications");
  const {data,error}=await sb.from("notifications").select("*").eq("user_id",profile.id).order("created_at",{ascending:false}).limit(50);
  if(error)return toast(error.message);
  setContent(`<div class="list">${(data||[]).map(n=>`<div class="list-item"><b>${escapeHtml(n.title)}</b><p>${escapeHtml(n.message)}</p><span class="muted">${formatDate(n.created_at)}</span></div>`).join("")||"<div class='empty'>No notifications.</div>"}</div>`);
}

function classModal(profile){
  openModal(`<h2>Create class</h2><form id="class-form"><label>Name</label><input id="class-name" placeholder="10A" required><button class="primary full">Create</button></form>`);
  $("#class-form").onsubmit=async e=>{
    e.preventDefault();
    const {error}=await sb.from("classes").insert({name:$("#class-name").value.trim(),teacher_id:profile.id});
    if(error)return toast(error.message); closeModal(); courses(profile); toast("Class created");
  };
}

async function subjectModal(profile,classId){
  if(!classId){
    const {data}=await sb.from("classes").select("id,name").eq("teacher_id",profile.id);
    openModal(`<h2>Create subject</h2><form id="subject-form"><label>Class</label><select id="class-id">${(data||[]).map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}</select><label>Subject name</label><input id="subject-name" required><button class="primary full">Create</button></form>`);
  }else{
    openModal(`<h2>Create subject</h2><form id="subject-form"><input id="class-id" type="hidden" value="${classId}"><label>Subject name</label><input id="subject-name" required><button class="primary full">Create</button></form>`);
  }
  $("#subject-form").onsubmit=async e=>{
    e.preventDefault();
    const {error}=await sb.from("subjects").insert({name:$("#subject-name").value.trim(),class_id:$("#class-id").value});
    if(error)return toast(error.message); closeModal(); courses(profile); toast("Subject created");
  };
}

async function lessonModal(subjectId){
  openModal(`<h2>Add lesson</h2><form id="lesson-form"><label>Title</label><input id="lesson-title" required><label>Description</label><textarea id="lesson-desc"></textarea><label>Order</label><input id="lesson-order" type="number" value="1"><button class="primary full">Create</button></form>`);
  $("#lesson-form").onsubmit=async e=>{
    e.preventDefault();
    const {error}=await sb.from("lessons").insert({subject_id:subjectId,title:$("#lesson-title").value.trim(),description:$("#lesson-desc").value,lesson_order:Number($("#lesson-order").value)||1});
    if(error)return toast(error.message); toast("Lesson created"); manageSubject(null,subjectId);
  };
}

async function examModal(profile){
  const {data:subjects}=await sb.from("subjects").select("id,name,classes!inner(name)").eq("classes.teacher_id",profile.id);
  openModal(`<h2>Create exam</h2><form id="exam-form">
    <label>Title</label><input id="exam-title" required>
    <label>Subject</label><select id="exam-subject">${(subjects||[]).map(s=>`<option value="${s.id}">${escapeHtml(s.classes.name)} — ${escapeHtml(s.name)}</option>`).join("")}</select>
    <label>Start time</label><input id="start-time" type="datetime-local" required>
    <label>Duration (minutes)</label><input id="duration" type="number" min="1" value="30" required>
    <label>Questions per exam</label><input id="question-count" type="number" min="1" max="100" value="10">
    <button class="primary full">Create exam</button></form>`);
  $("#exam-form").onsubmit=async e=>{
    e.preventDefault();
    const start=new Date($("#start-time").value);
    const duration=Number($("#duration").value);
    const end=new Date(start.getTime()+duration*60000);
    const payload={title:$("#exam-title").value.trim(),subject_id:$("#exam-subject").value,teacher_id:profile.id,start_time:start.toISOString(),end_time:end.toISOString(),duration_minutes:duration,status:"draft"};
    const {data,error}=await sb.from("exams").insert(payload).select().single();
    if(error)return toast(error.message);
    toast("Exam created. Add questions now.");
    closeModal(); questionManager(data.id);
  };
}

async function questionManager(examId){
  const {data:exam}=await sb.from("exams").select("*, questions(*, question_options(*))").eq("id",examId).single();
  if(!exam)return;
  openModal(`<h2>${escapeHtml(exam.title)}</h2>
    <button class="primary" id="add-q">+ Add question</button>
    <div class="list" style="margin-top:15px">${(exam.questions||[]).sort((a,b)=>a.order_no-b.order_no).map((q,i)=>`
      <div class="list-item"><b>${i+1}. ${escapeHtml(q.text)}</b><div class="muted">${q.question_options?.length||0} options · ${q.points} pts</div></div>`).join("")||"<div class='empty'>No questions yet.</div>"}</div>`);
  $("#add-q").onclick=()=>questionModal(examId);
}

function questionModal(examId){
  openModal(`<h2>Add question</h2><form id="q-form">
    <label>Question</label><textarea id="q-text" required></textarea>
    <label>Points</label><input id="q-points" type="number" value="10" min="1">
    <label>Option A</label><input id="oa" required><label>Option B</label><input id="ob" required>
    <label>Option C</label><input id="oc" required><label>Option D</label><input id="od" required>
    <label>Correct option</label><select id="correct"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select>
    <button class="primary full">Save question</button></form>`);
  $("#q-form").onsubmit=async e=>{
    e.preventDefault();
    const {data:existing}=await sb.from("questions").select("order_no").eq("exam_id",examId).order("order_no",{ascending:false}).limit(1);
    const order=(existing?.[0]?.order_no||0)+1;
    const {data:q,error}=await sb.from("questions").insert({exam_id:examId,text:$("#q-text").value.trim(),points:Number($("#q-points").value),order_no:order}).select().single();
    if(error)return toast(error.message);
    const opts=["oa","ob","oc","od"].map((id,i)=>({question_id:q.id,text:$( "#"+id).value.trim(),is_correct:i===Number($("#correct").value),order_no:i+1}));
    const {error:e2}=await sb.from("question_options").insert(opts);
    if(e2)return toast(e2.message);
    toast("Question saved"); questionManager(examId);
  };
}

async function togglePublish(id){
  const {data}=await sb.from("exams").select("status").eq("id",id).single();
  const next=data.status==="published"?"draft":"published";
  const {error}=await sb.from("exams").update({status:next}).eq("id",id);
  if(error)return toast(error.message);
  exams(await sb.from("profiles").select("*").eq("id",(await sb.auth.getUser()).data.user.id).single().then(x=>x.data));
  toast(next==="published"?"Exam published":"Exam unpublished");
}
