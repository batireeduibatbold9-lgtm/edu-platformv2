import { sb } from "./supabase.js";
import { $, toast, setContent, setTitle, escapeHtml, formatDate, formatRemaining, openModal, closeModal } from "./ui.js";

let timerHandle=null;

export async function renderStudent(page, profile){
  clearInterval(timerHandle);
  if(page==="dashboard") return dashboard(profile);
  if(page==="courses") return courses(profile);
  if(page==="exams") return exams(profile);
  if(page==="results") return results(profile);
  if(page==="leaderboard") return leaderboard(profile);
  if(page==="notifications") return notifications(profile);
}

async function enrolledClassIds(profile){
  const {data}=await sb.from("class_members").select("class_id").eq("student_id",profile.id);
  return (data||[]).map(x=>x.class_id);
}

async function dashboard(profile){
  setTitle("Student Dashboard","Your learning overview");
  const ids=await enrolledClassIds(profile);
  const [{count:subjects},{count:attempts}]=await Promise.all([
    sb.from("subjects").select("*",{count:"exact",head:true}).in("class_id",ids.length?ids:["00000000-0000-0000-0000-000000000000"]),
    sb.from("exam_attempts").select("*",{count:"exact",head:true}).eq("student_id",profile.id)
  ]);
  setContent(`<div class="grid">
    <div class="card"><div class="muted">Subjects</div><div class="stat">${subjects||0}</div></div>
    <div class="card"><div class="muted">Exam attempts</div><div class="stat">${attempts||0}</div></div>
    <div class="card"><div class="muted">Role</div><div class="stat">Student</div></div>
  </div>
  <div class="card" style="margin-top:16px"><h2>Welcome, ${escapeHtml(profile.full_name)}</h2><p class="muted">Choose a course or open an available exam.</p></div>`);
}

async function courses(profile){
  setTitle("My Courses","Lessons and PDF materials");
  const ids=await enrolledClassIds(profile);
  const {data,error}=await sb.from("subjects").select("*, classes(name), lessons(*,materials(*))").in("class_id",ids.length?ids:["00000000-0000-0000-0000-000000000000"]);
  if(error)return toast(error.message);
  setContent(`<div class="grid">${(data||[]).map(s=>`
    <div class="card">
      <span class="badge">${escapeHtml(s.classes?.name||"Class")}</span>
      <h2>${escapeHtml(s.name)}</h2>
      <div class="muted">${s.lessons?.length||0} lessons</div>
      <div class="actions"><button class="primary open-subject" data-id="${s.id}">Open</button></div>
    </div>`).join("")||"<div class='empty'>You are not enrolled in any class.</div>"}</div>`);
  document.querySelectorAll(".open-subject").forEach(b=>b.onclick=()=>openSubject(b.dataset.id));
}

async function openSubject(id){
  const {data:s,error}=await sb.from("subjects").select("*, lessons(*,materials(*))").eq("id",id).single();
  if(error)return toast(error.message);
  openModal(`<h2>${escapeHtml(s.name)}</h2><div class="list">${(s.lessons||[]).sort((a,b)=>a.lesson_order-b.lesson_order).map(l=>`
    <div class="list-item"><h3>${escapeHtml(l.title)}</h3><p class="muted">${escapeHtml(l.description||"")}</p>
    ${(l.materials||[]).map(m=>`<div class="actions"><button class="secondary open-pdf" data-path="${escapeHtml(m.file_path)}">${escapeHtml(m.title)}</button></div>`).join("")}</div>`).join("")||"<div class='empty'>No lessons.</div>"}</div>`);
  document.querySelectorAll(".open-pdf").forEach(b=>b.onclick=()=>openPdf(b.dataset.path));
}

async function openPdf(path){
  const {data,error}=await sb.storage.from("materials").createSignedUrl(path,3600);
  if(error)return toast(error.message);
  openModal(`<h2>PDF Material</h2><iframe class="pdf-viewer" src="${data.signedUrl}"></iframe><div class="actions"><a class="primary" href="${data.signedUrl}" target="_blank" rel="noopener">Open / Download</a></div>`);
}

async function exams(profile){
  setTitle("Exams","Available and completed exams");
  const ids=await enrolledClassIds(profile);
  const {data,error}=await sb.from("exams").select("*, subjects!inner(name,class_id), exam_attempts(*)").eq("status","published").in("subjects.class_id",ids.length?ids:["00000000-0000-0000-0000-000000000000"]).order("start_time");
  if(error)return toast(error.message);
  setContent(`<div class="list">${(data||[]).map(e=>{
    const attempt=(e.exam_attempts||[]).find(a=>a.student_id===profile.id);
    const now=Date.now(), start=new Date(e.start_time).getTime(), end=new Date(e.end_time).getTime();
    const available=now>=start && now<end;
    return `<div class="list-item"><div class="row space"><div><h3>${escapeHtml(e.title)}</h3><div class="muted">${escapeHtml(e.subjects?.name||"")} · ${e.duration_minutes} min</div></div><span class="badge ${available?"success":"warn"}">${available?"OPEN":now<start?"UPCOMING":"CLOSED"}</span></div>
      <p class="muted">Start: ${formatDate(e.start_time)}<br>End: ${formatDate(e.end_time)}</p>
      ${attempt?`<div class="row space"><span class="badge success">Score: ${attempt.score??0}%</span><span>${attempt.status}</span></div>`:available?`<button class="primary start-exam" data-id="${e.id}">Start exam</button>`:""}
    </div>`;
  }).join("")||"<div class='empty'>No exams available.</div>"}</div>`);
  document.querySelectorAll(".start-exam").forEach(b=>b.onclick=()=>startExam(b.dataset.id,profile));
}

