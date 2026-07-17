// Mtandt Group website chatbot — backend
// Keeps the Claude API key server-side and answers using company knowledge only.

import express from "express";
import cors from "cors";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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
  renting a product, explain that pricing depends on product/duration/location, and tell them
  you can pass their details to the sales team for a quote.
- Whenever the visitor asks about pricing, availability, or expresses buy/rent intent, end
  your reply with the exact tag [SHOW_QUOTE_FORM] on its own new line, so the widget can open
  the quote request form. Do not explain or mention this tag to the visitor.
- Whenever your answer is mainly about one specific equipment type, add ONE image tag on its
  own new line, chosen from exactly these options: [SHOW_IMAGE:boom_lift] [SHOW_IMAGE:scissor_lift]
  [SHOW_IMAGE:spider_lift]. Only use a tag from this list — do not invent new tags, and skip
  the image tag entirely if the topic isn't one of these three. Do not explain or mention this
  tag to the visitor. Both an image tag and [SHOW_QUOTE_FORM] can appear together if relevant.
- If a question is outside this information (e.g. order status, invoices, complaints), direct
  them to email digital@mtandt.com or call +91 90901 01065.
- Keep answers short and clear — this is a chat widget, not a document.

COMPANY KNOWLEDGE:
${COMPANY_KNOWLEDGE}`;

app.post("/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }

    // Gemini expects history as {role, parts:[{text}]}; "assistant" becomes "model"
    const contents = [
      ...history.slice(-10).map((turn) => ({
        role: turn.role === "assistant" ? "model" : "user",
        parts: [{ text: turn.content }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents,
      config: { systemInstruction: SYSTEM_PROMPT, maxOutputTokens: 700 },
    });

    const reply = response.text || "";
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
