// ✅ Supabase client initialization
// ⚠️ Add your Supabase credentials here (store in environment variables for production)
const SUPABASE_URL = "YOUR_SUPABASE_URL_HERE";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY_HERE";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

// -------------------- STUDENTS --------------------
async function loadStudents() {
  const { data, error } = await supabaseClient
    .from("student_info")
    .select(`
      idstudent_info,
      student_id,
      name,
      year_level,
      password,
      rfid,
      status,
      team_id,
      teams (team_name)  -- join
    `)
    .order("idstudent_info", { ascending: true });

  if (error) {
    console.error("❌ Error loading students:", error);
    return;
  }

  const table = document.getElementById("studentsTable");
  table.innerHTML = "";

  data.forEach((student) => {
   const row = `
  <tr>
    <td>${student.student_id}</td>
    <td>${student.name}</td>
    <td>${student.year_level}</td>
    <td>
  <div class="password-cell">
    <span class="masked-password" data-password="${student.password}">••••••••</span>
    <button type="button" class="password-toggle-btn" onclick="togglePasswordRow(this)">
      <i class="fas fa-eye"></i>
    </button>
  </div>
</td>

    <td>${student.teams ? student.teams.team_name : "-"}</td>
    <td>${student.rfid}</td>
    <td>
      <span class="status-badge ${student.status === "active" ? "present" : "inactive"}">
        ${student.status}
      </span>
    </td>
    <td>
      <button class="btn btn-secondary" onclick="editStudent(${student.idstudent_info})">
        <i class="fas fa-edit"></i>
      </button>
      <button class="btn btn-danger" onclick="deleteStudent(${student.idstudent_info})">
        <i class="fas fa-trash"></i>
      </button>
    </td>
  </tr>
`;


    table.innerHTML += row;
  });
}
function togglePasswordRow(button) {
  const cell = button.closest("td");
  const span = cell.querySelector(".masked-password");
  const icon = button.querySelector("i");

  if (span.innerText === "••••••••") {
    span.innerText = span.dataset.password; // show real password
    icon.classList.remove("fa-eye");
    icon.classList.add("fa-eye-slash");
  } else {
    span.innerText = "••••••••"; // mask again
    icon.classList.remove("fa-eye-slash");
    icon.classList.add("fa-eye");
  }
}


async function deleteStudent(id) {
  const ok = confirm("Delete this student? This cannot be undone.");
  if (!ok) return;

  const { error } = await supabaseClient
    .from("student_info")
    .delete()
    .eq("idstudent_info", id);

  if (error) {
    console.error("❌ Error deleting student:", error);
    alert("Failed to delete. Check constraints (attendance, sanctions).");
    return;
  }
  showNotification("🗑️ Student deleted", "success");
  loadStudents();
}

async function addStudent() {
  const studentId = document.getElementById("studentId").value.trim();
  const studentName = document.getElementById("studentName").value.trim();
  const studentYear = document.getElementById("studentYear").value;
  const studentPassword = document.getElementById("studentPassword").value.trim();
  const studentRfid = document.getElementById("studentRfid").value.trim();
  const studentTeam = document.getElementById("studentTeam").value;

  if (!studentId || !studentName || !studentPassword || !studentRfid || !studentYear) {
    alert("⚠️ Please fill in all required fields.");
    return;
  }

  const { error } = await supabaseClient.from("student_info").insert([
    {
      student_id: studentId,
      name: studentName,
      year_level: studentYear,
      password: studentPassword,
      rfid: studentRfid,
      team_id: studentTeam || null,
      status: "active"
    }
  ]);

  if (error) {
    console.error("❌ Error adding student:", error);
    alert("Error adding student. Check console for details.");
    return;
  }

  alert("✅ Student added successfully!");
  loadStudents();
  closeModal("addStudentModal");
  document.getElementById("addStudentForm").reset();
}
// Load teams into edit modal
async function loadEditStudentTeams(selectedTeamId = null) {
  const { data, error } = await supabaseClient
    .from("teams")
    .select("idteam, team_name")
    .order("team_name", { ascending: true });

  if (error) {
    console.error("❌ Error loading teams:", error);
    return;
  }

  const dropdown = document.getElementById("editStudentTeam");
  dropdown.innerHTML = `<option value="">Select Team</option>`;
  data.forEach(team => {
    dropdown.innerHTML += `<option value="${team.idteam}">${team.team_name}</option>`;
  });

  // Preselect student's team if available
  if (selectedTeamId) {
    dropdown.value = selectedTeamId;
  }
}

