/**
 * HRB Booking Middleware — server.js
 *
 * Exposes 4 clean REST endpoints your voice platform calls:
 *   POST /find-offices        { location: "Toronto" }
 *   POST /get-availability    { externalLocationId: "54215", date: "2026-04-29" }
 *   POST /submit-booking      { ...all booking fields }
 *   POST /faq-search          { query: "when are taxes due" }
 *
 * Run:  node server.js
 * Deps: npm install express axios cheerio cors
 */

const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cors());

const WIDGET_ID = "e0e2ffe4-bf80-48a6-9223-8357ec2267af";
const FLEXBOOKER_BASE = `https://a.flexbooker.com`;
const LOCATOR_URL = "https://www.hrblock.ca/office-locator";
const SUPPORT_URL = "https://www.hrblock.ca/support";

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE 1 — Find offices by city or postal code
// POST /find-offices  { location: "Toronto" | "M5B 2H1" }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/find-offices", async (req, res) => {
  const { location } = req.body;
  if (!location) return res.status(400).json({ error: "location is required" });

  try {
    // Fetch the office locator page — offices are rendered in HTML
    const { data: html } = await axios.get(LOCATOR_URL, {
      headers: { "Accept-Language": "en-CA,en;q=0.9" },
      timeout: 10000,
    });

    const $ = cheerio.load(html);
    const offices = [];
    const query = location.toLowerCase().trim();

    // Each office card contains an address and a "Book an Appointment" link
    // The link href encodes the externalLocationId we need
    $("a[href*='externalLocationId']").each((_, el) => {
      const bookingHref = $(el).attr("href") || "";
      const match = bookingHref.match(/externalLocationId=(\d+)/);
      if (!match) return;

      const externalLocationId = match[1];

      // Walk up to the parent card to extract address text
      const card = $(el).closest("div, section, article, li");
      const cardText = card.text().replace(/\s+/g, " ").trim();
      const addressEl = card.find("address, p, span").first();
      const address = addressEl.text().trim() || cardText.substring(0, 80);

      // Filter: only return offices where the address contains the query string
      if (
        address.toLowerCase().includes(query) ||
        cardText.toLowerCase().includes(query)
      ) {
        // Extract office name — usually the first strong/h element in the card
        const name =
          card.find("h2, h3, h4, strong, b").first().text().trim() ||
          `H&R Block ${address.split(",")[0]}`;

        // Extract phone if present
        const phoneMatch = cardText.match(/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/);
        const phone = phoneMatch ? phoneMatch[0] : "";

        offices.push({ name, address, phone, externalLocationId, bookingHref });
      }
    });

    if (offices.length === 0) {
      return res.json({
        found: false,
        message: `No offices found for "${location}". Try a nearby city or full postal code.`,
        offices: [],
      });
    }

    // Return at most 3 offices
    return res.json({ found: true, offices: offices.slice(0, 3) });
  } catch (err) {
    console.error("[find-offices]", err.message);
    return res.status(502).json({ error: "Failed to fetch office list", detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE 2 — Get availability for an office + date
// POST /get-availability  { externalLocationId: "54215", date: "2026-04-29", language: "English" }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/get-availability", async (req, res) => {
  const { externalLocationId, date, language = "English" } = req.body;
  if (!externalLocationId || !date) {
    return res.status(400).json({ error: "externalLocationId and date are required" });
  }

  try {
    // FlexBooker widget page — loads availability via its own internal API
    // We fetch the widget and intercept the availability data embedded as JSON
    const widgetUrl = `${FLEXBOOKER_BASE}/widget/${WIDGET_ID}?externalLocationId=${externalLocationId}&Language=${language}`;

    const { data: html } = await axios.get(widgetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
      },
      timeout: 10000,
    });

    // FlexBooker embeds initial state as JSON in a <script> tag
    // Pattern: window.__INITIAL_STATE__ = {...} or similar
    const jsonMatch =
      html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/s) ||
      html.match(/var\s+appData\s*=\s*({.+?});/s);

    // Fallback: call FlexBooker's internal REST endpoint directly
    // The widget calls: GET /api/accounts/{widgetId}/locations/{locationId}/slots?date=YYYY-MM-DD
    const slotsUrl = `${FLEXBOOKER_BASE}/api/accounts/${WIDGET_ID}/locations/${externalLocationId}/slots?date=${date}`;

    let slots = [];

    try {
      const { data: slotsData } = await axios.get(slotsUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: widgetUrl,
          Accept: "application/json",
        },
        timeout: 8000,
      });

      // Normalize whatever shape FlexBooker returns
      const raw = Array.isArray(slotsData)
        ? slotsData
        : slotsData.slots || slotsData.availableSlots || slotsData.times || [];

      slots = raw.map((s) => ({
        datetime: s.startDateTime || s.datetime || s.start || s,
        displayTime: s.displayTime || s.label || s.startDateTime || String(s),
      }));
    } catch (slotErr) {
      // If the direct endpoint returns 404/403, report no availability
      // rather than inventing slots
      console.warn("[get-availability] slots endpoint failed:", slotErr.message);
      return res.json({
        found: false,
        date,
        slots: [],
        message: `No availability data returned for ${date}. Try a different date.`,
      });
    }

    if (slots.length === 0) {
      return res.json({
        found: false,
        date,
        slots: [],
        message: `No available slots at this office on ${date}.`,
      });
    }

    return res.json({ found: true, date, timezone: "Eastern Time", slots: slots.slice(0, 10) });
  } catch (err) {
    console.error("[get-availability]", err.message);
    return res.status(502).json({ error: "Failed to fetch availability", detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE 3 — Submit a booking
// POST /submit-booking  { ...all fields }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/submit-booking", async (req, res) => {
  const {
    externalLocationId,
    slotDatetime,
    firstName,
    lastName,
    email,
    phone,
    taxYears,
    attendees,
    reminderPreference,
    language = "English",
    checkboxes = {},
  } = req.body;

  // Validate required fields before hitting FlexBooker
  const required = { externalLocationId, slotDatetime, firstName, lastName, email, phone };
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(", ")}` });
  }

  try {
    // FlexBooker booking POST endpoint
    const bookingUrl = `${FLEXBOOKER_BASE}/api/accounts/${WIDGET_ID}/bookings`;

    const payload = {
      locationExternalId: externalLocationId,
      appointmentDateTime: slotDatetime,
      customer: {
        firstName,
        lastName,
        email,
        phone,
      },
      customFields: {
        taxYearsToFile: taxYears || 1,
        numberOfAttendees: attendees || 1,
        reminderPreference: reminderPreference || "Email",
        language,
        // Checkbox fields mapped to FlexBooker custom field names
        selfEmploymentOrRental: checkboxes.selfEmploymentOrRental || false,
        usTaxReturn: checkboxes.usTaxReturn || false,
        t2IncorporatedReturn: checkboxes.t2IncorporatedReturn || false,
        estateOrFinalReturn: checkboxes.estateOrFinalReturn || false,
        bankruptcy: checkboxes.bankruptcy || false,
        foreignIncome: checkboxes.foreignIncome || false,
        investmentsOrProperties: checkboxes.investmentsOrProperties || false,
        employmentExpenses: checkboxes.employmentExpenses || false,
        movedOrSwitchedProvince: checkboxes.movedOrSwitchedProvince || false,
      },
    };

    const { data: bookingResult } = await axios.post(bookingUrl, payload, {
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: `${FLEXBOOKER_BASE}/widget/${WIDGET_ID}`,
      },
      timeout: 15000,
    });

    // Strict success check — must have a real confirmation ID
    const confirmationId =
      bookingResult.bookingId ||
      bookingResult.confirmationNumber ||
      bookingResult.id ||
      bookingResult.confirmation;

    if (!confirmationId) {
      console.warn("[submit-booking] No confirmation ID in response:", bookingResult);
      return res.status(502).json({
        success: false,
        error: "Booking submitted but no confirmation ID returned. Escalate to specialist.",
        raw: bookingResult,
      });
    }

    return res.json({
      success: true,
      confirmationId,
      message: `Booking confirmed. Confirmation ID: ${confirmationId}`,
    });
  } catch (err) {
    console.error("[submit-booking]", err.message);
    return res.status(502).json({
      success: false,
      error: "Booking failed due to a system error. Escalate to specialist.",
      detail: err.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE 4 — FAQ search from H&R Block support page
// POST /faq-search  { query: "when are taxes due in Canada" }
// ─────────────────────────────────────────────────────────────────────────────
app.post("/faq-search", async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: "query is required" });

  try {
    const { data: html } = await axios.get(SUPPORT_URL, {
      headers: { "Accept-Language": "en-CA,en;q=0.9" },
      timeout: 10000,
    });

    const $ = cheerio.load(html);
    const q = query.toLowerCase();
    const results = [];

    // FAQ items are typically in accordion/details elements
    // Each has a question heading and an answer body
    $("details, .faq-item, [data-faq], .accordion-item").each((_, el) => {
      const questionEl = $(el).find("summary, .faq-question, h3, h4, strong").first();
      const answerEl = $(el).find("p, .faq-answer, .accordion-body").first();
      const question = questionEl.text().trim();
      const answer = answerEl.text().trim();

      if (!question || !answer) return;

      // Simple relevance: question or answer contains any word from the query
      const words = q.split(/\s+/).filter((w) => w.length > 3);
      const isRelevant = words.some(
        (w) => question.toLowerCase().includes(w) || answer.toLowerCase().includes(w)
      );

      if (isRelevant) {
        results.push({ question, answer: answer.substring(0, 300) });
      }
    });

    if (results.length === 0) {
      return res.json({
        found: false,
        answer: null,
        sourceUrl: SUPPORT_URL,
        message: "No matching FAQ found.",
      });
    }

    return res.json({
      found: true,
      answer: results[0].answer,
      question: results[0].question,
      sourceUrl: SUPPORT_URL,
    });
  } catch (err) {
    console.error("[faq-search]", err.message);
    return res.status(502).json({ error: "Failed to fetch FAQ", detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HRB Middleware running on port ${PORT}`));
