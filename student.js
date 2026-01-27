// ✅ Supabase client initialization
const SUPABASE_URL = "https://ofrngrggkgtfnfdlbmum.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mcm5ncmdna2d0Zm5mZGxibXVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3ODYxOTYsImV4cCI6MjA3MjM2MjE5Nn0.qgYkiUmesBQCoSUkrLhMuCmO2IxDSahQUZPKHhUGjnE";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ✅ Helper: Get query parameter
function getQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

// ✅ Fetch student info
async function loadStudent(studentId) {
  const { data, error } = await supabaseClient
    .from("student_info")
    .select("idstudent_info, name")
    .eq("student_id", studentId)
    .single();

  if (error || !data) {
    console.error("❌ Error fetching student:", error);
    document.getElementById("studentName").textContent = "Unknown Student";
    return null;
  }

  document.getElementById("studentName").textContent = data.name;
  return data;
}

// ✅ Fetch events
async function loadEvents() {
  const { data: events, error } = await supabaseClient
    .from("event_info")
    .select("event_name, date, time_start, time_end, status")
    .order("date", { ascending: true });

  const eventsList = document.getElementById("eventsList");
  eventsList.innerHTML = "";

  if (error) {
    console.error("❌ Error fetching events:", error);
    eventsList.innerHTML = "<p>Failed to load events.</p>";
    return;
  }

  if (!events || events.length === 0) {
    eventsList.innerHTML = "<p>No upcoming events.</p>";
    return;
  }

  events.forEach(event => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div class="event-title">${event.event_name}</div>
      <div class="event-status ${event.status}">${event.status}</div>
      <div class="event-time">Date: ${event.date} | ${event.time_start} - ${event.time_end}</div>
    `;
    eventsList.appendChild(item);
  });
}

// ✅ Fetch sanctions

async function loadSanctions(studentId) {
  const { data: sanctions, error } = await supabaseClient
    .from("sanctions")
    .select("event_name, penalty, fee, date_given")
    .eq("student_id", studentId);

  const sanctionsList = document.getElementById("sanctionsList");
  const totalFeeEl = document.getElementById("totalFee");
  sanctionsList.innerHTML = "";

  if (error) {
    console.error("❌ Error fetching sanctions:", error);
    sanctionsList.innerHTML = "<p>Failed to load sanctions.</p>";
    totalFeeEl.textContent = "Total Fee: ₱0";
    return;
  }

  if (!sanctions || sanctions.length === 0) {
    sanctionsList.innerHTML = "<p>Good work, no sanctions 🎉</p>";
    totalFeeEl.textContent = "Total Fee: ₱0";
    return;
  }

  // Calculate total fee
  let totalFee = 0;
sanctions.forEach(sanction => {
  const item = document.createElement("div");
  item.className = "list-item sanction";

  totalFee += sanction.fee || 0;

  // ✅ Format date to show YYYY-MM-DD HH:MM
  let dateTime = "";
  if (sanction.date_given) {
    const d = new Date(sanction.date_given);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    dateTime = `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  }

  item.innerHTML = `
    <div><strong>Event:</strong> ${sanction.event_name}</div>
    <div><strong>Penalty:</strong> ${sanction.penalty}</div>
    <div><strong>Fee:</strong> ₱${sanction.fee}</div>
    <div><strong>Date Given:</strong> ${dateTime}</div>
  `;
  sanctionsList.appendChild(item);
});


  // Show total fee
  totalFeeEl.textContent = `Total Fee: ₱${totalFee}`;
}



// ✅ Init
document.addEventListener("DOMContentLoaded", async () => {
  const studentId = getQueryParam("student_id"); // this is the school ID
  if (!studentId) {
    alert("No student ID found. Please log in again.");
    window.location.href = "LogInPage.html";
    return;
  }

  const student = await loadStudent(studentId);
  if (student) {
    await loadEvents();
    await loadSanctions(studentId); // use studentId string, not idstudent_info
  }
});

