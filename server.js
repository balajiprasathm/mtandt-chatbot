// Mtandt Group website chatbot — backend
// Keeps the Claude API key server-side and answers using company knowledge only.

import express from "express";
import cors from "cors";
import fs from "fs";
import Groq from "groq-sdk";

const app = express();
app.use(cors());
app.use(express.json());

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const LEADS_FILE = "./leads.json";
const LEADS_WEBHOOK_URL = process.env.LEADS_WEBHOOK_URL || ""; // optional: Zapier/Make/Sheets webhook

// ---- Company knowledge base -------------------------------------------
// Edit this freely as products, pricing policy, or contact details change.
// Keep it factual — the model is instructed to only answer from this text.

const COMPANY_KNOWLEDGE = `
COMPANY
Mtandt Group is an industrial equipment and access solutions company headquartered in
Chennai, India. Founded in 1974 (originally as Madras Tools & Tackles), the group has
48+ years of industry presence, has served 5000+ customers, and operates across the
SAARC region including India and Sri Lanka.

BUSINESS UNITS
1. Equipment Sales & Rental Division (ESRD) — aerial work platforms (MEWPs) and lifting equipment
2. Composite Infra Division (CID) — PortaDeck, PortaMat, PortaPad temporary road/ground mats
3. Tactical Safety for Access and Falls (TSAF) — fall protection & lifeline systems
4. Maintenance Repair & Operations (MRO) — tools, PPE, industrial supplies
5. Under-Deck Access & Dropped Object Protection Solutions
6. CESL — Training & Certifications for work-at-height and equipment operation
7. Vertikal — lifting & access equipment (tower cranes, hoists, mast climbers)
8. Equipr — digital telematics platform for fleet monitoring and predictive maintenance

--- AERIAL WORK PLATFORMS (Boom Lifts, Scissor Lifts, Spider Lifts, Vertical Lifts) ---
Available to Buy or Rent, in Electric, Diesel, or Petrol power types.

Boom Lifts:
- Two types: Telescopic (straight-line extended reach) and Articulated (jointed arm for
  reaching around obstacles, into confined spaces)
- Working height up to 42 meters, with 360-degree rotation for full work-area access
- Common uses: signage, painting, inspection, maintenance, repair, tuck pointing, masonry,
  waterproofing, insulation, electrical/HVAC/plumbing work
- Brands carried: JLG, Dingli, HAB, ReechCraft, ATN, Bravi, OMME, FALCON

Scissor Lifts:
- Self-propelled, vertical-only lift, good for flat indoor/outdoor surfaces
- Working heights commonly from a few meters up to ~20+ meters depending on model
  (example: an electric scissor lift model in the range goes up to 10m working height,
  with automatic pothole protection and fault-code display)
- Electric models are quiet and low-emission — well suited to malls, hospitals, airports,
  indoor commercial spaces
- Brands carried: JLG, Dingli, Dingli-MHE

Spider Lifts (track-mounted, compact aerial platforms):
- Crawler-mounted with hydraulic outriggers for stability on uneven ground or slopes
  up to roughly 30% gradient; 360-400 degree rotation
- Working heights typically 20-32 meters depending on model (e.g. CMC S28 reaches 28m
  height / 14m outreach; CMC S32 reaches 32m and can also work down to -3.2m below
  platform level; TEUPEN LEO 23GT is built for tight spaces and narrow entryways)
- Compact and lightweight — good for indoor use, narrow doorways, mezzanine floors, and
  sites where boom lifts or scaffolding won't fit
- Both diesel (higher power, for outdoor/heavy-duty work) and electric/compact models
  (for indoor, noise/emission-sensitive environments) available
- Brands carried: CMC, TEUPEN

Vertical Lifts: powerful platforms for moving people/materials vertically between floors
of a building.

INDUSTRIES SERVED
Railway, aviation, automobile, energy/power, hotels & buildings, warehousing/logistics,
events, supermarkets/retail, airports & ports, malls & theatres, hospitals, construction,
infrastructure, manufacturing, oil & gas, refineries, metro/rail construction, defence.

OTHER PRODUCTS AND SERVICES (available to Buy or Rent)
- Material Handling Equipment (Order Picker, Duct Lifter)
- Spider Boom Crane
- Truck Mounted Boom Lift, Boom Lift for Road and Rail
- Mobile Light Tower & Power Station
- Aluminium Scaffolding
- Lifting & Access Equipment (Tower Crane, Hoists, Mast Climber)
- Temporary Road Mats / Ground Protection (PortaDeck, PortaMat, PortaPad, Portacell)
- Fall Protection Lifeline System (roof, vehicle, EOT crane, pipe rack, chimney, mobile tower, transmission tower)
- Suspended Under Deck Access System
- Adjustable Access System (FastBeam)
- Industrial Rope Access (inspection, maintenance, repair — onshore and offshore)
- Total Asset Management (via Equipr telematics)
- Tools, PPE, and Supplies
- Training & Certification (work-at-height, equipment operation, rope access, maintenance) via CESL, IRATA-affiliated

PRICING
Mtandt does not publish fixed prices — equipment purchase and rental pricing depends on the
specific product, duration (for rentals), site location, and project requirements, and is
provided as a custom quote. Do not invent or estimate prices. Instead, ask what product and
use case they need, then offer to collect their contact details so the sales team can send a
quote.

CONTACT
Email: digital@mtandt.com
Phone: +91 90901 01065
Head office: 17/8 West Mada Church Road, Royapuram, Chennai, Tamil Nadu 600013, India
Also present in: Bangalore (Tumkur Road), Sri Lanka (Colombo), and other SAARC locations
Website: https://www.mtandt.com
`;

