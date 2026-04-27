/**
 * HRB Booking Middleware — server.js (v2 — real APIs + debug routes)
 * Run:  node server.js
 * Deps: npm install express axios cors
 */

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const WIDGET_ID = "e0e2ffe4-bf80-48a6-9223-8357ec2267af";
const FLEXBOOKER_API = "https://abooking.flexbooker.com";
const HRB_API = "https://www.hrblock.ca";

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-CA,en;q=0.9",
  "Origin": "https://a.flexbooker.com",
  "Referer": "https://a.flexbooker.com/",
};

// ─── ROUTE 1 — Find offices ───────────────────────────────────────────────────
app.post("/find-offices", async (req, res) => {
  const { location } = req.body;
  if (!location) return res.status(400).json({ error: "location is required" });

  try {
    const response = await axios.get(`${HRB_API}/api/office-locator/offices`, {
      params: { q: location, limit: 5, locale: "en" },
      headers: { ...BROWSER_HEADERS, Referer: "https://www.hrblock.ca/office-locator" },
      timeout: 10000,
    });
    const raw = response.data;
    const officeList = raw.offices || raw.results || raw.locations || raw.data?.offices || (Array.isArray(raw) ? raw : null);
    if (!officeList || officeList.length === 0) {
      return res.json({ found: false, message: `No offices found for "${location}". Try a nearby city or postal code.`, offices: [], debug: { keys: Object.keys(raw) } });
    }
    const offices = officeList.slice(0, 3).map((o) => ({
      name: o.name || o.officeName || o.title || "H&R Block",
      address: o.address || o.formattedAddress || `${o.address1 || ""}, ${o.city || ""}, ${o.province || o.state || ""}`.trim(),
      phone: o.phone || o.phoneNumber || "",
      externalLocationId: String(o.externalLocationId || o.locationId || o.id || ""),
    }));
    return res.json({ found: true, offices });
  } catch (err) {
    console.error("[find-offices] failed:", err.response?.status, err.message);
    return res.status(502).json({ found: false, error: "Could not reach office locator.", detail: err.message, offices: [] });
  }
});

// ─── ROUTE 2 — Get availability ───────────────────────────────────────────────
app.post("/get-availability", async (req, res) => {
  const { externalLocationId, date, language = "English" } = req.body;
  if (!externalLocationId || !date) return res.status(400).json({ error: "externalLocationId and date are required" });

  const endpoints = [
    `${FLEXBOOKER_API}/api/accounts/${WIDGET_ID}/locations/${externalLocationId}/slots`,
    `https://a.flexbooker.com/api/accounts/${WIDGET_ID}/locations/${externalLocationId}/slots`,
    `${FLEXBOOKER_API}/api/accounts/${WIDGET_ID}/locations/${externalLocationId}/availability`,
  ];

  for (const url of endpoints) {
    try {
      const r = await axios.get(url, {
        params: { date, language },
        headers: { ...BROWSER_HEADERS, Referer: `https://a.flexbooker.com/widget/${WIDGET_ID}?externalLocationId=${externalLocationId}&Language=${language}` },
        timeout: 8000,
      });
      const raw = r.data;
      const rawSlots = raw.slots || raw.availableSlots || raw.times || raw.availability || (Array.isArray(raw) ? raw : []);
      if (rawSlots && rawSlots.length > 0) {
        return res.json({
          found: true, date, timezone: "Eastern Time",
          slots: rawSlots.slice(0, 10).map((s) => ({
            datetime: s.startDateTime || s.dateTime || s.datetime || s.start || String(s),
            displayTime: s.displayTime || s.label || s.startDateTime || String(s),
          })),
        });
      }
    } catch (e) {
      console.error(`[get-availability] ${url} failed:`, e.response?.status, e.message);
    }
  }

  return res.json({ found: false, date, slots: [], message: `No available slots on ${date}. Try a different date.` });
});

// ─── ROUTE 3 — Submit booking ─────────────────────────────────────────────────
app.post("/submit-booking", async (req, res) => {
  const { externalLocationId, slotDatetime, firstName, lastName, email, phone, taxYears, attendees, reminderPreference, language = "English", checkboxes = {} } = req.body;
  const missing = ["externalLocationId","slotDatetime","firstName","lastName","email","phone"].filter((k) => !req.body[k]);
  if (missing.length > 0) return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });

  const boolField = (v) => v === true || v === "true" || v === "yes";

  try {
    const payload = {
      locationExternalId: externalLocationId,
      appointmentDateTime: slotDatetime,
      language,
      customer: { firstName, lastName, email, phone },
      taxYearsToFile: Number(taxYears) || 1,
      numberOfAttendees: Number(attendees) || 1,
      reminderPreference: reminderPreference || "Email",
      checkboxes: {
        selfEmploymentOrRental: boolField(checkboxes.selfEmploymentOrRental),
        usTaxReturn: boolField(checkboxes.usTaxReturn),
        t2IncorporatedReturn: boolField(checkboxes.t2IncorporatedReturn),
        estateOrFinalReturn: boolField(checkboxes.estateOrFinalReturn),
        bankruptcy: boolField(checkboxes.bankruptcy),
        foreignIncome: boolField(checkboxes.foreignIncome),
        investmentsOrProperties: boolField(checkboxes.investmentsOrProperties),
        employmentExpenses: boolField(checkboxes.employmentExpenses),
        movedOrSwitchedProvince: boolField(checkboxes.movedOrSwitchedProvince),
      },
    };

    const r = await axios.post(`${FLEXBOOKER_API}/api/accounts/${WIDGET_ID}/bookings`, payload, {
      headers: { ...BROWSER_HEADERS, "Content-Type": "application/json", Referer: `https://a.flexbooker.com/widget/${WIDGET_ID}` },
      timeout: 15000,
    });

    const confirmationId = r.data?.bookingId || r.data?.confirmationNumber || r.data?.id || r.data?.confirmation;
    if (!confirmationId) return res.status(502).json({ success: false, error: "No confirmation ID returned. Escalate to specialist." });
    return res.json({ success: true, confirmationId });
  } catch (err) {
    console.error("[submit-booking]", err.response?.status, err.message);
    return res.status(502).json({ success: false, error: "Booking failed. Escalate to specialist.", detail: err.message });
  }
});

