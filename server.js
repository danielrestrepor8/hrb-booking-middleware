/**
 * HRB Booking Middleware — server.js (v4)
 * Real endpoint: GET /api/schedule (from DevTools capture)
 * Key insight: uses internal "locationId" (e.g. 13370), NOT externalLocationId
 */

const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const MERCHANT_GUID = "b53f2dee-d8e7-48c0-bd6f-7605b7f0c4a3";
const WIDGET_ID     = "e0e2ffe4-bf80-48a6-9223-8357ec2267af";
const FB_BASE       = "https://a.flexbooker.com";
const SERVICE_ID    = "24323";
const TIMEZONE      = "America/Denver"; // FlexBooker uses Mountain Time for this account

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-CA,en;q=0.9",
  "Referer": `https://a.flexbooker.com/widget/${WIDGET_ID}`,
  "Origin": "https://a.flexbooker.com",
};

// Date helpers
function toFBDate(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split("-");
  return `${parseInt(m)}/${parseInt(d)}/${y}`;
}
function addDays(yyyymmdd, n) {
  const d = new Date(yyyymmdd);
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

// ─── Fetch all merchant locations (cached in memory) ─────────────────────────
let locationCache = null;
async function getLocations() {
  if (locationCache) return locationCache;
  const r = await axios.get(`${FB_BASE}/api/merchants/${MERCHANT_GUID}/locations`, {
    headers: BROWSER_HEADERS,
    timeout: 10000,
  });
  locationCache = r.data;
  return locationCache;
}

// ─── Fallback: parse locations from widget page HTML ─────────────────────────
async function getLocationsViaWidget() {
  const r = await axios.get(`${FB_BASE}/widget/${WIDGET_ID}`, {
    headers: BROWSER_HEADERS,
    timeout: 10000,
  });
  // widget returns HTML; we can also try the merchantState endpoint
  const r2 = await axios.get(`${FB_BASE}/js/cm/html/widget/merchantState`, {
    params: { merchantGuid: MERCHANT_GUID, isClient: true, widgetUid: WIDGET_ID },
    headers: BROWSER_HEADERS,
    timeout: 10000,
  });
  return r2.data;
}

// ─── ROUTE 1 — Find offices ───────────────────────────────────────────────────
app.post("/find-offices", async (req, res) => {
  const { location } = req.body;
  if (!location) return res.status(400).json({ error: "location is required" });

  try {
    // Try the direct locations API first
    let rawData;
    try {
      rawData = await getLocations();
    } catch (_) {
      rawData = await getLocationsViaWidget();
      locationCache = null; // don't cache widget fallback
    }

    // Flatten to array regardless of response shape
    const allLocs =
      (Array.isArray(rawData) ? rawData : null) ||
      rawData?.locations ||
      rawData?.merchantLocations ||
      rawData?.offices ||
      [];

    if (allLocs.length === 0) {
      return res.json({
        found: false,
        message: "Could not retrieve office list.",
        offices: [],
        debug: { keys: Object.keys(rawData || {}) },
      });
    }

    const q = location.toLowerCase();
    const filtered = allLocs.filter((loc) => JSON.stringify(loc).toLowerCase().includes(q));
    const list = (filtered.length > 0 ? filtered : allLocs).slice(0, 3);

    const offices = list.map((loc) => ({
      name: loc.name || loc.locationName || loc.title || "H&R Block",
      address: loc.address || loc.fullAddress ||
        [loc.address1, loc.city, loc.province || loc.state].filter(Boolean).join(", "),
      phone: loc.phone || loc.phoneNumber || "",
      // Return BOTH ids — widget uses externalLocationId, /api/schedule uses locationId
      locationId: String(loc.id || loc.locationId || ""),
      externalLocationId: String(loc.externalLocationId || loc.uid || loc.id || ""),
    }));

    return res.json({ found: true, offices });
  } catch (err) {
    console.error("[find-offices]", err.response?.status, err.message);
    return res.status(502).json({ found: false, error: "Could not reach office locator.", offices: [], detail: err.message });
  }
});

// ─── ROUTE 2 — Get availability ───────────────────────────────────────────────
// Real URL from DevTools:
//   GET /api/schedule?csvServiceIds=24323&merchantGuid=...&startDate=5/1/2026&endDate=6/2/2026&timeZone=America/Denver&locationId=13370
app.post("/get-availability", async (req, res) => {
  const { locationId, externalLocationId, date, serviceId = SERVICE_ID } = req.body;
  if (!date) return res.status(400).json({ error: "date is required" });
  if (!locationId && !externalLocationId) return res.status(400).json({ error: "locationId or externalLocationId is required" });

  // Use a 2-week window starting from requested date
  const startDate = toFBDate(date);
  const endDate   = toFBDate(addDays(date, 14));
  const locId     = locationId || externalLocationId;

  try {
    const r = await axios.get(`${FB_BASE}/api/schedule`, {
      params: {
        csvServiceIds: serviceId,
        merchantGuid: MERCHANT_GUID,
        startDate,
        endDate,
        timeZone: TIMEZONE,
        locationId: locId,
      },
      headers: BROWSER_HEADERS,
      timeout: 10000,
    });

    const data = r.data;

    // /api/schedule returns an array or object with date keys
    let slots = [];
    if (Array.isArray(data)) {
      // Each item may be { date, times: [...] } or flat slot objects
      const dayEntry = data.find((d) => {
        const entryDate = d.date || d.day || d.startDate || "";
        return entryDate.includes(date) || entryDate.startsWith(date.replace(/-/g, "/").replace(/^0/, ""));
      }) || data[0];
      slots = dayEntry?.times || dayEntry?.slots || dayEntry?.appointments || (Array.isArray(dayEntry) ? dayEntry : []);
    } else if (typeof data === "object") {
      // Might be { "2026-05-01": [...], "2026-05-02": [...] } keyed by date
      const key = Object.keys(data).find((k) => k.includes(date) || k.replace(/\//g, "-").includes(date));
      const raw = key ? data[key] : data.slots || data.times || data.schedule || [];
      slots = Array.isArray(raw) ? raw : [];
    }

    if (!slots || slots.length === 0) {
      return res.json({
        found: false,
        date,
        slots: [],
        message: `No available slots on ${date}. Try a different date.`,
        debug: { responseType: typeof data, isArray: Array.isArray(data), keys: Array.isArray(data) ? `array[${data.length}]` : Object.keys(data).slice(0, 10) },
      });
    }

    const formatted = slots.slice(0, 12).map((s) => ({
      datetime: s.startDateTime || s.dateTime || s.start || s.time || String(s),
      displayTime: s.displayTime || s.label || s.formattedTime || s.startTime || String(s),
    }));

    return res.json({ found: true, date, timezone: "Mountain Time", slots: formatted });
  } catch (err) {
    console.error("[get-availability]", err.response?.status, err.message);
    return res.status(502).json({ found: false, date, slots: [], message: "Could not retrieve availability.", detail: err.message });
  }
});

// ─── ROUTE 3 — Submit booking ─────────────────────────────────────────────────
app.post("/submit-booking", async (req, res) => {
  const {
    locationId, externalLocationId, slotDatetime,
    firstName, lastName, email, phone,
    taxYears, attendees, reminderPreference,
    language = "English", serviceId = SERVICE_ID, checkboxes = {},
  } = req.body;

  const missing = ["slotDatetime", "firstName", "lastName", "email", "phone"]
    .filter((k) => !req.body[k]);
  if (!locationId && !externalLocationId) missing.push("locationId");
  if (missing.length > 0) return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });

  const bool = (v) => v === true || v === "true" || v === "yes";

  try {
    const payload = {
      merchantGuid: MERCHANT_GUID,
      widgetUid: WIDGET_ID,
      locationId: locationId || externalLocationId,
      serviceId,
      appointmentDateTime: slotDatetime,
      language,
      firstName,
      lastName,
      email,
      phone,
      taxYearsToFile: Number(taxYears) || 1,
      numberOfAttendees: Number(attendees) || 1,
      reminderPreference: reminderPreference || "Email",
      timeZone: TIMEZONE,
      customFields: {
        selfEmploymentOrRental: bool(checkboxes.selfEmploymentOrRental),
        usTaxReturn: bool(checkboxes.usTaxReturn),
        t2IncorporatedReturn: bool(checkboxes.t2IncorporatedReturn),
        estateOrFinalReturn: bool(checkboxes.estateOrFinalReturn),
        bankruptcy: bool(checkboxes.bankruptcy),
        foreignIncome: bool(checkboxes.foreignIncome),
        investmentsOrProperties: bool(checkboxes.investmentsOrProperties),
        employmentExpenses: bool(checkboxes.employmentExpenses),
        movedOrSwitchedProvince: bool(checkboxes.movedOrSwitchedProvince),
      },
    };

    const r = await axios.post(`${FB_BASE}/js/cm/html/widget/book`, payload, {
      headers: { ...BROWSER_HEADERS, "Content-Type": "application/json" },
      timeout: 15000,
    });

    const confirmationId =
      r.data?.bookingId || r.data?.confirmationNumber || r.data?.appointmentId || r.data?.id || r.data?.confirmation;

    if (!confirmationId) {
      return res.status(502).json({ success: false, error: "No confirmation ID returned.", raw: r.data });
    }
    return res.json({ success: true, confirmationId });
  } catch (err) {
    console.error("[submit-booking]", err.response?.status, err.message);
    return res.status(502).json({ success: false, error: "Booking failed. Please call the office directly.", detail: err.message });
  }
});

// ─── ROUTE 4 — FAQ search ─────────────────────────────────────────────────────
app.post("/faq-search", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "query is required" });

  const FAQS = [
    { keywords: ["due","deadline","when","file","date"], question: "When are taxes due in Canada?", answer: "The tax filing deadline is April 30th for most individuals. Self-employed individuals have until June 15th, but any taxes owed are still due April 30th." },
    { keywords: ["refund","long","take","get back"], question: "How long does it take to get a tax refund?", answer: "If you file electronically, expect your refund in about 2 weeks. Paper returns can take 8 weeks or more." },
    { keywords: ["cost","price","fee","how much","charge"], question: "How much does H&R Block charge?", answer: "Pricing depends on the complexity of your return. A tax expert will review your situation and provide a quote during your appointment." },
    { keywords: ["self-employed","self employed","business","freelance"], question: "Can H&R Block help with self-employed taxes?", answer: "Yes — H&R Block specialists handle self-employed returns, including T2125 forms and eligible deductions." },
    { keywords: ["rrsp","contribution","limit"], question: "What is the RRSP contribution deadline?", answer: "The RRSP deadline is 60 days after December 31st — typically March 1st of the following year." },
    { keywords: ["document","bring","need","t4","slip"], question: "What documents do I need to bring?", answer: "Bring all your tax slips (T4s, T5s), your last Notice of Assessment, receipts for deductions, and a government-issued photo ID." },
    { keywords: ["walk","appointment","book","schedule"], question: "Do I need an appointment?", answer: "Walk-ins are welcome at H&R Block offices. Booking in advance ensures a tax expert is available at your preferred time." },
    { keywords: ["student","tuition","education"], question: "Can students get help with taxes?", answer: "Yes — H&R Block can help students claim tuition credits, education amounts, and student loan interest deductions." },
    { keywords: ["foreign","outside canada","us return","united states"], question: "Can H&R Block help with US or foreign tax returns?", answer: "Yes — H&R Block has specialists for US tax returns and Canadians with foreign income." },
  ];

  const q = query.toLowerCase();
  const match = FAQS.find((faq) => faq.keywords.some((kw) => q.includes(kw)));
  if (match) return res.json({ found: true, question: match.question, answer: match.answer, sourceUrl: "https://www.hrblock.ca/support" });
  return res.json({ found: false, answer: null, sourceUrl: "https://www.hrblock.ca/support", message: "No matching FAQ found." });
});