// Load teams into a <select> by element id
async function loadTeams() {
  const { data, error } = await supabaseClient
    .from("teams")
    .select("idteam, team_name")
    .order("team_name", { ascending: true });

  if (error) {
    console.error("❌ Error loading teams:", error);
    return;
  }

  const dropdown = document.getElementById("studentTeam");
  if (!dropdown) return;

  dropdown.innerHTML = `<option value="">Select Team</option>`;
  data.forEach((team) => {
    dropdown.innerHTML += `<option value="${team.idteam}">${team.team_name}</option>`;
  });
}



// Run on page load
document.addEventListener("DOMContentLoaded", loadTeams);


// -------------------- EVENTS --------------------
async function loadEvents() {
  const { data, error } = await supabaseClient
    .from("event_info")
    .select("idevent_info, event_name, date, time_start, time_end, late_until, status")
    .order("date", { ascending: true });

  if (error) {
    console.error("❌ Error loading events:", error);
    return;
  }

  const table = document.getElementById("eventsTable");
  table.innerHTML = "";

  data.forEach((event) => {
    const row = `
      <tr>
        <td>${event.event_name}</td>
        <td>${event.date}</td>
        <td>${event.time_start}</td>
        <td>${event.time_end}</td>
        <td><span class="status-badge ${event.status}">${event.status}</span></td>
        <td>
          <button class="btn btn-secondary" onclick="editEvent(${event.idevent_info})">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn btn-danger" onclick="deleteEvent(${event.idevent_info})">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
    table.innerHTML += row;
  });
}



function getEventStatus(eventDate, startTime, lateUntil) {
  const now = new Date();
  const eventStart = new Date(`${eventDate}T${startTime}`);
  const eventLate = new Date(`${eventDate}T${lateUntil}`);

  if (now < eventStart) return "upcoming";
  if (now >= eventStart && now <= eventLate) return "ongoing";
  return "completed";
}


// ✅ Create new event with late_until, status auto-set to upcoming
// ✅ Create new event with late_until
async function createEvents() {
  const eventName = document.getElementById("eventName").value.trim();
  const eventDate = document.getElementById("eventDate").value;
  const startTimeRaw = document.getElementById("startTime").value;
  const endTimeRaw = document.getElementById("endTime").value;
  const lateUntilRaw = document.getElementById("lateUntil").value;

  if (!eventName || !eventDate || !startTimeRaw || !endTimeRaw || !lateUntilRaw) {
    alert("⚠️ Please fill in all fields.");
    return;
  }

  function formatTo24Hour(timeStr) {
    if (!timeStr) return null;
    let [hours, minutes] = timeStr.split(":");
    return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}:00`;
  }

  const startTime = formatTo24Hour(startTimeRaw);
  const endTime = formatTo24Hour(endTimeRaw);
  const lateUntil = formatTo24Hour(lateUntilRaw);

  const { error } = await supabaseClient.from("event_info").insert([
    {
      event_name: eventName,
      date: eventDate,           // ✅ column is "date"
      time_start: startTime,     // ✅ column is "time_start"
      time_end: endTime,         // ✅ column is "time_end"
      late_until: lateUntil,     // ✅ new column
      status: "upcoming",        // default
    },
  ]);

  if (error) {
    console.error("❌ Error inserting event:", error);
    alert("Error creating event. Check console for details.");
  } else {
    alert("✅ Event created successfully!");
    closeModal("addEventModal");
    loadEvents(); // refresh events table
  }
}



// -------------------- ATTENDANCE --------------------
let scanningInterval = null;
let lastUID = null;
let scanning = false;

// ✅ Toggle scanning (start/stop in one button)
function toggleScanning() {
  const btn = document.getElementById("scanToggleBtn");

  if (!scanning) {
    scanning = true;
    btn.classList.remove("start");
    btn.classList.add("stop");
    btn.innerHTML = `<i class="fas fa-stop"></i> Stop Scanning`;

    document.getElementById("rfidStatus").innerText = "Scanning...";
    document.getElementById("rfidIndicator").classList.add("active");

    scanningInterval = setInterval(checkRFID, 2000);
  } else {
    scanning = false;
    btn.classList.remove("stop");
    btn.classList.add("start");
    btn.innerHTML = `<i class="fas fa-play"></i> Start Scanning`;

    document.getElementById("rfidStatus").innerText = "RFID Scanner Ready";
    document.getElementById("rfidIndicator").classList.remove("active");

    clearInterval(scanningInterval);
    scanningInterval = null;
    lastUID = null;

    document.getElementById("lastScannedInfo").innerText = "No card detected";
  }
}

// ✅ Test scanner
let testing = false;
let testingInterval = null;

function testScanner(button) {
  if (!testing) {
    // Enable testing
    testing = true;
    button.style.backgroundColor = "gold";
    document.getElementById("lastScanned").querySelector("h3").innerText = "Testing Scan";
    document.getElementById("lastScannedInfo").innerText = "🟡 Waiting for card...";

    testingInterval = setInterval(async () => {
      try {
        const res = await fetch("http://localhost:3000/last-scan");
        const { uid } = await res.json();

        if (!uid) {
          document.getElementById("lastScannedInfo").innerText = "🟡 No card detected";
          return;
        }

        // Find student if exists
        const { data: student } = await supabaseClient
          .from("student_info")
          .select("name")
          .eq("rfid", uid)
          .maybeSingle();

        if (student) {
          document.getElementById("lastScannedInfo").innerText = `🟡 Testing: ${student.name} (${uid})`;
        } else {
          document.getElementById("lastScannedInfo").innerText = `🟡 Testing: Unknown card (${uid})`;
        }
      } catch (err) {
        document.getElementById("lastScannedInfo").innerText = "❌ Error during test";
      }
    }, 1500);

  } else {
    // Disable testing
    testing = false;
    button.style.backgroundColor = "";
    clearInterval(testingInterval);
    testingInterval = null;
    document.getElementById("lastScanned").querySelector("h3").innerText = "Last Scanned";
    document.getElementById("lastScannedInfo").innerText = "No card detected";
  }
}


// ✅ Update event statuses, mark absentees, and close events
// ✅ Update event statuses, mark absentees, and close events
async function updateEventsAndSanctions() {
  try {
    const now = new Date();

    // 1. Get all events
    const { data: events, error } = await supabaseClient
      .from("event_info")
      .select("idevent_info, event_name, date, time_start, time_end, late_until, status, closed");

    if (error) {
      console.error("❌ Error fetching events:", error);
      return;
    }

    for (const event of events) {
      const eventDate = event.date; // ✅ match your DB column
      if (!eventDate) continue;

      const start = new Date(`${eventDate}T${event.time_start}`);
      const end = new Date(`${eventDate}T${event.time_end}`);
      const lateUntil = new Date(`${eventDate}T${event.late_until}`);

      let newStatus = event.status;
      let shouldClose = event.closed;

      if (now < start) {
        // Before start
        newStatus = "upcoming";
      } else if (now >= start && now <= lateUntil) {
        // From start until late_until (includes late grace period)
        newStatus = "ongoing";
      } else if (now > lateUntil) {
        // After late_until
        newStatus = "completed";
        shouldClose = true;
      }

      // 2. Update status or closed flag if changed
      if (newStatus !== event.status || shouldClose !== event.closed) {
        const { error: updateErr } = await supabaseClient
          .from("event_info")
          .update({ status: newStatus, closed: shouldClose })
          .eq("idevent_info", event.idevent_info);

        if (updateErr) {
          console.error(`❌ Failed to update event ${event.event_name}:`, updateErr);
        } else {
          console.log(`✅ Event "${event.event_name}" updated to ${newStatus} (closed=${shouldClose})`);
        }
      }

      // 3. If event is completed → mark absentees
      if (newStatus === "completed") {
        await markAbsenteesForEvent(event);
      }
    }
  } catch (err) {
    console.error("❌ updateEventsAndSanctions failed:", err);
  }
}




// ✅ RFID check & attendance logging + sanctions
async function checkRFID() {
  try {
    const res = await fetch("http://localhost:3000/last-scan");
    const { uid } = await res.json();

    // No card detected
    if (!uid) {
      lastUID = null;
      document.getElementById("lastScannedInfo").innerText = "No card detected";
      return;
    }

    // Ignore duplicate continuous scans
    if (uid === lastUID) return;
    lastUID = uid;

    // Find student by RFID
    const { data: student, error: studentErr } = await supabaseClient
      .from("student_info")
      .select("*")
      .eq("rfid", uid)
      .single();

    if (studentErr || !student) {
      document.getElementById("lastScannedInfo").innerText = `❌ Unknown card (${uid})`;
      return;
    }

    // Get selected event
    const eventId = document.getElementById("eventFilter").value;
    if (!eventId) {
      document.getElementById("lastScannedInfo").innerText = "⚠️ Please select an event before scanning!";
      return;
    }

    // Get event info
    const { data: event, error: eventErr } = await supabaseClient
      .from("event_info")
      .select("event_name, date, time_start, time_end, late_until, closed")
      .eq("idevent_info", eventId)
      .single();

    if (eventErr || !event) {
      document.getElementById("lastScannedInfo").innerText = "❌ Event not found";
      return;
    }

    // Block closed events
    if (event.closed) {
      document.getElementById("lastScannedInfo").innerText =
        `⛔ Event "${event.event_name}" is closed. No more scanning allowed.`;
      return;
    }

    const now = new Date();
    const eventStart = new Date(`${event.date}T${event.time_start}`);
    const eventEnd = new Date(`${event.date}T${event.time_end}`);
    const lateLimit = new Date(`${event.date}T${event.late_until}`);

    let status = "present";

    // Block early scans
    if (now < eventStart) {
      document.getElementById("lastScannedInfo").innerText =
        `⚠️ Too early! Scanning not open yet for "${event.event_name}"`;
      return;
    }

    // Determine attendance status
    if (now > eventEnd && now <= lateLimit) {
      status = "late";
    } else if (now > lateLimit) {
      document.getElementById("lastScannedInfo").innerText =
        "⛔ Attendance closed (manual entry required)";
      return;
    }

    // Check if already logged for this event
    const { data: existing } = await supabaseClient
      .from("attendance")
      .select("idattendance")
      .eq("student_id", student.idstudent_info)
      .eq("event_id", eventId)
      .maybeSingle();

    if (existing) {
      document.getElementById("lastScannedInfo").innerText =
        `⚠️ ${student.name} already scanned for this event`;
      return;
    }

    // Insert attendance
    const { error: insertErr } = await supabaseClient.from("attendance").insert({
      student_id: student.idstudent_info,
      event_id: eventId,
      status,
    });

    if (insertErr) {
      console.error("❌ Failed to log attendance:", insertErr);
      document.getElementById("lastScannedInfo").innerText = "❌ Failed to log attendance";
      return;
    }

    // ✅ Insert sanction if late
    if (status === "late") {
      const { error: sanctionErr } = await supabaseClient.from("sanctions").insert({
        student_id: student.student_id,
        student_name: student.name,
        event_name: event.event_name,
        penalty: "Late",
        fee: 500, // set your default late fee
        date_given: new Date().toISOString(),
        status: "pending",
      });

      if (sanctionErr) {
        console.error("❌ Failed to insert sanction:", sanctionErr);
      }
    }

    document.getElementById("lastScannedInfo").innerText = `✅ ${student.name} marked ${status}`;
    loadAttendance(eventId);

  } catch (err) {
    console.error("Scanner error:", err);
  }
}



// ✅ Mark absentees for a specific event
async function markAbsenteesForEvent(event) {
  try {
    // 1. Get all students
    const { data: students, error: studErr } = await supabaseClient
      .from("student_info")
      .select("idstudent_info, student_id, name");

    if (studErr) {
      console.error("❌ Error fetching students:", studErr);
      return;
    }

    // 2. Get students who already attended this event
    const { data: attendance, error: attErr } = await supabaseClient
      .from("attendance")
      .select("student_id")
      .eq("event_id", event.idevent_info);

    if (attErr) {
      console.error("❌ Error fetching attendance:", attErr);
      return;
    }

    const attendedIds = attendance.map((a) => a.student_id);

    // 3. Find absentees
    const absentees = students.filter(
      (s) => !attendedIds.includes(s.idstudent_info)
    );

    for (const student of absentees) {
      // 4. Check if sanction already exists
      const { data: existing } = await supabaseClient
        .from("sanctions")
        .select("id")
        .eq("student_id", student.student_id) // use text student_id
        .eq("event_name", event.event_name)
        .maybeSingle();

      if (existing) continue; // already sanctioned

      // 5. Insert sanction
      const { error: insertErr } = await supabaseClient
        .from("sanctions")
        .insert([
          {
            student_id: student.student_id, // text student_id
            student_name: student.name,
            event_name: event.event_name,
            penalty: "Absent",
            fee: 1500,
            date_given: new Date().toISOString(),
            status: "pending",
          },
        ]);

      if (insertErr) {
        console.error("❌ Failed to insert sanction:", insertErr);
      } else {
        console.log(
          `✅ Sanction added: ${student.name} (${student.student_id}) for ${event.event_name}`
        );
      }
    }
  } catch (err) {
    console.error("❌ markAbsenteesForEvent failed:", err);
  }
}



async function loadSanctions() {
  const { data, error } = await supabaseClient
    .from("sanctions")
    .select("*")
    .order("date_given", { ascending: false });

  if (error) {
    console.error("❌ Error loading sanctions:", error);
    return;
  }

  const table = document.getElementById("sanctionsTable");
  table.innerHTML = "";

  data.forEach((row) => {
    const tr = `
      <tr>
        <td>${row.id}</td>
        <td>${row.student_id}</td>
        <td>${row.student_name}</td>
        <td>${row.event_name}</td>
        <td>${row.penalty}</td>
        <td>${row.fee ?? 0}</td>
        <td>${new Date(row.date_given).toLocaleString()}</td>
        <td>${row.status}</td>
      </tr>
    `;
    table.innerHTML += tr;
  });
}





async function autoCheckEvents() {
    try {
        const now = new Date();

        // Fetch only events that are not yet closed
        const { data: events, error } = await supabaseClient
            .from("event_info")
            .select("idevent_info, event_name, date, time_end, closed")
            .eq("closed", false);

        if (error) {
            console.error("Error fetching events:", error);
            return;
        }

        for (const event of events) {
            const eventEnd = new Date(`${event.date}T${event.time_end}`);
            const cutoffTime = new Date(eventEnd.getTime() + 30 * 60000); // +30 mins

            if (now > cutoffTime) {
                await markAbsentees(event.idevent_info, event.event_name);

                // Mark event as closed so it won’t get processed again
                await supabaseClient
                    .from("event_info")
                    .update({ closed: true })
                    .eq("idevent_info", event.idevent_info);

                console.log(`✅ Event "${event.event_name}" absentees sanctioned.`);
            }
        }
    } catch (err) {
        console.error("Auto event check error:", err);
    }
}

// Run every 1 minute
setInterval(autoCheckEvents, 60 * 1000);







// ✅ Load attendance table
async function loadAttendance(eventId = "") {
  let query = supabaseClient
    .from("attendance")
    .select(
      `idattendance, scan_time, status,
       student_info(student_id, name),
       event_info(event_name, idevent_info)`
    )
    .order("scan_time", { ascending: false });

  if (eventId) query = query.eq("event_id", eventId);

  const { data, error } = await query;
  if (error) {
    console.error("❌ Error loading attendance:", error);
    return;
  }

  const table = document.getElementById("attendanceTable");
  table.innerHTML = "";

  data.forEach((att) => {
    const row = `
      <tr>
        <td>${new Date(att.scan_time).toLocaleTimeString()}</td>
        <td>${att.student_info.student_id}</td>
        <td>${att.student_info.name}</td>
        <td>${att.event_info.event_name}</td>
        <td><span class="status-badge ${att.status}">${att.status}</span></td>
        <td>
          
          <button class="btn btn-danger" onclick="deleteAttendance(${att.idattendance})">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
    table.innerHTML += row;
  });
}
// ✅ Delete attendance
async function deleteAttendance(id) {
  if (!confirm("Are you sure you want to delete this attendance record?")) return;

  const { error } = await supabaseClient
    .from("attendance")
    .delete()
    .eq("idattendance", id);

  if (error) {
    console.error("❌ Error deleting attendance:", error);
    alert("Failed to delete attendance.");
    return;
  }

  alert("✅ Attendance deleted.");
  loadAttendance(document.getElementById("eventFilter").value); // reload table
}
// ✅ Open edit modal and fill info
// Open Edit modal and prefill
async function editStudent(id) {
  // Fetch student first
  const { data: student, error } = await supabaseClient
    .from("student_info")
    .select("idstudent_info, student_id, name, rfid, year_level, team_id, password")
    .eq("idstudent_info", id)
    .single();

  if (error || !student) {
    console.error("❌ Error fetching student:", error);
    alert("Failed to load student.");
    return;
  }

  // Populate form fields
  document.getElementById("editStudentId").value = student.idstudent_info;
  document.getElementById("editStudentName").value = student.name || "";
  document.getElementById("editStudentRfid").value = student.rfid || "";
  document.getElementById("editStudentYear").value = student.year_level || "";
  document.getElementById("editStudentPassword").value = student.password || "";

  // Load teams into dropdown and preselect student's team
  await loadEditStudentTeams(student.team_id);

  // Finally, open modal
  openModal("editStudentModal");
}
// ✅ Save student edits safely
async function saveStudentEdit() {
  // Grab elements from DOM
  const idField = document.getElementById("editStudentId");
  const nameField = document.getElementById("editStudentName");
  const rfidField = document.getElementById("editStudentRfid");
  const yearField = document.getElementById("editStudentYear");
  const teamField = document.getElementById("editStudentTeam");
  const passField = document.getElementById("editStudentPassword");

  // Safety check: ensure all elements exist
  if (!idField || !nameField || !rfidField || !yearField || !teamField || !passField) {
    console.error("❌ One or more editStudent fields not found in DOM");
    alert("Form error: some fields are missing. Check your modal HTML IDs.");
    return;
  }

  // Get values from fields
  const id = idField.value;
  const name = nameField.value.trim();
  const rfid = rfidField.value.trim();
  const year = yearField.value;
  const teamId = teamField.value;
  const password = passField.value;

  // Check for empty fields
  if (!id || !name || !rfid || !year || !teamId || !password) {
    alert("⚠️ Please fill in all fields.");
    return;
  }

  try {
    // Update Supabase
    const { error } = await supabaseClient
      .from("student_info")
      .update({
        name,
        rfid,
        year_level: year,
        team_id: teamId,
        password, // consider hashing if needed
      })
      .eq("idstudent_info", id);

    if (error) throw error;

    alert("✅ Student updated successfully!");
    closeModal("editStudentModal");
    loadStudents(); // refresh table
  } catch (err) {
    console.error("❌ Error updating student:", err);
    alert("Failed to update student. Check console for details.");
  }
}

async function loadTeamsIntoEditModal(selectedTeamId) {
  const { data: teams, error } = await supabaseClient
    .from('teams')
    .select('*')
    .order('idteam', { ascending: true });

  if (error) return console.error(error);

  const teamSelect = document.getElementById('editStudentTeam');
  teamSelect.innerHTML = '<option value="">Select Team</option>';

  teams.forEach(team => {
    const option = document.createElement('option');
    option.value = team.idteam; // ✅ store ID
    option.textContent = team.team_name; // display name
    if (team.idteam === selectedTeamId) option.selected = true;
    teamSelect.appendChild(option);
  });
}
function openEditStudentModal(student) {
  document.getElementById("editStudentId").value = student.idstudent_info;
  document.getElementById("editStudentName").value = student.name;
  document.getElementById("editStudentRfid").value = student.rfid;
  document.getElementById("editStudentYear").value = student.year_level;
  document.getElementById("editStudentPassword").value = student.password;

  loadTeamsIntoEditModal(student.team_id); // ✅ load teams with proper ID

  openModal('editStudentModal');
}

// Open and close modal
function openModal(modalId) {
  document.getElementById(modalId).style.display = 'block';
}
function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
}

// Open Team Modal and load teams
function openTeamModal() {
  openModal('teamModal');
  renderTeams();
}

// Render teams from Supabase
async function renderTeams() {
  const { data: teams, error } = await supabaseClient
    .from('teams')
    .select('*')
    .order('idteam', { ascending: true }); // primary key

  if (error) {
    console.error('Error fetching teams:', error);
    return;
  }

  const table = document.getElementById('teamsTable');
  table.innerHTML = '';

  teams.forEach(team => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${team.team_name}</td> <!-- use actual column name -->
      <td>
        <button class="btn btn-danger" onclick="removeTeam(${team.idteam})">
          <i class="fas fa-trash"></i> Remove
        </button>
      </td>
    `;
    table.appendChild(row);
  });
}

// Add a new team
async function addTeam() {
  const teamName = document.getElementById('teamNameInput').value.trim();
  if (!teamName) {
    alert("Team name cannot be empty!");
    return;
  }

  // Insert into Supabase
  const { data, error } = await supabaseClient
    .from('teams')
    .insert([{ team_name: teamName }]); // use actual column name

  if (error) {
    alert('Error adding team: ' + error.message);
    return;
  }

  document.getElementById('teamNameInput').value = '';
  renderTeams();
}

// Remove a team
async function removeTeam(idteam) {
  if (!confirm("Are you sure you want to delete this team?")) return;

  const { error } = await supabaseClient
    .from('teams')
    .delete()
    .eq('idteam', idteam); // primary key

  if (error) {
    alert('Error deleting team: ' + error.message);
    return;
  }

  renderTeams();
}

// Close modal when clicking outside
window.onclick = function(event) {
  const modal = document.getElementById('teamModal');
  if (event.target == modal) closeModal('teamModal');
};








// ✅ Save event edits
async function saveEventEdit() {
  const id = document.getElementById("editEventId").value;
  const eventName = document.getElementById("editEventName").value;
  const eventDate = document.getElementById("editEventDate").value;
  const startTime = document.getElementById("editStartTime").value + ":00";
  const endTime = document.getElementById("editEndTime").value + ":00";
  const status = document.getElementById("editEventStatus").value;

  const { error } = await supabaseClient
    .from("event_info")
    .update({
      event_name: eventName,
      date: eventDate,
      time_start: startTime,
      time_end: endTime,
      status
    })
    .eq("idevent_info", id);

  if (error) {
    console.error("❌ Error updating event:", error);
    alert("Failed to update event.");
    return;
  }

  alert("✅ Event updated successfully!");
  closeModal("editEventModal");
  loadEvents(); // refresh table
}
function togglePassword(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);

  if (input.type === "password") {
    input.type = "text";
    icon.classList.remove("fa-eye");
    icon.classList.add("fa-eye-slash");
  } else {
    input.type = "password";
    icon.classList.remove("fa-eye-slash");
    icon.classList.add("fa-eye");
  }
}