// ─── ROUTE 4 — FAQ search ─────────────────────────────────────────────────────
app.post("/faq-search", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "query is required" });

  const FAQS = [
    { keywords: ["due","deadline","when","file","date"], question: "When are taxes due in Canada?", answer: "The tax filing deadline in Canada is April 30th for most individuals. Self-employed individuals have until June 15th, but any taxes owed are still due April 30th." },
    { keywords: ["refund","long","take","get back"], question: "How long does it take to get a tax refund?", answer: "If you file electronically, expect your refund in about 2 weeks. Paper returns can take 8 weeks or more." },
    { keywords: ["cost","price","fee","how much","charge"], question: "How much does H&R Block charge?", answer: "Pricing depends on the complexity of your return and location. A tax expert will review your situation and provide a quote during your appointment." },
    { keywords: ["self-employed","self employed","business","freelance"], question: "Can H&R Block help with self-employed taxes?", answer: "Yes, H&R Block has tax experts who specialize in self-employed and business returns, including T2125 forms and eligible deductions." },
    { keywords: ["rrsp","contribution","limit"], question: "What is the RRSP contribution deadline?", answer: "The RRSP contribution deadline is 60 days after December 31st — typically March 1st of the following year." },
    { keywords: ["document","bring","need","t4","slip"], question: "What documents do I need to bring?", answer: "Bring all your tax slips (T4s, T5s, etc.), your last Notice of Assessment, receipts for deductions, and a government-issued photo ID." },
    { keywords: ["walk","appointment","book","schedule"], question: "Do I need an appointment?", answer: "Walk-ins are welcome at H&R Block offices. Booking in advance ensures a tax expert is available at your preferred time." },
    { keywords: ["everyone","need","have to","required","mandatory"], question: "Does everyone need to file a tax return?", answer: "Not everyone is required to file, but it is generally recommended — you may miss out on refunds and benefits like the GST/HST credit or Canada Child Benefit if you do not file." },
    { keywords: ["student","tuition","education"], question: "Can students get help with taxes?", answer: "Yes, H&R Block can help students claim tuition credits, education amounts, and student loan interest deductions." },
    { keywords: ["foreign","outside canada","us return","united states"], question: "Can H&R Block help with US or foreign tax returns?", answer: "Yes, H&R Block has specialists who can prepare US tax returns and help Canadians with foreign income reporting." },
  ];

  const q = query.toLowerCase();
  const match = FAQS.find((faq) => faq.keywords.some((kw) => q.includes(kw)));
  if (match) return res.json({ found: true, question: match.question, answer: match.answer, sourceUrl: "https://www.hrblock.ca/support" });
  return res.json({ found: false, answer: null, sourceUrl: "https://www.hrblock.ca/support", message: "No matching FAQ found." });
});

// ─── DEBUG — Probe H&R Block locator endpoints ────────────────────────────────
app.get("/debug-locator", async (req, res) => {
  const location = req.query.location || "Toronto";
  const urls = [
    `${HRB_API}/api/office-locator/offices?q=${encodeURIComponent(location)}&limit=3`,
    `${HRB_API}/api/offices?q=${encodeURIComponent(location)}`,
    `${HRB_API}/api/locations?search=${encodeURIComponent(location)}`,
    `${HRB_API}/api/store-locator?q=${encodeURIComponent(location)}`,
    `${HRB_API}/api/v1/offices?q=${encodeURIComponent(location)}`,
  ];
  const results = {};
  for (const url of urls) {
    try {
      const r = await axios.get(url, { headers: { ...BROWSER_HEADERS, Referer: "https://www.hrblock.ca/office-locator" }, timeout: 6000 });
      results[url] = { status: r.status, keys: Object.keys(r.data || {}), preview: JSON.stringify(r.data).substring(0, 300) };
    } catch (e) {
      results[url] = { error: e.message, status: e.response?.status };
    }
  }
  res.json(results);
});

// ─── DEBUG — Probe FlexBooker availability endpoints ──────────────────────────
app.get("/debug-flexbooker", async (req, res) => {
  const locationId = req.query.locationId || "54215";
  const date = req.query.date || new Date().toISOString().split("T")[0];
  const urls = [
    `${FLEXBOOKER_API}/api/accounts/${WIDGET_ID}/locations/${locationId}/slots?date=${date}`,
    `${FLEXBOOKER_API}/api/accounts/${WIDGET_ID}/locations/${locationId}/availability?date=${date}`,
    `https://a.flexbooker.com/api/accounts/${WIDGET_ID}/locations/${locationId}/slots?date=${date}`,
    `${FLEXBOOKER_API}/api/widget/${WIDGET_ID}/slots?locationId=${locationId}&date=${date}`,
  ];
  const results = {};
  for (const url of urls) {
    try {
      const r = await axios.get(url, { headers: BROWSER_HEADERS, timeout: 6000 });
      results[url] = { status: r.status, keys: Object.keys(r.data || {}), preview: JSON.stringify(r.data).substring(0, 300) };
    } catch (e) {
      results[url] = { error: e.message, status: e.response?.status };
    }
  }
  res.json(results);
});

app.get("/health", (_, res) => res.json({ status: "ok", version: "2.0" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HRB Middleware v2 running on port ${PORT}`));