async function startExam(examId,profile){
  const {data,error}=await sb.rpc("start_exam_attempt",{p_exam_id:examId,p_student_id:profile.id});
  if(error)return toast(error.message);
  const attemptId=Array.isArray(data)?data[0]?.attempt_id:data?.attempt_id;
  if(!attemptId)return toast("Could not start exam.");
  await takeExam(attemptId,examId,profile);
}

async function takeExam(attemptId,examId,profile){
  const {data:exam,error}=await sb.from("exams").select("*, questions(*,question_options(*))").eq("id",examId).single();
  if(error)return toast(error.message);
  const {data:attempt}=await sb.from("exam_attempts").select("*").eq("id",attemptId).single();
  if(!attempt)return toast("Attempt not found.");
  let current=0;
  const questions=(exam.questions||[]).sort((a,b)=>a.order_no-b.order_no);
  setContent(`<div class="row space"><div><h2>${escapeHtml(exam.title)}</h2><div class="muted">Do not refresh unnecessarily. Answers are saved.</div></div><div id="timer" class="timer">--:--:--</div></div><div id="exam-box"></div>`);
  async function renderQ(){
    const q=questions[current];
    if(!q)return finish();
    const {data:old}=await sb.from("answers").select("*").eq("attempt_id",attemptId).eq("question_id",q.id).maybeSingle();
    $("#exam-box").innerHTML=`<div class="question"><div class="muted">Question ${current+1} / ${questions.length}</div><h2>${escapeHtml(q.text)}</h2>
      ${(q.question_options||[]).sort((a,b)=>a.order_no-b.order_no).map(o=>`<label class="option"><input type="radio" name="answer" value="${o.id}" ${old?.selected_option_id===o.id?"checked":""}> ${escapeHtml(o.text)}</label>`).join("")}
      <div class="actions"><button class="secondary" id="prev" ${current===0?"disabled":""}>Previous</button><button class="primary" id="next">${current===questions.length-1?"Submit":"Next"}</button></div></div>`;
    $("#prev").onclick=()=>{current--;renderQ()};
    $("#next").onclick=async()=>{
      const selected=document.querySelector('input[name="answer"]:checked')?.value||null;
      await saveAnswer(attemptId,q.id,selected);
      if(current===questions.length-1) finish(); else {current++;renderQ();}
    };
  }
  async function saveAnswer(aid,qid,optionId){
    const {error}=await sb.from("answers").upsert({attempt_id:aid,question_id:qid,selected_option_id:optionId},{onConflict:"attempt_id,question_id"});
    if(error)toast(error.message);
  }
  async function finish(){
    clearInterval(timerHandle);
    const {data,error}=await sb.rpc("submit_exam_attempt",{p_attempt_id:attemptId});
    if(error)return toast(error.message);
    const result=Array.isArray(data)?data[0]:data;
    setContent(`<div class="card"><h1>Exam submitted 🎉</h1><div class="stat">${result?.score??0}%</div><p class="muted">Your result has been saved.</p><button class="primary" id="back-exams">Back to exams</button></div>`);
    $("#back-exams").onclick=()=>exams(profile);
  }
  function tick(){
    const ms=new Date(attempt.ends_at).getTime()-Date.now();
    $("#timer").textContent=formatRemaining(ms);
    if(ms<=0){ clearInterval(timerHandle); finish(); }
  }
  tick(); timerHandle=setInterval(tick,1000);
  await renderQ();
}

async function results(profile){
  setTitle("My Results","Your exam history");
  const {data,error}=await sb.from("exam_attempts").select("*, exams(title,subjects(name))").eq("student_id",profile.id).order("created_at",{ascending:false});
  if(error)return toast(error.message);
  setContent(`<div class="list">${(data||[]).map(a=>`<div class="list-item"><div class="row space"><div><h3>${escapeHtml(a.exams?.title||"Exam")}</h3><div class="muted">${escapeHtml(a.exams?.subjects?.name||"")}</div></div><b>${a.score??0}%</b></div><div class="muted">${a.status} · ${formatDate(a.submitted_at)}</div></div>`).join("")||"<div class='empty'>No results yet.</div>"}</div>`);
}

async function leaderboard(profile){
  setTitle("Leaderboard","Your class exam rankings");
  const {data,error}=await sb.from("leaderboard").select("*").order("score",{ascending:false}).limit(100);
  if(error)return toast(error.message);
  setContent(`<div class="card"><h2>🏆 Leaderboard</h2>${(data||[]).map((r,i)=>`<div class="leaderboard-row"><b>#${i+1}</b><span>${escapeHtml(r.full_name||"Student")}<br><small class="muted">${escapeHtml(r.exam_title||"")}</small></span><b>${r.score}%</b></div>`).join("")||"<div class='empty'>No scores yet.</div>"}</div>`);
}

async function notifications(profile){
  setTitle("Notifications","Messages about your courses and exams");
  const {data,error}=await sb.from("notifications").select("*").eq("user_id",profile.id).order("created_at",{ascending:false}).limit(50);
  if(error)return toast(error.message);
  setContent(`<div class="list">${(data||[]).map(n=>`<div class="list-item"><b>${escapeHtml(n.title)}</b><p>${escapeHtml(n.message)}</p><span class="muted">${formatDate(n.created_at)}</span></div>`).join("")||"<div class='empty'>No notifications.</div>"}</div>`);
}
