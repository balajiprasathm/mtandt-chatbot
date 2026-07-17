// Mtandt Group website chatbot — backend
// Keeps the Claude API key server-side and answers using company knowledge only.

import express from "express";
import cors from "cors";
import fs from "fs";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from environment
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

PRODUCTS AND SERVICES (available to Buy or Rent)
- Boom Lift, Scissor Lift, Vertical Lift, Spider Lift, Truck Mounted Boom Lift, Boom Lift for Road and Rail
- Material Handling Equipment (Order Picker, Duct Lifter)
- Spider Boom Crane
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

INDUSTRIES SERVED
Construction, infrastructure, manufacturing, oil & gas, power, renewable energy, warehousing,
refineries, metro/rail construction, defence, and facility maintenance.

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

    const messages = [
      ...history.slice(-10), // keep last 10 turns to limit token usage
      { role: "user", content: message },
    ];

    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages,
    });

    const reply = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

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