const SYSTEM_PROMPT = `You are the website assistant for Mtandt Group, an industrial access
equipment and safety solutions company. Answer visitor questions about the company, its
products/services, business units, and how to buy or rent equipment, using ONLY the
information below. Be concise and helpful, like a knowledgeable sales support rep.

Rules:
- Never invent prices. If asked for pricing, or if the visitor shows interest in buying or
  renting a product, explain that pricing depends on product/duration/location, and let them
  know they can click the "Request a quote" button below the chat to share their details with
  the sales team. Mention this naturally in your sentence — do not use any special tag for it.
- If a question is outside this information (e.g. order status, invoices, complaints), direct
  them to email digital@mtandt.com or call +91 90901 01065.
- Keep answers short and clear — this is a chat widget, not a document.
- When discussing boom lifts, scissor lifts, or spider lifts, always use that exact product
  name at least once in your answer (even if the visitor used a different term like "cherry
  picker" or "aerial platform"), so the visitor knows exactly which product you mean.
- Do not use markdown formatting (no **bold**, no # headers, no bullet characters like - or *).
  Write in plain sentences, or use simple numbered lines like "1. Boom Lift" if listing items.

COMPANY KNOWLEDGE:
${COMPANY_KNOWLEDGE}`;

// Decide which product image/table to show by reading the AI's OWN answer text.
// This is far more reliable than matching the visitor's question, because the visitor
// might phrase things any number of ways ("cherry picker", "aerial platform", typos...),
// but the AI's answer will almost always use the correct product term from the
// knowledge base ("boom lift", "scissor lift", "spider lift") since that's what it was
// given to work with.
function detectMediaTag(userMessage, replyText) {
  const combined = (replyText + " " + userMessage).toLowerCase();
  let category = null;
  if (/\bboom\s*lifts?\b/.test(combined)) category = "boom_lift";
  else if (/\bscissor\s*lifts?\b/.test(combined)) category = "scissor_lift";
  else if (/\bspider\s*lifts?\b/.test(combined)) category = "spider_lift";

  if (!category) return "";

  const wantsList = /\b(what|which|show|list|all|models|options|available|do you have)\b/.test(
    userMessage.toLowerCase()
  );
  return wantsList ? `\n[SHOW_TABLE:${category}]` : `\n[SHOW_IMAGE:${category}]`;
}

app.post("/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }

    // Groq uses OpenAI-style messages: {role: "system"|"user"|"assistant", content}
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.slice(-10),
      { role: "user", content: message },
    ];

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      max_tokens: 1500,
    });

    const replyText = completion.choices[0]?.message?.content || "";
    const reply = replyText + detectMediaTag(message, replyText);
    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

app.post("/lead", async (req, res) => {
  try {
    const { name, phone, email, product, type, message = "" } = req.body;
    if (!name || !phone || !product) {
      return res.status(400).json({ error: "name, phone, and product are required" });
    }

    const lead = {
      name,
      phone,
      email: email || "",
      product,
      type: type || "Not specified", // "Buy" or "Rent"
      message,
      submittedAt: new Date().toISOString(),
    };

    // Always keep a local backup so no lead is lost even if the webhook is down/unset
    let existing = [];
    try {
      existing = JSON.parse(fs.readFileSync(LEADS_FILE, "utf-8"));
    } catch {
      existing = [];
    }
    existing.push(lead);
    fs.writeFileSync(LEADS_FILE, JSON.stringify(existing, null, 2));

    // Optionally forward to a Zapier/Make/Google Sheets webhook so sales gets notified instantly
    if (LEADS_WEBHOOK_URL) {
      try {
        await fetch(LEADS_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(lead),
        });
      } catch (webhookErr) {
        console.error("Lead webhook failed (lead was still saved locally):", webhookErr);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Lead capture error:", err);
    res.status(500).json({ error: "Could not save your request. Please try again." });
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Mtandt chatbot backend running on port ${PORT}`));