// ─── DEBUG — Find real location IDs ──────────────────────────────────────────
app.get("/debug-locations", async (req, res) => {
  const results = {};
  const endpoints = [
    `/api/merchants/${MERCHANT_GUID}/locations`,
    `/js/cm/html/widget/merchantState?merchantGuid=${MERCHANT_GUID}&isClient=true&widgetUid=${WIDGET_ID}`,
  ];
  for (const ep of endpoints) {
    try {
      const r = await axios.get(`${FB_BASE}${ep}`, { headers: BROWSER_HEADERS, timeout: 10000 });
      results[ep] = { status: r.status, keys: Object.keys(r.data || {}), preview: JSON.stringify(r.data).substring(0, 2000) };
    } catch (err) {
      results[ep] = { error: err.message, status: err.response?.status };
    }
  }
  res.json(results);
});

// ─── DEBUG — Test /api/schedule directly ─────────────────────────────────────
app.get("/debug-schedule", async (req, res) => {
  const date = req.query.date || new Date().toISOString().split("T")[0];
  const locationId = req.query.locationId || "13370"; // use real ID from DevTools
  const startDate = toFBDate(date);
  const endDate   = toFBDate(addDays(date, 14));
  try {
    const r = await axios.get(`${FB_BASE}/api/schedule`, {
      params: { csvServiceIds: SERVICE_ID, merchantGuid: MERCHANT_GUID, startDate, endDate, timeZone: TIMEZONE, locationId },
      headers: BROWSER_HEADERS,
      timeout: 10000,
    });
    res.json({ status: r.status, isArray: Array.isArray(r.data), keys: Array.isArray(r.data) ? `array[${r.data.length}]` : Object.keys(r.data || {}), preview: JSON.stringify(r.data).substring(0, 3000) });
  } catch (err) {
    res.json({ error: err.message, status: err.response?.status, data: err.response?.data });
  }
});

app.get("/health", (_, res) => res.json({ status: "ok", version: "4.0" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HRB Middleware v4 running on port ${PORT}`));
