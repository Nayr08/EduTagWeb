// ✅ Supabase client initialization 
const SUPABASE_URL = "https://ofrngrggkgtfnfdlbmum.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mcm5ncmdna2d0Zm5mZGxibXVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3ODYxOTYsImV4cCI6MjA3MjM2MjE5Nn0.qgYkiUmesBQCoSUkrLhMuCmO2IxDSahQUZPKHhUGjnE";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ✅ Global student identifiers
let currentStudentPk = null;      // idstudent_info (primary key)
let currentStudentSchoolId = null; // student_id (school ID)

// ✅ Helper: Get query parameter
function getQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

// ✅ Fetch student info
async function loadStudent(loginStudentId) {
  const { data, error } = await supabaseClient
    .from("student_info")
    .select("idstudent_info, student_id, name")
    .eq("student_id", loginStudentId)
    .single();

  if (error || !data) {
    console.error("❌ Error fetching student:", error);
    document.getElementById("studentName").textContent = "Unknown Student";
    return null;
  }

  document.getElementById("studentName").textContent = data.name;

  // ✅ Save both identifiers globally
  currentStudentPk = data.idstudent_info;
  currentStudentSchoolId = data.student_id;

  // Initial load of events
  loadEvents(currentStudentPk);

  return data;
}

// ✅ Fetch events with filter + search
// ✅ Fetch events with filter + search
async function loadEvents(studentPK, statusFilter = "", searchText = "") {
  const { data: events, error } = await supabaseClient
    .from("event_info")
    .select("*")
    .order("date", { ascending: false });

  const eventsList = document.getElementById("eventsList");
  eventsList.innerHTML = "";

  if (error) {
    console.error("❌ Error fetching events:", error);
    eventsList.innerHTML = "<p>Failed to load events.</p>";
    return;
  }

  if (!events || events.length === 0) {
    eventsList.innerHTML = "<p>No events found.</p>";
    return;
  }

  // ✅ Fetch ALL attendance records for this student once
  const { data: allAttendance, error: attError } = await supabaseClient
    .from("attendance")
    .select("event_id, status")
    .eq("student_id", studentPK);

  if (attError) {
    console.error("❌ Error fetching all attendance:", attError);
  }

  // ✅ Apply filters
  let filtered = events;
  if (statusFilter && statusFilter !== "all") {
    filtered = filtered.filter(e => e.status === statusFilter);
  }
  if (searchText) {
    const lower = searchText.toLowerCase().trim();
    filtered = filtered.filter(e => e.event_name.toLowerCase().includes(lower));
  }

  for (let event of filtered) {
    // Find attendance record for this event from the fetched data
    const attendanceData = allAttendance?.find(att => att.event_id === event.idevent_info);

    // ✅ Determine event status text (upcoming / ongoing / completed)
    let eventStatusText = "";
    if (event.status === "upcoming") {
      eventStatusText = "Upcoming";
    } else if (event.status === "ongoing") {
      eventStatusText = "Ongoing";
    } else if (event.status === "completed") {
      eventStatusText = "Completed";
    }

    // ✅ Determine attendance status text and color
    let attendanceText = "";
    let attendanceColor = "";

    if (event.status === "upcoming") {
      attendanceText = "NOT YET AVAILABLE";
      attendanceColor = "#d9edf7"; // light blue
    } else if (event.status === "ongoing") {
      if (!attendanceData) {
        attendanceText = "NOT YET PRESENT";
        attendanceColor = "#fff3cd";
      } else if (attendanceData.status === "present") {
        attendanceText = "PRESENT";
        attendanceColor = "#c6f6d5";
      } else if (attendanceData.status === "late") {
        attendanceText = "LATE";
        attendanceColor = "#EAEA83";
      }
    } else if (event.status === "completed") {
      if (!attendanceData) {
        attendanceText = "ABSENT";
        attendanceColor = "#fed7d7";
      } else {
        switch (attendanceData.status) {
          case "present":
            attendanceText = "PRESENT";
            attendanceColor = "#c6f6d5";
            break;
          case "late":
            attendanceText = "LATE";
            attendanceColor = "#EAEA83";
            break;
          case "absent":
            attendanceText = "ABSENT";
            attendanceColor = "#fed7d7";
            break;
        }
      }
    }

    // ✅ Display both event status and attendance status separately
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div class="event-title">${event.event_name}</div>
      <div class="event-time">${formatDate(event.date)}</div>
      <div class="event-time">${formatTime(event.time_start)} - ${formatTime(event.time_end)}</div>
      <div class="event-status">
  <span class="status-badge ${event.status.toLowerCase()}">${eventStatusText}</span>
</div>

      <div class="attendance-status" style="background-color:${attendanceColor}">${attendanceText}</div>
    `;
    eventsList.appendChild(item);
  }
}


// ✅ Format date YYYY-MM-DD
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ✅ Format time 12-hour AM/PM
function formatTime(timeStr) {
  if (!timeStr) return "";
  const [hh, mm] = timeStr.split(":");
  let hour = parseInt(hh, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${hour}:${mm} ${ampm}`;
}

// ✅ Event filter + search listeners
document.getElementById("eventFilter").addEventListener("change", e => {
  loadEvents(currentStudentPk, e.target.value, document.getElementById("eventSearch").value);
});

document.getElementById("eventSearch").addEventListener("input", debounce(e => {
  loadEvents(currentStudentPk, document.getElementById("eventFilter").value, e.target.value);
}, 300));

function debounce(func, delay) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}

