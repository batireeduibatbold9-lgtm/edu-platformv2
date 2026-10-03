import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  try {
    const { students, examTitle, startTime, duration } = await req.json();

    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("FROM_EMAIL");

    if (!apiKey || !from) {
      return new Response(JSON.stringify({error:"Missing RESEND_API_KEY or FROM_EMAIL"}), {
        status:500, headers:{"Content-Type":"application/json"}
      });
    }

    const results = [];
    for (const student of students || []) {
      const html = `
        <div style="font-family:Arial,sans-serif">
          <h2>New exam: ${escapeHtml(examTitle)}</h2>
          <p>Your teacher has published a new exam.</p>
          <p><b>Start:</b> ${new Date(startTime).toLocaleString()}</p>
          <p><b>Duration:</b> ${duration} minutes</p>
        </div>`;

      const r = await fetch("https://api.resend.com/emails", {
        method:"POST",
        headers:{
          "Authorization":`Bearer ${apiKey}`,
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          from,
          to:[student.email],
          subject:`New exam: ${examTitle}`,
          html
        })
      });
      results.push({email:student.email,ok:r.ok});
    }

    return new Response(JSON.stringify({results}), {
      headers:{"Content-Type":"application/json"}
    });
  } catch (e) {
    return new Response(JSON.stringify({error:String(e)}), {
      status:500, headers:{"Content-Type":"application/json"}
    });
  }
});

function escapeHtml(v=""){
  return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}