// ✅ Event dropdown
async function loadEventFilter() {
  const { data, error } = await supabaseClient
    .from("event_info")
    .select("idevent_info, event_name")
    .order("date", { ascending: false });

  if (error) {
    console.error("❌ Error loading events:", error);
    return;
  }

  const filter = document.getElementById("eventFilter");
  filter.innerHTML = `<option value="">All Events</option>`;
  data.forEach((ev) => {
    filter.innerHTML += `<option value="${ev.idevent_info}">${ev.event_name}</option>`;
  });
}

function filterAttendance() {
  const eventId = document.getElementById("eventFilter").value;
  lastUID = null; // reset last scanned card when switching events
  loadAttendance(eventId);
}


// ✅ Notifications
function showNotification(message, type = "info") {
  const notif = document.createElement("div");
  notif.className = `notification ${type}`;
  notif.innerText = message;
  document.body.appendChild(notif);

  setTimeout(() => {
    notif.classList.add("fade-out");
    setTimeout(() => notif.remove(), 500);
  }, 3000);
}
// Fetch only pending sanctions
async function fetchSanctions() {
  const { data, error } = await supabaseClient
    .from('sanctions')
    .select('*')
    .eq('status', 'pending')
    .order('date_given', { ascending: false });

  if (error) {
    console.error("Error fetching sanctions:", error);
    return;
  }

  const tableBody = document.getElementById('sanctionTable');
  tableBody.innerHTML = '';

  const studentSet = new Set();
  let noOfLate = 0;
  let noOfAbsent = 0;
  let totalFee = 0;

  data.forEach(sanction => {
    studentSet.add(sanction.student_id);
    if (sanction.penalty.toLowerCase() === 'late') noOfLate++;
    if (sanction.penalty.toLowerCase() === 'absent') noOfAbsent++;
    totalFee += Number(sanction.fee);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${sanction.student_id}</td>   <!-- Student ID from student_info -->
      <td>${sanction.student_name}</td> <!-- Student Name -->
      <td>${sanction.event_name}</td>
      <td>${sanction.penalty}</td>
      <td>₱${Number(sanction.fee).toLocaleString()}</td>
      <td>${new Date(sanction.date_given).toLocaleDateString()}</td>
      <td>${sanction.status}</td>
      <td>
        <button class="btn btn-success" onclick="resolveSanction(${sanction.id})">Paid</button>
      </td>
    `;
    tableBody.appendChild(tr);
  });

  // Update stats cards
  document.getElementById('totalSanctionStudents').innerText = studentSet.size;
  document.getElementById('noOfLate').innerText = noOfLate;
  document.getElementById('noOfAbsent').innerText = noOfAbsent;
  document.getElementById('totalSanctionFee').innerText = `₱${totalFee.toLocaleString()}`;
}


// Resolve sanction
async function resolveSanction(sanctionId) {
    const { error } = await supabaseClient
        .from('sanctions')
        .update({ status: 'resolved' })
        .eq('id', sanctionId);

    if (error) {
        console.error("Error resolving sanction:", error);
        return;
    }

    fetchSanctions(); // refresh table and stats
}


async function markAttendance(student_id, event_id) {
    // Fetch event details
    const { data: event, error: eventError } = await supabaseClient
        .from('event_info')
        .select('*')
        .eq('idevent_info', event_id)
        .single();

    if (eventError) {
        console.error("Error fetching event:", eventError);
        return;
    }

    const now = new Date();
    const timeEnd = new Date(`${event.date}T${event.time_end}`);
    const lateLimit = new Date(timeEnd.getTime() + 30 * 60000); // +30 mins after end

    let penalty = "Present";
    let fee = 0;

    if (now <= timeEnd) {
        penalty = "Present";
    } else if (now > timeEnd && now <= lateLimit) {
        penalty = "Late";
        fee = 20; // Example fee for late
    } else {
        // Attendance is closed for regular users
        alert("Attendance is now closed. Please ask an officer for manual entry.");
        return;
    }

    // Insert into sanctions table only if Late
    if (penalty === "Late") {
        const { error: sanctionError } = await supabaseClient
            .from('sanctions')
            .insert([{
                student_id,
                event_name: event.event_name,
                penalty,
                fee,
                status: 'pending',
                date_given: now
            }]);

        if (sanctionError) {
            console.error("Error inserting sanction:", sanctionError);
            return;
        }
    }

    alert(`Attendance marked: ${penalty}`);
}



// -------------------- INIT --------------------
document.addEventListener("DOMContentLoaded", () => {
  loadStudents();
  loadEvents();
  loadEventFilter();
  loadAttendance();
  loadTeams();
  fetchSanctions();

  // 🔄 Start background updater
  setInterval(updateEventsAndSanctions, 60000); // check every 1 min
});



document.getElementById("searchInput").addEventListener("input", function () {
    const query = this.value.toLowerCase();
    const activeSection = document.querySelector(".content-section.active");

    if (!activeSection) return;

    // find the table inside the active section
    const table = activeSection.querySelector("table tbody");
    if (!table) return;

    // loop rows and filter
    Array.from(table.getElementsByTagName("tr")).forEach((row) => {
        const text = row.innerText.toLowerCase();
        row.style.display = text.includes(query) ? "" : "none";
    });
});
// Reset search bar when switching sections
document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", () => {
        const searchInput = document.getElementById("searchInput");
        searchInput.value = ""; // clear text

        // Reset all rows in the new active panel
        const activeSection = document.querySelector(".content-section.active");
        if (activeSection) {
            const table = activeSection.querySelector("table tbody");
            if (table) {
                Array.from(table.getElementsByTagName("tr")).forEach(row => {
                    row.style.display = ""; // show all rows again
                });
            }
        }
    });
});

// ✅ Load events into Manual Attendance dropdown
async function loadManualEventOptions() {
  const { data, error } = await supabaseClient
    .from("event_info")
    .select("idevent_info, event_name")
    .order("date", { ascending: false });

  if (error) {
    console.error("❌ Error loading events for manual attendance:", error);
    return;
  }

  const dropdown = document.getElementById("attendanceEvent");
  dropdown.innerHTML = `<option value="">Select Event</option>`;
  data.forEach((ev) => {
    dropdown.innerHTML += `<option value="${ev.idevent_info}">${ev.event_name}</option>`;
  });
}

// ✅ Manual attendance entry
async function addManualAttendance() {
  const studentId = document.getElementById("attendanceStudentId").value.trim();
  const eventId = document.getElementById("attendanceEvent").value;
  const status = document.getElementById("attendanceStatus").value;
  const time = document.getElementById("attendanceTime").value;

  if (!studentId || !eventId || !status || !time) {
    alert("⚠️ Please fill in all fields.");
    return;
  }

  // 1. Find student by student_id
  const { data: student, error: studentErr } = await supabaseClient
    .from("student_info")
    .select("idstudent_info, name")
    .eq("student_id", studentId)
    .single();

  if (studentErr || !student) {
    alert("❌ Student not found!");
    return;
  }

  // 2. Prevent duplicate for same event
  const { data: existing } = await supabaseClient
    .from("attendance")
    .select("idattendance")
    .eq("student_id", student.idstudent_info)
    .eq("event_id", eventId)
    .maybeSingle();

  if (existing) {
    alert(`⚠️ ${student.name} already has attendance for this event.`);
    return;
  }

  // 3. Insert manual attendance
  const { error: insertErr } = await supabaseClient.from("attendance").insert({
    student_id: student.idstudent_info,
    event_id: eventId,
    status: status,
    scan_time: `${new Date().toISOString().split("T")[0]} ${time}:00`, // date + time
  });

  if (insertErr) {
    console.error("❌ Error inserting manual attendance:", insertErr);
    alert("Failed to record attendance.");
    return;
  }

  alert(`✅ Attendance recorded for ${student.name}`);
  closeModal("manualAttendanceModal");
  document.getElementById("manualAttendanceForm").reset();
  loadAttendance(eventId); // refresh table
}

// ✅ Init when page loads
document.addEventListener("DOMContentLoaded", () => {
  loadManualEventOptions(); // fill dropdown
});
