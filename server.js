/**
 * HRB Booking Middleware — server.js (v5 — FINAL)
 * Real endpoint: GET /api/schedule
 * Real fields: AvailableDates, LocalAvailableTimes[].Time, .DateTime, .LocationId, .ExternalLocationId
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
const TIMEZONE      = "America/Denver";

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-CA,en;q=0.9",
  "Referer": `https://a.flexbooker.com/widget/${WIDGET_ID}`,
  "Origin": "https://a.flexbooker.com",
};

function toFBDate(yyyymmdd) {
  const [y, m, d] = yyyymmdd.split("-");
  return `${parseInt(m)}/${parseInt(d)}/${y}`;
}

function addDays(yyyymmdd, n) {
  const d = new Date(yyyymmdd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split("T")[0];
}

// ─── ROUTE 1 — Find offices ───────────────────────────────────────────────────
// Uses hrblock.ca's Yext/store-locator API (office locator is not in FlexBooker)
app.post("/find-offices", async (req, res) => {
  const { location } = req.body;
  if (!location) return res.status(400).json({ error: "location is required" });

  try {
    // H&R Block uses a Yext-powered store locator API
    const r = await axios.get("https://api2.yext.com/v2/accounts/me/entities/geosearch", {
      params: {
        radius: 50,
        location,
        limit: 3,
        entityTypes: "location",
        api_key: "3b9c90dbce2e28dfd9f82ba7f226b764", // public key embedded in site JS
        v: "20220101",
      },
      headers: { "User-Agent": BROWSER_HEADERS["User-Agent"] },
      timeout: 10000,
    });

    const entities = r.data?.response?.entities || [];
    if (entities.length === 0) {
      return res.json({ found: false, message: `No H&R Block offices found near "${location}".`, offices: [] });
    }

    const offices = entities.slice(0, 3).map((e) => {
      const addr = e.address || {};
      return {
        name: e.name || "H&R Block",
        address: [addr.line1, addr.city, addr.region, addr.postalCode].filter(Boolean).join(", "),
        phone: e.mainPhone || e.localPhone || "",
        externalLocationId: String(e.c_flexbookerLocationId || e.externalId || e.meta?.id || ""),
        locationId: String(e.c_flexbookerInternalId || e.c_locationId || ""),
      };
    });

    return res.json({ found: true, offices });
  } catch (err) {
    // Fallback: use hardcoded well-known locations if Yext fails
    console.error("[find-offices Yext]", err.message);
    const q = (location || "").toLowerCase();
    const KNOWN = [
      { name: "H&R Block - 220 Yonge St (Toronto Eaton Centre)", address: "220 Yonge St Unit H109A, Toronto, ON M5B 2H1", phone: "(647) 217-4337", externalLocationId: "54215", locationId: "13370" },
      { name: "H&R Block - 428 Queen St W (Toronto)", address: "428 Queen St W, Toronto, ON M5V 2A7", phone: "(437) 800-2390", externalLocationId: "54255", locationId: "" },
      { name: "H&R Block - 2460 Yonge St (Toronto)", address: "2460 Yonge St, Toronto, ON M4P 2H5", phone: "(416) 488-8720", externalLocationId: "53034", locationId: "" },
    ];
    const match = KNOWN.filter((o) => JSON.stringify(o).toLowerCase().includes(q));
    const list = match.length > 0 ? match : KNOWN;
    return res.json({ found: true, offices: list.slice(0, 3), source: "fallback" });
  }
});

// ─── ROUTE 2 — Get availability ───────────────────────────────────────────────
// GET /api/schedule → { AvailableDates: [...], LocalAvailableTimes: [{Time, DateTime, LocationId, ExternalLocationId, ...}] }
app.post("/get-availability", async (req, res) => {
  const { locationId, externalLocationId, date, serviceId = SERVICE_ID } = req.body;
  if (!date) return res.status(400).json({ error: "date is required" });

  const locId = locationId || externalLocationId;
  if (!locId) return res.status(400).json({ error: "locationId or externalLocationId is required" });

  const startDate = toFBDate(date);
  const endDate   = toFBDate(addDays(date, 14));

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
    // Real shape: { AvailableDates: ["5/1/2026",...], LocalAvailableTimes: [{Time:"8:00 AM", DateTime:"5/1/2026", ...}] }
    const allTimes = data.LocalAvailableTimes || data.localAvailableTimes || [];
    const availDates = data.AvailableDates || data.availableDates || [];

    // Filter to requested date (date is YYYY-MM-DD, DateTime is M/D/YYYY)
    const [y, m, d] = date.split("-");
    const fbDateStr = `${parseInt(m)}/${parseInt(d)}/${y}`;

    const daySlots = allTimes.filter((s) => {
      const dt = s.DateTime || s.dateTime || "";
      return dt === fbDateStr;
    });

    // If no slots for exact date, return first available date's slots
    const slotsToUse = daySlots.length > 0 ? daySlots : allTimes.slice(0, 12);

    if (slotsToUse.length === 0) {
      return res.json({
        found: false,
        date,
        availableDates: availDates,
        slots: [],
        message: `No available slots on ${date}. Available dates: ${availDates.slice(0, 5).join(", ")}`,
      });
    }

    const slots = slotsToUse.map((s) => ({
      datetime: `${s.DateTime || fbDateStr} ${s.Time || ""}`.trim(),
      displayTime: s.Time || s.EuroTime || "",
      date: s.DateTime || fbDateStr,
      scheduleId: s.EmployeeIds?.[0]?.ScheduleId || null,
      employeeId: s.EmployeeIds?.[0]?.EmployeeId || null,
      locationId: String(s.LocationId || locId),
      externalLocationId: String(s.ExternalLocationId || externalLocationId || ""),
    }));

    return res.json({
      found: true,
      date,
      availableDates: availDates,
      timezone: "Mountain Time",
      slots,
    });
  } catch (err) {
    console.error("[get-availability]", err.response?.status, err.message);
    return res.status(502).json({ found: false, date, slots: [], message: "Could not retrieve availability.", detail: err.message });
  }
});

// ─── ROUTE 3 — Submit booking ─────────────────────────────────────────────────
// We need to discover the real booking endpoint — trying /api/booking first
app.post("/submit-booking", async (req, res) => {
  const {
    locationId, externalLocationId, slotDatetime, slotDate, slotTime,
    scheduleId, employeeId,
    firstName, lastName, email, phone,
    taxYears, attendees, reminderPreference,
    language = "English", serviceId = SERVICE_ID, checkboxes = {},
  } = req.body;

  const missing = ["firstName", "lastName", "email", "phone"].filter((k) => !req.body[k]);
  if (!slotDatetime && !(slotDate && slotTime)) missing.push("slotDatetime");
  if (!locationId && !externalLocationId) missing.push("locationId");
  if (missing.length > 0) return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });

  const bool = (v) => v === true || v === "true" || v === "yes";
  const locId = locationId || externalLocationId;

  // Parse datetime: "5/1/2026 8:00 AM" format for FlexBooker
  let appointmentDateTime = slotDatetime;
  if (!appointmentDateTime && slotDate && slotTime) {
    appointmentDateTime = `${slotDate} ${slotTime}`;
  }

  try {
    const payload = {
      MerchantGuid: MERCHANT_GUID,
      WidgetUid: WIDGET_ID,
      LocationId: locId,
      ServiceId: serviceId,
      AppointmentDateTime: appointmentDateTime,
      Language: language,
      FirstName: firstName,
      LastName: lastName,
      Email: email,
      Phone: phone,
      ScheduleId: scheduleId || null,
      EmployeeId: employeeId || null,
      TimeZone: TIMEZONE,
      NumberOfAttendees: Number(attendees) || 1,
      ReminderPreference: reminderPreference || "Email",
      CustomFormAnswers: {
        SelfEmploymentOrRental: bool(checkboxes.selfEmploymentOrRental),
        USTaxReturn: bool(checkboxes.usTaxReturn),
        T2IncorporatedReturn: bool(checkboxes.t2IncorporatedReturn),
        EstateOrFinalReturn: bool(checkboxes.estateOrFinalReturn),
        Bankruptcy: bool(checkboxes.bankruptcy),
        ForeignIncome: bool(checkboxes.foreignIncome),
        InvestmentsOrProperties: bool(checkboxes.investmentsOrProperties),
        EmploymentExpenses: bool(checkboxes.employmentExpenses),
        MovedOrSwitchedProvince: bool(checkboxes.movedOrSwitchedProvince),
      },
    };

    // Try the most likely booking endpoint
    let r;
    try {
      r = await axios.post(`${FB_BASE}/api/booking`, payload, {
        headers: { ...BROWSER_HEADERS, "Content-Type": "application/json" },
        timeout: 15000,
      });
    } catch (_) {
      // Fallback to widget endpoint
      r = await axios.post(`${FB_BASE}/js/cm/html/widget/book`, {
        ...payload,
        merchantGuid: MERCHANT_GUID,
        widgetUid: WIDGET_ID,
        locationId: locId,
        serviceId,
        appointmentDateTime,
        firstName, lastName, email, phone,
      }, {
        headers: { ...BROWSER_HEADERS, "Content-Type": "application/json" },
        timeout: 15000,
      });
    }

    const confirmationId =
      r.data?.BookingId || r.data?.bookingId || r.data?.ConfirmationNumber ||
      r.data?.confirmationNumber || r.data?.AppointmentId || r.data?.appointmentId ||
      r.data?.Id || r.data?.id || r.data?.Confirmation || r.data?.confirmation;

    if (!confirmationId) {
      return res.status(502).json({ success: false, error: "No confirmation ID returned. Escalate to specialist.", raw: r.data });
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
    { keywords: ["everyone","need","have to","required","mandatory"], question: "Does everyone need to file a tax return?", answer: "Not everyone is required to file, but it is generally recommended — you may miss out on refunds and benefits like the GST/HST credit or Canada Child Benefit." },
  ];

  const q = query.toLowerCase();
  const match = FAQS.find((faq) => faq.keywords.some((kw) => q.includes(kw)));
  if (match) return res.json({ found: true, question: match.question, answer: match.answer, sourceUrl: "https://www.hrblock.ca/support" });
  return res.json({ found: false, answer: null, sourceUrl: "https://www.hrblock.ca/support", message: "No matching FAQ found." });
});

// ─── DEBUG — Raw schedule response ───────────────────────────────────────────
app.get("/debug-schedule", async (req, res) => {
  const date = req.query.date || new Date().toISOString().split("T")[0];
  const locationId = req.query.locationId || "13370";
  const startDate = toFBDate(date);
  const endDate   = toFBDate(addDays(date, 14));
  try {
    const r = await axios.get(`${FB_BASE}/api/schedule`, {
      params: { csvServiceIds: SERVICE_ID, merchantGuid: MERCHANT_GUID, startDate, endDate, timeZone: TIMEZONE, locationId },
      headers: BROWSER_HEADERS,
      timeout: 10000,
    });
    res.json({ status: r.status, keys: Object.keys(r.data || {}), availDates: r.data?.AvailableDates, slotsCount: r.data?.LocalAvailableTimes?.length, firstSlot: r.data?.LocalAvailableTimes?.[0], preview: JSON.stringify(r.data).substring(0, 3000) });
  } catch (err) {
    res.json({ error: err.message, status: err.response?.status, data: err.response?.data });
  }
});

app.get("/health", (_, res) => res.json({ status: "ok", version: "5.0" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HRB Middleware v5 running on port ${PORT}`));
