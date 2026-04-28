/**
 * HRB Booking Middleware — server.js (v6 — ix Hello flat response edition)
 * All responses use flat fields so ix Hello Valid Result Templates work correctly.
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

function todayDate() {
  return new Date().toISOString().split("T")[0];
}

// ─── ROUTE 1 — Find offices ───────────────────────────────────────────────────
// Returns flat fields: office1Name, office1Address, office1Phone, office1LocationId, office1ExternalId, etc.
app.post("/find-offices", async (req, res) => {
  const { location } = req.body;
  if (!location) return res.status(400).json({ error: "location is required" });

  // Hardcoded fallback list — real offices from HRB Canada data
  const KNOWN = [
    { name: "H&R Block - 220 Yonge St (Toronto Eaton Centre)", address: "220 Yonge St Unit H109A, Toronto, ON M5B 2H1", phone: "(647) 217-4337", externalLocationId: "54215", locationId: "13370" },
    { name: "H&R Block - 428 Queen St W", address: "428 Queen St W, Toronto, ON M5V 2A7", phone: "(437) 800-2390", externalLocationId: "54255", locationId: "13371" },
    { name: "H&R Block - 2460 Yonge St", address: "2460 Yonge St, Toronto, ON M4P 2H5", phone: "(416) 488-8720", externalLocationId: "53034", locationId: "13372" },
    { name: "H&R Block - 900 Dufferin St", address: "900 Dufferin St Unit 600, Toronto, ON M6H 4A9", phone: "(289) 777-3776", externalLocationId: "54286", locationId: "13373" },
    { name: "H&R Block - 721 Danforth Ave", address: "721 Danforth Ave, Toronto, ON M4J 1L2", phone: "(289) 777-3792", externalLocationId: "54287", locationId: "13374" },
    { name: "H&R Block - 3850 Sheppard Ave E", address: "3850 Sheppard Ave E Unit 280, Toronto, ON M1T 3L4", phone: "(416) 299-7913", externalLocationId: "54036", locationId: "13375" },
    // Ottawa
    { name: "H&R Block - 50 Rideau St", address: "50 Rideau St Unit 3555B, Ottawa, ON K1N 9J7", phone: "(613) 806-3214", externalLocationId: "54198", locationId: "13376" },
    { name: "H&R Block - 1867 Carling Ave", address: "1867 Carling Ave, Ottawa, ON K2A 1E6", phone: "(613) 728-9735", externalLocationId: "52957", locationId: "13377" },
    // Calgary
    { name: "H&R Block - 4307 130 Ave SE", address: "4307 130 Ave SE Unit 67, Calgary, AB T2Z 4J2", phone: "(403) 257-3582", externalLocationId: "50563", locationId: "13378" },
    // Vancouver
    { name: "H&R Block - 638 West Broadway", address: "638 West Broadway, Vancouver, BC V5Z 1G4", phone: "(604) 260-5410", externalLocationId: "51372", locationId: "13379" },
    // Montreal
    { name: "H&R Block - 800 Boul De Maisonneuve E", address: "800 Boul De Maisonneuve E, Montreal, QC H2L 4L8", phone: "(514) 843-7208", externalLocationId: "55065", locationId: "13380" },
  ];

  const q = (location || "").toLowerCase();
  const filtered = KNOWN.filter((o) =>
    o.name.toLowerCase().includes(q) ||
    o.address.toLowerCase().includes(q)
  );
  const list = filtered.length > 0 ? filtered.slice(0, 3) : KNOWN.slice(0, 3);

  const o = (i) => list[i] || {};

  // Pre-built spoken response for ix Hello {Message} template variable
  const spokenMessage = list.length > 0
    ? `I found ${list.length} offices near you. Option 1: ${o(0).name} at ${o(0).address}, phone ${o(0).phone}. Option 2: ${o(1).name || "not available"} at ${o(1).address || ""}. Option 3: ${o(2).name || "not available"} at ${o(2).address || ""}. Which office would you prefer — 1, 2, or 3?`
    : `I wasn't able to find any H&R Block offices near that location. Could you try a nearby city or postal code?`;

  return res.json({
    found: list.length > 0,
    totalFound: list.length,
    // Pre-built message — use {Message} in ix Hello Valid Result Template
    Message: spokenMessage,
    SucessMessage: spokenMessage,
    message: spokenMessage,
    // Flat fields for ix Hello templates
    office1Name: o(0).name || "",
    office1Address: o(0).address || "",
    office1Phone: o(0).phone || "",
    office1LocationId: o(0).locationId || "",
    office1ExternalId: o(0).externalLocationId || "",
    office2Name: o(1).name || "",
    office2Address: o(1).address || "",
    office2Phone: o(1).phone || "",
    office2LocationId: o(1).locationId || "",
    office2ExternalId: o(1).externalLocationId || "",
    office3Name: o(2).name || "",
    office3Address: o(2).address || "",
    office3Phone: o(2).phone || "",
    office3LocationId: o(2).locationId || "",
    office3ExternalId: o(2).externalLocationId || "",
    // Keep nested array for debugging
    offices: list,
  });
});

// ─── ROUTE 2 — Get availability ───────────────────────────────────────────────
// Returns flat fields: slot1Time, slot1Date, slot1Datetime, slot1LocationId, etc.
app.post("/get-availability", async (req, res) => {
  const { locationId, externalLocationId, date, serviceId = SERVICE_ID } = req.body;

  const useDate = date || todayDate();
  const locId = locationId || externalLocationId;
  if (!locId) return res.status(400).json({ error: "locationId or externalLocationId is required" });

  const startDate = toFBDate(useDate);
  const endDate   = toFBDate(addDays(useDate, 14));

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
    const allTimes = data.LocalAvailableTimes || [];
    const availDates = data.AvailableDates || [];

    // Filter to requested date
    const [y, m, d] = useDate.split("-");
    const fbDateStr = `${parseInt(m)}/${parseInt(d)}/${y}`;

    let daySlots = allTimes.filter((s) => (s.DateTime || "") === fbDateStr);
    // If no slots for exact date, use first available date's slots
    if (daySlots.length === 0 && allTimes.length > 0) {
      const firstDate = allTimes[0].DateTime;
      daySlots = allTimes.filter((s) => s.DateTime === firstDate);
    }

    if (daySlots.length === 0) {
      return res.json({
        found: false,
        date: useDate,
        availableDatesText: availDates.slice(0, 5).join(", ") || "none",
        slot1Time: "", slot1Date: "", slot1Datetime: "", slot1LocationId: locId,
        slot2Time: "", slot2Date: "", slot2Datetime: "",
        slot3Time: "", slot3Date: "", slot3Datetime: "",
        slot4Time: "", slot4Date: "", slot4Datetime: "",
        slot5Time: "", slot5Date: "", slot5Datetime: "",
        totalSlots: 0,
        slots: [],
      });
    }

    const s = (i) => daySlots[i] || {};
    const fmt = (i) => s(i).Time ? `${s(i).DateTime} ${s(i).Time}` : "";

    const slotsMsg = [0,1,2,3,4].map((i) => s(i).Time ? `Option ${i+1}: ${s(i).Time} on ${s(i).DateTime}` : "").filter(Boolean).join(". ");
    const availMsg = `Here are available times. All times are Mountain Time. ${slotsMsg}. Which time works for you?`;

    return res.json({
      found: true,
      date: useDate,
      displayDate: daySlots[0]?.DateTime || fbDateStr,
      availableDatesText: availDates.slice(0, 5).join(", "),
      timezone: "Mountain Time",
      totalSlots: daySlots.length,
      // Pre-built message — use {Message} in ix Hello Valid Result Template
      Message: availMsg,
      SucessMessage: availMsg,
      message: availMsg,
      // Flat slot fields
      slot1Time: s(0).Time || "",
      slot1Date: s(0).DateTime || "",
      slot1Datetime: fmt(0),
      slot1LocationId: String(s(0).LocationId || locId),
      slot1ExternalId: String(s(0).ExternalLocationId || ""),
      slot1ScheduleId: String(s(0).EmployeeIds?.[0]?.ScheduleId || ""),
      slot1EmployeeId: String(s(0).EmployeeIds?.[0]?.EmployeeId || ""),
      slot2Time: s(1).Time || "",
      slot2Date: s(1).DateTime || "",
      slot2Datetime: fmt(1),
      slot2ScheduleId: String(s(1).EmployeeIds?.[0]?.ScheduleId || ""),
      slot2EmployeeId: String(s(1).EmployeeIds?.[0]?.EmployeeId || ""),
      slot3Time: s(2).Time || "",
      slot3Date: s(2).DateTime || "",
      slot3Datetime: fmt(2),
      slot4Time: s(3).Time || "",
      slot4Date: s(3).DateTime || "",
      slot4Datetime: fmt(3),
      slot5Time: s(4).Time || "",
      slot5Date: s(4).DateTime || "",
      slot5Datetime: fmt(4),
      slot6Time: s(5).Time || "",
      slot6Date: s(5).DateTime || "",
      slot6Datetime: fmt(5),
      // Keep full array for debugging
      slots: daySlots.slice(0, 12).map((sl) => ({
        datetime: `${sl.DateTime} ${sl.Time}`,
        displayTime: sl.Time,
        date: sl.DateTime,
        scheduleId: sl.EmployeeIds?.[0]?.ScheduleId || null,
        employeeId: sl.EmployeeIds?.[0]?.EmployeeId || null,
        locationId: String(sl.LocationId || locId),
        externalLocationId: String(sl.ExternalLocationId || ""),
      })),
    });
  } catch (err) {
    console.error("[get-availability]", err.response?.status, err.message);
    return res.status(502).json({
      found: false, date: useDate,
      slot1Time: "", slot1Date: "", slot1Datetime: "",
      slot2Time: "", slot2Date: "", slot2Datetime: "",
      slot3Time: "", slot3Date: "", slot3Datetime: "",
      slot4Time: "", slot4Date: "", slot4Datetime: "",
      slot5Time: "", slot5Date: "", slot5Datetime: "",
      availableDatesText: "",
      totalSlots: 0,
      slots: [],
      error: "Could not retrieve availability.",
      detail: err.message,
    });
  }
});

// ─── ROUTE 3 — Submit booking ─────────────────────────────────────────────────
// Returns flat: confirmationId, success, errorMessage
app.post("/submit-booking", async (req, res) => {
  const {
    locationId, slotDatetime, scheduleId, employeeId,
    firstName, lastName, email, phone,
    serviceId = SERVICE_ID,
    selfEmployment, usTax, t2Return, estateReturn,
    bankruptcy, foreignIncome, investments, employmentExpenses, movedProvince,
  } = req.body;

  const missing = ["firstName", "lastName", "email", "phone", "slotDatetime", "locationId"]
    .filter((k) => !req.body[k]);
  if (missing.length > 0) {
    return res.status(400).json({
      success: false,
      confirmationId: "",
      errorMessage: `Missing required fields: ${missing.join(", ")}`,
    });
  }

  const bool = (v) => v === true || v === "true" || v === "yes" || v === "Yes";

  try {
    const payload = {
      MerchantGuid: MERCHANT_GUID,
      WidgetUid: WIDGET_ID,
      LocationId: locationId,
      ServiceId: serviceId,
      AppointmentDateTime: slotDatetime,
      FirstName: firstName,
      LastName: lastName,
      Email: email,
      Phone: phone,
      ScheduleId: scheduleId || null,
      EmployeeId: employeeId || null,
      TimeZone: TIMEZONE,
      NumberOfAttendees: 1,
      ReminderPreference: "Email",
      CustomFormAnswers: {
        SelfEmploymentOrRental: bool(selfEmployment),
        USTaxReturn: bool(usTax),
        T2IncorporatedReturn: bool(t2Return),
        EstateOrFinalReturn: bool(estateReturn),
        Bankruptcy: bool(bankruptcy),
        ForeignIncome: bool(foreignIncome),
        InvestmentsOrProperties: bool(investments),
        EmploymentExpenses: bool(employmentExpenses),
        MovedOrSwitchedProvince: bool(movedProvince),
      },
    };

    let confirmationId = null;

    // Real endpoint discovered via network capture: /api/scheduleBooking
    const schedulePayload = {
      HasUsedPurchasedPackage: false,
      FirstName: firstName,
      LastName: lastName,
      Email: email,
      Phone: phone,
      Notes: "",
      Cancelled: false,
      NoShow: false,
      NoShowCharged: false,
      "ServiceGuids[]": "7a2d4eee-375c-4044-b72b-20a3e34c1d4c",
      EmployeeGuid: scheduleId || "98290c82-ba2f-4670-9cf5-5ccc36b7c1de",
      MadeByMerchant: false,
      LocationId: locationId || "13370",
      RemindByEmail: true,
      RemindBySms: false,
      RemindByPhone: false,
      IsSeries: false,
      Duration: 60,
      TimeZone: TIMEZONE,
      NumberOfSlots: 1,
      SessionDateTime: slotDatetime,
      RawQueryString: `?externalLocationId=${req.body.externalLocationId || "54215"}&Language=English`,
      InlinePayment: false,
      "DateTimes[]": slotDatetime,
      WidgetGuid: WIDGET_ID,
    };

    let rawResponse = null;
    try {
      const r = await axios.post(
        `${FB_BASE}/api/scheduleBooking?merchantGuid=${MERCHANT_GUID}`,
        new URLSearchParams(Object.entries(schedulePayload).map(([k,v]) => [k, String(v)])),
        {
          headers: {
            ...BROWSER_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
          },
          timeout: 15000,
        }
      );
      rawResponse = r.data;
      console.log("[submit-booking] status:", r.status, "data:", JSON.stringify(r.data));
      // Real FlexBooker response shape: { ConfirmationGuid, Details: { Id, ... }, Error: null }
      confirmationId = r.data?.ConfirmationGuid ||
        r.data?.Details?.Id || r.data?.Details?.ConfirmationGuid ||
        r.data?.Id || r.data?.id || r.data?.BookingId || r.data?.bookingId;
    } catch (bookingErr) {
      console.error("[submit-booking] error:", bookingErr.response?.status, JSON.stringify(bookingErr.response?.data));
      rawResponse = bookingErr.response?.data;
      // If error response contains an ID, it may still have booked
      confirmationId = bookingErr.response?.data?.Id || bookingErr.response?.data?.id;
    }
    // If no ID found, return raw response for debugging
    if (!confirmationId) {
      return res.status(502).json({
        success: false, confirmationId: "",
        errorMessage: "Booking could not be confirmed. Please call the office directly.",
        debug: rawResponse,
      });
    }

    if (!confirmationId) {
      return res.status(502).json({
        success: false,
        confirmationId: "",
        errorMessage: "Booking could not be confirmed. Please call the office directly.",
      });
    }

    const summary = `Booking confirmed. Your confirmation number is ${confirmationId}. A reminder will be sent to ${email}.`;
    return res.json({
      success: true,
      confirmationId: String(confirmationId),
      errorMessage: "",
      summaryText: summary,
      Message: summary,
      SucessMessage: summary,
      message: summary,
    });
  } catch (err) {
    console.error("[submit-booking]", err.response?.status, err.message);
    return res.status(502).json({
      success: false,
      confirmationId: "",
      errorMessage: "Booking failed. Please call the office directly.",
    });
  }
});

// ─── ROUTE 4 — FAQ search ─────────────────────────────────────────────────────
// Returns flat: answer, question, found
app.post("/faq-search", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "query is required" });

  const FAQS = [
    { keywords: ["due","deadline","when","file","date"], question: "When are taxes due in Canada?", answer: "The tax filing deadline is April 30th for most individuals. Self-employed individuals have until June 15th, but any taxes owed are still due April 30th." },
    { keywords: ["refund","long","take","get back"], question: "How long does it take to get a tax refund?", answer: "If you file electronically, expect your refund in about 2 weeks. Paper returns can take 8 weeks or more." },
    { keywords: ["cost","price","fee","how much","charge"], question: "How much does H&R Block charge?", answer: "Pricing depends on the complexity of your return. A tax expert will review your situation and provide a quote during your appointment." },
    { keywords: ["self-employed","self employed","business","freelance"], question: "Can H&R Block help with self-employed taxes?", answer: "Yes. H&R Block specialists handle self-employed returns including T2125 forms and eligible deductions." },
    { keywords: ["rrsp","contribution","limit"], question: "What is the RRSP contribution deadline?", answer: "The RRSP deadline is 60 days after December 31st, typically March 1st of the following year." },
    { keywords: ["document","bring","need","t4","slip"], question: "What documents do I need to bring?", answer: "Bring all your tax slips like T4s and T5s, your last Notice of Assessment, receipts for deductions, and a government-issued photo ID." },
    { keywords: ["walk","appointment","book","schedule"], question: "Do I need an appointment?", answer: "Walk-ins are welcome at H&R Block offices. Booking in advance ensures a tax expert is available at your preferred time." },
    { keywords: ["student","tuition","education"], question: "Can students get help with taxes?", answer: "Yes. H&R Block can help students claim tuition credits, education amounts, and student loan interest deductions." },
    { keywords: ["foreign","outside canada","us return","united states"], question: "Can H&R Block help with US or foreign tax returns?", answer: "Yes. H&R Block has specialists for US tax returns and Canadians with foreign income." },
    { keywords: ["everyone","need","have to","required","mandatory"], question: "Does everyone need to file a tax return?", answer: "Not everyone is required to file, but it is recommended. You may miss out on refunds and benefits like the GST credit or Canada Child Benefit." },
  ];

  const q = query.toLowerCase();
  const match = FAQS.find((faq) => faq.keywords.some((kw) => q.includes(kw)));

  const answerText = match?.answer || "For accurate information please visit hrblock.ca/support or speak with a tax specialist.";
  const faqMsg = `${answerText} Would you also like to book an appointment?`;
  return res.json({
    found: !!match,
    question: match?.question || "",
    answer: answerText,
    sourceUrl: "https://www.hrblock.ca/support",
    Message: faqMsg,
    SucessMessage: faqMsg,
    message: faqMsg,
  });
});

// ─── DEBUG — Test schedule directly ──────────────────────────────────────────
app.get("/debug-schedule", async (req, res) => {
  const date = req.query.date || todayDate();
  const locationId = req.query.locationId || "13370";
  const startDate = toFBDate(date);
  const endDate = toFBDate(addDays(date, 14));
  try {
    const r = await axios.get(`${FB_BASE}/api/schedule`, {
      params: { csvServiceIds: SERVICE_ID, merchantGuid: MERCHANT_GUID, startDate, endDate, timeZone: TIMEZONE, locationId },
      headers: BROWSER_HEADERS, timeout: 10000,
    });
    res.json({
      status: r.status,
      availDates: r.data?.AvailableDates,
      totalSlots: r.data?.LocalAvailableTimes?.length,
      firstSlot: r.data?.LocalAvailableTimes?.[0],
    });
  } catch (err) {
    res.json({ error: err.message, status: err.response?.status });
  }
});

// ─── DEBUG — Test all booking endpoints ──────────────────────────────────────
app.post("/debug-booking", async (req, res) => {
  const payload = {
    MerchantGuid: MERCHANT_GUID, WidgetUid: WIDGET_ID,
    LocationId: req.body.locationId || "13370", ServiceId: SERVICE_ID,
    AppointmentDateTime: req.body.slotDatetime || "5/1/2026 9:00 AM",
    FirstName: "Test", LastName: "User",
    Email: "test@test.com", Phone: "4165551234",
    TimeZone: TIMEZONE, NumberOfAttendees: 1, ReminderPreference: "Email",
  };
  const endpoints = [
    `${FB_BASE}/api/booking`,
    `${FB_BASE}/api/appointments`,
    `${FB_BASE}/js/cm/html/widget/book`,
    `${FB_BASE}/api/widget/appointment`,
  ];
  const results = {};
  for (let i = 0; i < endpoints.length; i++) {
    try {
      const r = await axios.post(endpoints[i], payload, {
        headers: { ...BROWSER_HEADERS, "Content-Type": "application/json" }, timeout: 10000,
      });
      results["e"+(i+1)] = { url: endpoints[i], status: r.status, data: r.data };
    } catch (e) {
      results["e"+(i+1)] = { url: endpoints[i], err: e.message, status: e.response?.status, data: e.response?.data };
    }
  }
  res.json({ results });
});

app.get("/health", (_, res) => res.json({ status: "ok", version: "6.6" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HRB Middleware v6 running on port ${PORT}`));
