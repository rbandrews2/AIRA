import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AssistantRequest = {
  owner_id?: string;
  caller_text?: string;
  call_id?: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const payload = await req.json().catch(() => ({})) as AssistantRequest;
  const callerText = String(payload.caller_text || "").trim();
  if (!callerText) return json({ error: "caller_text is required" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = supabaseUrl && serviceRole
    ? createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } })
    : null;

  let training = defaultTraining();
  if (supabase && payload.owner_id) {
    const { data } = await supabase
      .from("aira_training_versions")
      .select("prompt")
      .eq("owner_id", payload.owner_id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    training = data?.prompt || training;
  }

  const reply = localReply(callerText, training);

  if (supabase && payload.call_id) {
    await supabase.from("aira_call_turns").insert([
      { call_id: payload.call_id, speaker: "caller", text_body: callerText },
      { call_id: payload.call_id, speaker: "aira", text_body: reply },
    ]);
  }

  return json({ reply, category: screenCall(callerText) });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function localReply(text: string, training: string) {
  const lower = text.toLowerCase();
  if (lower.includes("price") || lower.includes("cost")) {
    return "Our prices range from $9.99 to $4500 depending on the product, service, and personnel needed. I can collect your details and route you to the right person.";
  }
  if (lower.includes("work zone") || lower.includes("desk-less") || lower.includes("deskless")) {
    return "Work Zone OS is the operating system for desk-less workers. It helps mobile teams coordinate field work, communication, and operations.";
  }
  if (lower.includes("email") || lower.includes("contact") || lower.includes("phone")) {
    return "Corporate inquiries can email info@superiorllc.org. Everyone else can email ray@workzoneos.org, or call 540-797-0405 or 844-685-7207 toll free.";
  }
  if (lower.includes("message") || lower.includes("callback") || lower.includes("call back")) {
    return "I can take a message. Please share your name, best contact method, business name, and the reason for your call.";
  }
  if (training.toLowerCase().includes("young professionals")) {
    return "Superior Consultation builds applications for ambitious professionals and businesses on the go. Tell me what you are trying to launch or improve, and I will help route you.";
  }
  return "Superior Consultation consults and develops applications. Tell me what you need, and I will help route your call.";
}

function screenCall(text: string) {
  const lower = text.toLowerCase();
  if (lower.includes("billing") || lower.includes("payment")) return "Billing";
  if (lower.includes("support") || lower.includes("bug")) return "Technical support";
  if (lower.includes("price") || lower.includes("quote")) return "Sales";
  if (lower.includes("work zone")) return "Work Zone OS";
  if (lower.includes("app") || lower.includes("build")) return "New project";
  return "General";
}

function defaultTraining() {
  return "AIRA AI works for Superior Consultation, LLC. The company consults and develops applications and is home to Work Zone OS - The operating system for desk-less workers.";
}