// ✅ Logout modal toggle
const studentNameEl = document.getElementById("studentName");
const logoutModal = document.getElementById("logoutModal");
const cancelLogout = document.getElementById("cancelLogout");
const confirmLogout = document.getElementById("confirmLogout");

studentNameEl.addEventListener("click", () => logoutModal.classList.remove("hidden"));
cancelLogout.addEventListener("click", () => logoutModal.classList.add("hidden"));
confirmLogout.addEventListener("click", async () => {
  const { error } = await supabaseClient.auth.signOut();
  if (!error) {
    window.location.href = "index.html";
  }
});


// ✅ Fetch sanctions - uses school ID
async function loadSanctions(schoolId) {
  const showResolved = document.getElementById("showResolvedCheckbox")?.checked || false;

  let query = supabaseClient
    .from("sanctions")
    .select("event_name, penalty, fee, date_given, status")
    .eq("student_id", schoolId) // Uses student_id (school ID like "2021-001")
    .order("date_given", { ascending: false });

  // ✅ Only exclude resolved if checkbox is not ticked
  if (!showResolved) {
    query = query.neq("status", "resolved");
  }

  const { data: sanctions, error } = await query;

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

  let totalFee = 0;
  sanctions.forEach(sanction => {
    const item = document.createElement("div");
    item.className = "list-item sanction";

    totalFee += sanction.fee || 0;

    item.innerHTML = `
      <div><strong>Event:</strong> ${sanction.event_name}</div>
      <div><strong>Penalty:</strong> ${sanction.penalty}</div>
      <div><strong>Fee:</strong> ₱${sanction.fee}</div>
      <div><strong>Date Given:</strong> ${sanction.date_given}</div>
      <div><strong>Status:</strong> <span class="status-badge ${sanction.status}">${sanction.status}</span></div>
    `;
    sanctionsList.appendChild(item);
  });

  totalFeeEl.textContent = `Total Fee: ₱${totalFee}`;
}


// ✅ Init
document.addEventListener("DOMContentLoaded", async () => {
  const studentId = getQueryParam("student_id"); // School ID from URL
  if (!studentId) {
    alert("No student ID found. Please log in again.");
    window.location.href = "LogInPage.html";
    return;
  }

  const student = await loadStudent(studentId);
  if (student) {
    // Use school ID for sanctions (student_id column)
    await loadSanctions(currentStudentSchoolId);

    // ✅ Add checkbox listener for show resolved
    const showResolvedCheckbox = document.getElementById("showResolvedCheckbox");
    if (showResolvedCheckbox) {
      showResolvedCheckbox.addEventListener("change", () => {
        loadSanctions(currentStudentSchoolId);
      });
    }
  }
});