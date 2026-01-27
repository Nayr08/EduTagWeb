// ✅ Supabase client initialization with session check
const SUPABASE_URL = "https://ofrngrggkgtfnfdlbmum.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mcm5ncmdna2d0Zm5mZGxibXVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3ODYxOTYsImV4cCI6MjA3MjM2MjE5Nn0.qgYkiUmesBQCoSUkrLhMuCmO2IxDSahQUZPKHhUGjnE";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Recalculate attendance statuses for all records of an event after event time edit
async function recalculateAttendanceStatuses(eventId, eventDate, startTime, endTime, lateUntil) {
  try {
    console.log('[DEBUG] recalculateAttendanceStatuses called:', {eventId, eventDate, startTime, endTime, lateUntil});
    // Fetch event name (needed to match sanctions by event_name)
    const { data: ev, error: evErr } = await supabaseClient
      .from('event_info')
      .select('event_name')
      .eq('idevent_info', eventId)
      .maybeSingle();
    const eventName = ev?.event_name || null;

    // Fetch all attendance records for this event (include cached student fields)
    const { data: attendance, error } = await supabaseClient
      .from('attendance')
      .select('idattendance, scan_time, status, student_id, student_name_cached, student_school_id_cached')
      .eq('event_id', eventId);
    if (error) {
      console.error('[DEBUG] Error fetching attendance for recalculation:', error);
      return;
    }
    if (!attendance || attendance.length === 0) {
      console.log('[DEBUG] No attendance records found for event', eventId);
      return;
    }

    // Parse event time boundaries
    const start = new Date(`${eventDate}T${startTime}`);
    const presentUntil = new Date(`${eventDate}T${endTime}`);
    const lateCutoff = new Date(`${eventDate}T${lateUntil}`);
    console.log('[DEBUG] Parsed event times:', {start, presentUntil, lateCutoff});

    // Prepare updates
    const updates = [];
    for (const att of attendance) {
      if (!att.scan_time) continue;
      // scan_time is assumed to be HH:MM:SS
      const scan = new Date(`${eventDate}T${att.scan_time}`);
      let newStatus = att.status;
      if (scan >= start && scan <= presentUntil) {
        newStatus = 'present';
      } else if (scan > presentUntil && scan <= lateCutoff) {
        newStatus = 'late';
      } else if (scan > lateCutoff) {
        newStatus = 'absent';
      }
      if (newStatus !== att.status) {
        updates.push({ idattendance: att.idattendance, status: newStatus, scan: att.scan_time, oldStatus: att.status, student_id: att.student_id, student_name_cached: att.student_name_cached, student_school_id_cached: att.student_school_id_cached });
      }
    }
    console.log('[DEBUG] Attendance updates to apply:', updates);
    // Batch update statuses
    for (const upd of updates) {
      await supabaseClient
        .from('attendance')
        .update({ status: upd.status })
        .eq('idattendance', upd.idattendance);
      console.log(`[DEBUG] Updated idattendance ${upd.idattendance}: ${upd.oldStatus} -> ${upd.status} (scan: ${upd.scan})`);
      // --- Reflect changes in sanctions ---
      try {
        // If now present -> remove pending Late/Absent sanctions for this event+student
        if (upd.status === 'present' && eventName) {
          await supabaseClient
            .from('sanctions')
            .delete()
            .eq('idstudent_info', upd.student_id)
            .eq('event_name', eventName)
            .in('penalty', ['Late', 'Absent'])
            .eq('status', 'pending');
          console.log(`[DEBUG] Removed Late/Absent sanctions for student ${upd.student_id} event ${eventName}`);
        }

        // If now late -> ensure a Late sanction exists (and remove Absent if any)
        if (upd.status === 'late' && eventName) {
          // remove any Absent sanctions
          await supabaseClient
            .from('sanctions')
            .delete()
            .eq('idstudent_info', upd.student_id)
            .eq('event_name', eventName)
            .eq('penalty', 'Absent')
            .eq('status', 'pending');

          // ensure Late sanction exists
          const { data: existingLate } = await supabaseClient
            .from('sanctions')
            .select('id')
            .eq('idstudent_info', upd.student_id)
            .eq('event_name', eventName)
            .eq('penalty', 'Late')
            .maybeSingle();
          if (!existingLate) {
            await supabaseClient.from('sanctions').insert([{ 
              idstudent_info: upd.student_id,
              student_id: upd.student_school_id_cached || null,
              student_name: upd.student_name_cached || null,
              event_name: eventName,
              penalty: 'Late',
              fee: 500,
              date_given: eventDate,
              status: 'pending'
            }]);
            console.log(`[DEBUG] Inserted Late sanction for student ${upd.student_id} event ${eventName}`);
          }
        }

        // If now absent -> ensure an Absent sanction exists (and remove Late if any)
        if (upd.status === 'absent' && eventName) {
          // remove any Late sanctions
          await supabaseClient
            .from('sanctions')
            .delete()
            .eq('idstudent_info', upd.student_id)
            .eq('event_name', eventName)
            .eq('penalty', 'Late')
            .eq('status', 'pending');

          // ensure Absent sanction exists
          const { data: existingAbsent } = await supabaseClient
            .from('sanctions')
            .select('id')
            .eq('idstudent_info', upd.student_id)
            .eq('event_name', eventName)
            .eq('penalty', 'Absent')
            .maybeSingle();
          if (!existingAbsent) {
            await supabaseClient.from('sanctions').insert([{ 
              idstudent_info: upd.student_id,
              student_id: upd.student_school_id_cached || null,
              student_name: upd.student_name_cached || null,
              event_name: eventName,
              penalty: 'Absent',
              fee: 1500,
              date_given: eventDate,
              status: 'pending'
            }]);
            console.log(`[DEBUG] Inserted Absent sanction for student ${upd.student_id} event ${eventName}`);
          }
        }
      } catch (sanErr) {
        console.error('[DEBUG] Error updating sanctions for attendance change:', sanErr);
      }
    }
    // If there were no attendance status changes, or even if there were,
    // ensure sanctions are reconciled for all attendance records for this event.
    console.log('[DEBUG] Reconciling sanctions for all attendance records...');
    for (const att of attendance) {
      try {
        const sid = att.student_id;
        const sname = att.student_name_cached || null;
        const sschool = att.student_school_id_cached || null;
        if (!eventName || !sid) continue;

        if (att.status === 'present') {
          // remove pending Late/Absent sanctions
          await supabaseClient
            .from('sanctions')
            .delete()
            .eq('idstudent_info', sid)
            .eq('event_name', eventName)
            .in('penalty', ['Late', 'Absent'])
            .eq('status', 'pending');
        } else if (att.status === 'late') {
          // remove pending Absent sanctions
          await supabaseClient
            .from('sanctions')
            .delete()
            .eq('idstudent_info', sid)
            .eq('event_name', eventName)
            .eq('penalty', 'Absent')
            .eq('status', 'pending');

          // ensure Late sanction exists
          const { data: existingLate } = await supabaseClient
            .from('sanctions')
            .select('id')
            .eq('idstudent_info', sid)
            .eq('event_name', eventName)
            .eq('penalty', 'Late')
            .eq('status', 'pending')
            .maybeSingle();
          if (!existingLate) {
            await supabaseClient.from('sanctions').insert([{ 
              idstudent_info: sid,
              student_id: sschool,
              student_name: sname,
              event_name: eventName,
              penalty: 'Late',
              fee: 500,
              date_given: eventDate,
              status: 'pending'
            }]);
          }
        } else if (att.status === 'absent') {
          // remove pending Late sanctions
          await supabaseClient
            .from('sanctions')
            .delete()
            .eq('idstudent_info', sid)
            .eq('event_name', eventName)
            .eq('penalty', 'Late')
            .eq('status', 'pending');

          // ensure Absent sanction exists
          const { data: existingAbsent } = await supabaseClient
            .from('sanctions')
            .select('id')
            .eq('idstudent_info', sid)
            .eq('event_name', eventName)
            .eq('penalty', 'Absent')
            .eq('status', 'pending')
            .maybeSingle();
          if (!existingAbsent) {
            await supabaseClient.from('sanctions').insert([{ 
              idstudent_info: sid,
              student_id: sschool,
              student_name: sname,
              event_name: eventName,
              penalty: 'Absent',
              fee: 1500,
              date_given: eventDate,
              status: 'pending'
            }]);
          }
        }
      } catch (sanErr) {
        console.error('[DEBUG] Error reconciling sanctions for student', att.student_id, sanErr);
      }
    }
    if (updates.length > 0) {
      alert(`Attendance statuses updated for ${updates.length} record(s) based on new event times.`);
    } else {
      console.log('[DEBUG] No attendance statuses needed updating.');
    }
  } catch (err) {
    console.error('[DEBUG] Error recalculating attendance statuses:', err);
  }
}



// ✅ Check authentication on page load

async function checkAuthAndInit() {
  const { data: { session }, error } = await supabaseClient.auth.getSession();

  if (!session) {
    alert("⚠️ You are not logged in. Redirecting to login page.");
    window.location.href = 'index.html';
    return false;
  }

  // ✅ Verify this user is actually an admin
  const { data: adminCheck, error: adminError } = await supabaseClient
    .from('admin_info')
    .select('admin_username')
    .eq('auth_id', session.user.id)
    .single();

  if (adminError || !adminCheck) {
    alert("⚠️ Access denied. Admin account not found.");
    window.location.href = 'index.html';
    return false;
  }

  console.log("✅ Admin authenticated:", adminCheck.admin_username);
  return true;
}

// 🔁 --- UNIVERSAL OFFLINE RETRY QUEUE HANDLER ---
const retryQueue = [];

function enqueueRetry(fn, delay = 8000) {
  retryQueue.push({ fn, delay });
  console.warn(`🕸️ Offline: Queued retry for ${fn.name || "anonymous"} in ${delay / 1000}s`);
}

async function processRetryQueue() {
  if (!navigator.onLine || retryQueue.length === 0) return;
  console.log(`🌐 Connection restored — retrying ${retryQueue.length} queued tasks...`);

  for (let i = 0; i < retryQueue.length; i++) {
    const { fn, delay } = retryQueue[i];
    try {
      await fn();
      console.log(`✅ Retry successful for: ${fn.name || "task"}`);
      retryQueue.splice(i, 1);
      i--;
    } catch (err) {
      console.warn(`🔁 Retry failed for ${fn.name}, will retry again`, err);
      setTimeout(() => enqueueRetry(fn, delay), delay);
    }
  }
}

// 🔌 Watch for internet reconnect
window.addEventListener("online", processRetryQueue);

// Sidebar toggle (for hamburger button)
function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");

  sidebar.classList.toggle("open");

  // Handle overlay if it exists
  if (overlay) {
    overlay.classList.toggle("active");
  }
}

async function loadAdminInfo() {
  try {
    // Try getting from session first
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (session) {
      const { data: adminInfo, error } = await supabaseClient
        .from('admin_info')
        .select('admin_username')
        .eq('auth_id', session.user.id)
        .single();

      if (!error && adminInfo) {
        document.getElementById("adminName").textContent = adminInfo.admin_username;
        return; // Success, exit early
      }
    }

    // Fallback to URL parameter
    const params = new URLSearchParams(window.location.search);
    const adminUsername = params.get("admin_username");

    if (adminUsername) {
      document.getElementById("adminName").textContent = adminUsername;
    } else {
      console.warn("⚠️ Could not load admin username");
    }

  } catch (err) {
    console.error("⚠️ loadAdminInfo failed:", err);
  }
}



async function logout() {
  const confirmLogout = confirm("Are you sure you want to log out?");
  if (!confirmLogout) return; // user clicked cancel

  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      console.error("❌ Logout failed:", error);
      alert("Failed to log out.");
      return;
    }

    // ✅ Redirect after logout
    window.location.href = "index.html";
  } catch (err) {
    console.error("⚠️ Unexpected error during logout:", err);
    alert("Something went wrong while logging out.");
  }
}


async function confirmLogout() {
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      console.error("❌ Logout failed:", error);
      alert("Failed to log out.");
      return;
    }

    // ✅ Redirect after successful logout
    window.location.href = "index.html";
  } catch (err) {
    console.error("⚠️ Unexpected error during logout:", err);
    alert("Something went wrong while logging out.");
  }
}


// -------------------- STUDENTS --------------------
let studentsCurrentPage = 1;
const studentsRowsPerPage = 100;

async function loadStudents(page = 1) {
  return filterStudents(page); // just delegate
}


function changeStudentsPage(direction) {
  const totalPages = parseInt(document.getElementById("studentsTotalPages").textContent);
  let newPage = studentsCurrentPage + direction;

  if (newPage < 1) newPage = 1;
  if (newPage > totalPages) newPage = totalPages;

  // ✅ Get current filter values
  const yearLevel = document.getElementById("studentYearFilter")?.value || "";
  const section = document.getElementById("studentSectionFilter")?.value || "";
  const teamName = document.getElementById("studentTeamFilter")?.value || "";
  const searchValue = document.getElementById("searchInput")?.value?.trim().toLowerCase() || "";

  // ✅ Pass all filters explicitly when paginating
  filterStudents(newPage, yearLevel, section, teamName, searchValue);
}






function populateSectionAndTeamFilters(data) {
  const sectionFilter = document.getElementById("sectionFilter");
  const teamFilter = document.getElementById("teamFilter");

  if (!sectionFilter || !teamFilter) return; // if not on the page, skip

  // Get unique values
  const uniqueSections = [...new Set(data.map(s => s.section).filter(Boolean))].sort();
  const uniqueTeams = [...new Set(data.map(s => s.teams ? s.teams.team_name : null).filter(Boolean))].sort();

  // Reset dropdowns
  sectionFilter.innerHTML = `<option value="">All Sections</option>`;
  teamFilter.innerHTML = `<option value="">All Teams</option>`;

  // Populate sections
  uniqueSections.forEach(section => {
    const opt = document.createElement("option");
    opt.value = section;
    opt.textContent = section;
    sectionFilter.appendChild(opt);
  });

  // Populate teams
  uniqueTeams.forEach(team => {
    const opt = document.createElement("option");
    opt.value = team;
    opt.textContent = team;
    teamFilter.appendChild(opt);
  });
}

async function filterAttendance(page = 1) {
  const loader = document.getElementById("attendanceLoading");
  if (loader) {
    loader.classList.add("active");
    await new Promise(requestAnimationFrame);
  }

  try {
    const yearLevel = document.getElementById("attendanceYearFilter")?.value || "";
    const eventId = document.getElementById("eventFilter")?.value || "";
    const section = document.getElementById("sectionFilter")?.value || "";
    const teamId = document.getElementById("teamFilter")?.value || "";
    const searchValue = document.getElementById("searchInput")?.value?.trim().toLowerCase() || "";
    const title = document.getElementById("attendanceTitle");

    // reset last scanned card when filters change
    lastUID = null;

    // rows per page (100)
    const rowsPerPage = parseInt(attendanceRowsPerPage, 10) || 100;

    // UI: if no event selected, clear and exit
    if (!eventId) {
      title.textContent = "Select Event To Scan";
      const table = document.getElementById("attendanceTable");
      table.innerHTML = `<tr><td colspan="6">Please select an event to view attendance records</td></tr>`;
      document.getElementById("totalAttendanceCount").textContent = 0;
      document.getElementById("attendanceTotalRecords").textContent = 0;
      document.getElementById("attendanceCurrentPage").textContent = 1;
      document.getElementById("attendanceTotalPages").textContent = 1;
      if (loader) loader.classList.remove("active");
      return;
    }

    // fetch event (for title)
    const { data: event, error: eventErr } = await supabaseClient
      .from("event_info")
      .select("event_name, date, time_start, late_until, status, closed")
      .eq("idevent_info", eventId)
      .single();

    if (eventErr || !event) {
      console.warn("Failed to fetch event details:", eventErr);
      title.textContent = "Live Attendance";
    } else {
      if (event.status === "completed" || event.closed === true) {
        title.textContent = `Note: "${event.event_name}" is completed. View attendance records only.`;
      } else {
        const startDateTime = new Date(`${event.date}T${event.time_start}`);
        const lateUntilDateTime = new Date(`${event.date}T${event.late_until}`);
        const startFormatted = startDateTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
        const lateFormatted = lateUntilDateTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
        title.textContent = `Note: Attendance for "${event.event_name}" will open at ${startFormatted} and close at ${lateFormatted}`;
      }
    }

    // ✅ NEW: fetch all attendance in batches (no 1000-limit)
    let allData = [];
    let from = 0;
    const batchSize = 1000;

    while (true) {
      const { data, error } = await supabaseClient
        .from("attendance")
        .select(`
          idattendance,
          date,
          scan_time,
          status,
          student_info (student_id, name, section, team_id, year_level),
          event_info (event_name, idevent_info)
        `)
        .eq("event_id", eventId)
        .order("date", { ascending: true })
        .order("scan_time", { ascending: true })
        .range(from, from + batchSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      allData.push(...data);
      if (data.length < batchSize) break;
      from += batchSize;
    }

    // --- rest of your code unchanged ---
    let filtered = (allData || []).filter(Boolean);

    if (yearLevel) {
      filtered = filtered.filter(att => {
        const y = att.student_info?.year_level ?? "";
        return String(y) === String(yearLevel);
      });
    }

    if (section) {
      filtered = filtered.filter(att => {
        const s = att.student_info?.section ?? "";
        return String(s) === String(section);
      });
    }

    if (teamId) {
      filtered = filtered.filter(att => {
        const t = att.student_info?.team_id ?? "";
        return String(t) === String(teamId);
      });
    }

    if (searchValue) {
      filtered = filtered.filter(att => {
        const name = (att.student_info?.name || "").toLowerCase();
        const sid = (att.student_info?.student_id || "").toLowerCase();
        return name.includes(searchValue) || sid.includes(searchValue);
      });
    }

    const totalRecords = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / rowsPerPage));
    const currentPage = Math.min(Math.max(1, page || 1), totalPages);
    attendanceCurrentPage = currentPage;

    const startIndex = (currentPage - 1) * rowsPerPage;
    const pageData = filtered.slice(startIndex, startIndex + rowsPerPage);

    const table = document.getElementById("attendanceTable");
    table.innerHTML = "";

    if (!pageData.length) {
      table.innerHTML = `<tr><td colspan="6">No attendance records found.</td></tr>`;
    } else {
      for (const att of pageData) {
        if (!att.student_info) continue;
        let formattedTime = att.scan_time || "";
        if (formattedTime) {
          const [hours, minutes] = formattedTime.split(":");
          let h = parseInt(hours, 10);
          const ampm = h >= 12 ? "PM" : "AM";
          h = h % 12 || 12;
          formattedTime = `${h}:${minutes} ${ampm}`;
        }

        const row = `
          <tr>
            <td>${att.student_info.student_id ?? ""}</td>
            <td>${att.student_info.name ?? ""}</td>
            <td>${att.event_info?.event_name ?? ""}</td>
            <td>${formattedTime}</td>
            <td><span class="status-badge ${att.status}">${att.status}</span></td>
            <td>
              <button class="btn btn-danger" onclick="deleteAttendance(${att.idattendance})">
                <i class="fas fa-trash"></i>
              </button>
            </td>
          </tr>`;
        table.innerHTML += row;
      }
    }

    document.getElementById("totalAttendanceCount").textContent = totalRecords;
    document.getElementById("attendanceTotalRecords").textContent = totalRecords;
    document.getElementById("attendanceCurrentPage").textContent = currentPage;
    document.getElementById("attendanceTotalPages").textContent = totalPages;

  } catch (err) {
    console.error("Error in filterAttendance:", err);
    const table = document.getElementById("attendanceTable");
    if (table) table.innerHTML = `<tr><td colspan="6">Error loading attendance.</td></tr>`;
  } finally {
    if (loader) loader.classList.remove("active");
  }
}





async function filterStudents(page = 1) {
  const loader = document.getElementById("studentsLoading");
  if (loader) {
    loader.classList.add("active");
    await new Promise(requestAnimationFrame);
  }

  const yearLevel = document.getElementById("studentYearFilter")?.value || "";
  const section = document.getElementById("studentSectionFilter")?.value || "";
  const teamId = document.getElementById("studentTeamFilter")?.value || "";
  const searchValue = document.getElementById("searchInput")?.value?.trim().toLowerCase() || "";

  const start = (page - 1) * studentsRowsPerPage;
  const end = start + studentsRowsPerPage - 1;

  try {
    let query = supabaseClient
      .from("student_info")
      .select(`
        idstudent_info,
        student_id,
        name,
        year_level,
        section,
        password,
        rfid,
        status,
        team_id,
        teams (team_name)
      `, { count: "exact" })
      .order("name", { ascending: true })
      .range(start, end);

    if (yearLevel) query = query.eq("year_level", yearLevel);
    if (section) query = query.eq("section", section);
    if (teamId) query = query.eq("team_id", teamId);
    if (searchValue) query = query.or(`name.ilike.%${searchValue}%,student_id.ilike.%${searchValue}%`);

    const { data, error, count } = await query;
    if (error) throw error;

    // ✅ Alphabetical sorting
    data.sort((a, b) => (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" }));

    renderStudentTable(data);
    document.getElementById("totalStudentsCount").textContent = count;

    const totalPages = Math.ceil(count / studentsRowsPerPage);
    studentsCurrentPage = page;
    document.getElementById("studentsCurrentPage").textContent = page;
    document.getElementById("studentsTotalPages").textContent = totalPages;
    document.getElementById("studentsTotalRecords").textContent = count;

  } catch (error) {
    console.error("❌ Error filtering students:", error);
  } finally {
    if (loader) loader.classList.remove("active");
  }
}


async function scanRfid(event) {
  const button = event.target;
  const rfidInput = document.getElementById("studentRfid");      // visible field
  const hiddenInput = document.getElementById("hiddenRfidInput"); // hidden field

  if (!rfidInput || !hiddenInput) {
    console.error("❌ Missing RFID input fields in HTML.");
    return;
  }

  // Clear old values
  rfidInput.value = "";
  hiddenInput.value = "";

  // Focus hidden field so RFID reader can type into it
  hiddenInput.focus();

  // Update button while waiting
  button.disabled = true;
  button.innerText = "Waiting for card...";

  function handler(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const uid = hiddenInput.value.trim();

      if (uid) {
        rfidInput.value = uid; // Copy scanned UID to visible field
        console.log("✅ Scanned UID:", uid);
      }

      // Reset button
      button.disabled = false;
      button.innerText = "Scan ID";

      // Remove listener after one scan
      hiddenInput.removeEventListener("keydown", handler);
    }
  }

  // Listen for the Enter key (end of scan)
  hiddenInput.addEventListener("keydown", handler);
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
async function findStudent() {
  const studentId = document.getElementById("sanctionStudentId").value.trim();
  const nameField = document.getElementById("sanctionStudentName");

  if (!studentId) {
    alert("⚠️ Please enter a Student ID first.");
    return;
  }

  const { data, error } = await supabaseClient
    .from("student_info")
    .select("name")
    .eq("student_id", studentId)
    .single();

  if (error || !data) {
    console.error("❌ Error fetching student:", error);
    alert("❌ Student not found!");
    nameField.value = "";
    return;
  }

  nameField.value = data.name;
}


async function saveSanction(event) {
  event.preventDefault(); // prevent form reload

  const studentId = document.getElementById("sanctionStudentId").value.trim();
  const studentName = document.getElementById("sanctionStudentName").value.trim();
  const eventName = document.getElementById("sanctionEvent").value.trim();
  const penalty = document.getElementById("sanctionPenalty").value;
  const fee = document.getElementById("sanctionFee").value;

  if (!studentId || !studentName || !eventName || !penalty || !fee) {
    alert("⚠️ Please fill in all fields.");
    return;
  }

  try {
    // Fetch the idstudent_info using student_id
    const { data: student, error: fetchError } = await supabaseClient
      .from("student_info")
      .select("idstudent_info")
      .eq("student_id", studentId)
      .single();

    if (fetchError || !student) {
      console.error("❌ Error fetching student info:", fetchError);
      alert("❌ Student ID not found in the database.");
      return;
    }

    // Insert the sanction with the foreign key
    const { error: insertError } = await supabaseClient
      .from("sanctions")
      .insert([{
        idstudent_info: student.idstudent_info, // ✅ Foreign key from student_info
        student_id: studentId,
        student_name: studentName,
        event_name: eventName,
        penalty,
        fee: Number(fee),
        date_given: new Date().toISOString().split("T")[0],
        status: "pending"
      }]);

    if (insertError) {
      console.error("❌ Error saving sanction:", insertError);
      alert("❌ Failed to save sanction.");
      return;
    }

    alert("✅ Sanction saved successfully!");
    closeModal("addSanctionModal");

  } catch (err) {
    console.error("❌ Unexpected error:", err);
    alert("❌ An unexpected error occurred.");
  }
}

async function loadSanctionEventDropdown() {
  const { data, error } = await supabaseClient
    .from("event_info")
    .select("event_name, status, date")
    .order("date", { ascending: false });

  if (error) {
    console.error("❌ Error loading events:", error);
    return;
  }

  const dropdown = document.getElementById("sanctionEvent");
  dropdown.innerHTML = `<option value="">Select Event</option>`;
  data.forEach(ev => {
    dropdown.innerHTML += `<option value="${ev.event_name}">${ev.event_name} (${ev.status})</option>`;
  });
}

async function addStudent() {
  const studentId = document.getElementById("studentId").value.trim();
  const studentName = document.getElementById("studentName").value.trim();
  const studentYear = document.getElementById("studentYear").value;
  const studentPassword = document.getElementById("studentPassword").value.trim();
  const studentRfid = document.getElementById("studentRfid").value.trim();
  const studentTeam = document.getElementById("studentTeam").value;
  const studentSection = document.getElementById("studentSection").value.trim();

  // ✅ Updated validation to include section and team
  if (!studentId || !studentName || !studentPassword || !studentRfid || !studentYear || !studentSection || !studentTeam) {
    alert("Please fill in all required fields.");
    return;
  }

  const { error } = await supabaseClient.from("student_info").insert([
    {
      student_id: studentId,
      name: studentName,
      year_level: studentYear,
      section: studentSection,
      password: studentPassword,
      rfid: studentRfid,
      team_id: studentTeam,  // No longer using || null since we validate it's not empty
      status: "active"
    }
  ]);

  if (error) {
    console.error("Error adding student:", error);
    alert("Error adding student. Check console for details.");
    return;
  }

  alert("Student added successfully!");
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
async function loadTeams(selectId) {
  const { data, error } = await supabaseClient
    .from("teams")
    .select("idteam, team_name")
    .order("team_name", { ascending: true });

  if (error) {
    console.error("❌ Error loading teams:", error);
    return;
  }

  const dropdown = document.getElementById(selectId);
  if (!dropdown) return;

  dropdown.innerHTML = `<option value="">${selectId === "studentTeam" ? "Select Team" : "All Teams"}</option>`;

  data.forEach((team) => {
    dropdown.innerHTML += `<option value="${team.idteam}">${team.team_name}</option>`;
  });
}



// Run on page load
document.addEventListener("DOMContentLoaded", loadTeams);


// -------------------- EVENTS --------------------
// ✅ Helper: Convert 24h time (HH:MM:SS) → 12h format with AM/PM
function formatTimeTo12Hour(timeString) {
  if (!timeString) return "";
  const [hour, minute] = timeString.split(":");
  let h = parseInt(hour, 10);
  const m = minute;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12; // convert "0" → "12"
  return `${h}:${m} ${ampm}`;
}
// --- Event deletion via password modal (deletes related attendance & sanctions) ---
let pendingDeleteEventId = null;

// Replaces instant deletion with a password-protected confirmation modal.
window.deleteEvent = function (eventId) {
  pendingDeleteEventId = eventId;

  (async () => {
    console.log('DEBUG: deleteEvent called with id=', eventId);
    try {
      const { data: ev } = await supabaseClient
        .from('event_info')
        .select('event_name')
        .eq('idevent_info', eventId)
        .maybeSingle();

      const nameEl = document.getElementById('eventDeleteName');
      if (nameEl) nameEl.textContent = ev?.event_name ?? '(unknown)';

    } catch (err) {
      console.warn('Could not load event name for delete modal:', err);
    } finally {
      openModal('eventDeletePasswordModal');
      console.log('DEBUG: openModal called for eventDeletePasswordModal');
      const inp = document.getElementById('eventDeletePasswordInput');
      if (inp) inp.focus();
    }
  })();
};

async function verifyEventDeletePassword(event) {
  event.preventDefault();

  const passwordInput = document.getElementById('eventDeletePasswordInput');
  const errorDiv = document.getElementById('eventDeletePasswordError');
  const enteredPassword = passwordInput.value.trim();

  console.log('DEBUG: verifyEventDeletePassword called');
  try {
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !session) {
      alert('⚠️ Session expired. Please log in again.');
      window.location.href = 'index.html';
      return;
    }

    const { data: admin, error: adminError } = await supabaseClient
      .from('admin_info')
      .select('admin_username, password')
      .eq('auth_id', session.user.id)
      .single();

    if (adminError || !admin) {
      alert('❌ Admin record not found.');
      return;
    }

    if (enteredPassword === admin.password) {
      console.log('DEBUG: password matched for admin', admin.admin_username);
      // password ok — perform deletion
      closeModal('eventDeletePasswordModal');
      passwordInput.value = '';
      if (errorDiv) errorDiv.style.display = 'none';

      const idToDelete = pendingDeleteEventId;
      pendingDeleteEventId = null;
      if (idToDelete) await performDeleteEvent(idToDelete);
    } else {
      console.log('DEBUG: password did not match');
      if (errorDiv) errorDiv.style.display = 'block';
      passwordInput.value = '';
      passwordInput.focus();
    }
  } catch (err) {
    console.error('Error verifying delete password:', err);
    alert('⚠️ An unexpected error occurred. Please try again.');
  }
}

function cancelEventDelete() {
  pendingDeleteEventId = null;
  const inp = document.getElementById('eventDeletePasswordInput');
  const err = document.getElementById('eventDeletePasswordError');
  if (inp) inp.value = '';
  if (err) err.style.display = 'none';
  closeModal('eventDeletePasswordModal');
}

// Performs deletion of attendance -> sanctions -> event in that order.
async function performDeleteEvent(eventId) {
  console.log('DEBUG: performDeleteEvent starting for id=', eventId);
  try {
    // fetch event name (sanctions store event_name)
    const { data: event, error: evErr } = await supabaseClient
      .from('event_info')
      .select('event_name')
      .eq('idevent_info', eventId)
      .maybeSingle();

    if (evErr) throw evErr;
    if (!event) {
      alert('❌ Event not found.');
      return;
    }

    const eventName = event.event_name;
    console.log('DEBUG: performDeleteEvent eventName=', eventName);

    // create a tracking record in event_deletion_logs (best-effort)
    let logId = null;
    try {
      let ip = null;
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json');
        if (ipRes.ok) {
          const ipJson = await ipRes.json();
          ip = ipJson.ip;
        }
      } catch (e) {
        console.warn('Could not fetch client IP for log:', e);
      }

      const { data: { session } = {}, error: sErr } = await supabaseClient.auth.getSession();
      const adminId = session?.user?.id ?? null;
      let adminUsername = null;
      if (adminId) {
        const { data: adminRec, error: adminErr } = await supabaseClient
          .from('admin_info')
          .select('admin_username')
          .eq('auth_id', adminId)
          .maybeSingle();
        if (!adminErr && adminRec) adminUsername = adminRec.admin_username;
      }

      const { data: inserted, error: insertErr } = await supabaseClient
        .from('event_deletion_logs')
        .insert([{ admin_id: adminId, admin_username: adminUsername, event_id: eventId, event_name: eventName, status: 'started', ip_address: ip }])
        .select('id')
        .maybeSingle();
      if (insertErr) {
        console.warn('Could not insert event_deletion_logs:', insertErr);
      } else if (inserted) {
        logId = inserted.id;
        console.log('DEBUG: event_deletion_logs created id=', logId);
      }
    } catch (e) {
      console.warn('Error preparing event_deletion_logs entry:', e);
    }

    // 1) delete attendance tied to this event
    const { error: delAttErr } = await supabaseClient
      .from('attendance')
      .delete()
      .eq('event_id', eventId);

    if (delAttErr) {
      console.error('Error deleting attendance for event:', delAttErr);
      alert('❌ Failed to delete attendance records. See console.');
      try { if (logId) await supabaseClient.from('event_deletion_logs').update({ status: 'failed' }).eq('id', logId); } catch (e) { console.warn('Failed to update deletion log status:', e); }
      return;
    }
    console.log('DEBUG: attendance deleted for event id=', eventId);

    // 2) delete sanctions which reference this event name
    const { error: delSanErr } = await supabaseClient
      .from('sanctions')
      .delete()
      .eq('event_name', eventName);

    if (delSanErr) {
      console.error('Error deleting sanctions for event:', delSanErr);
      alert('❌ Failed to delete related sanctions. See console.');
      try { if (logId) await supabaseClient.from('event_deletion_logs').update({ status: 'failed' }).eq('id', logId); } catch (e) { console.warn('Failed to update deletion log status:', e); }
      return;
    }
    console.log('DEBUG: sanctions deleted for event name=', eventName);

    // 3) delete the event itself
    const { error: delEvErr } = await supabaseClient
      .from('event_info')
      .delete()
      .eq('idevent_info', eventId);

    if (delEvErr) {
      console.error('Error deleting event:', delEvErr);
      alert('❌ Failed to delete event. See console.');
      try { if (logId) await supabaseClient.from('event_deletion_logs').update({ status: 'failed' }).eq('id', logId); } catch (e) { console.warn('Failed to update deletion log status:', e); }
      return;
    }
    console.log('DEBUG: event deleted id=', eventId);
    try { if (logId) await supabaseClient.from('event_deletion_logs').update({ status: 'success' }).eq('id', logId); } catch (e) { console.warn('Failed to update deletion log status to success:', e); }

    alert('✅ Event and related records deleted successfully!');
    loadEvents(); // refresh table
  } catch (err) {
    console.error('❌ Error deleting event and related data:', err);
    try { if (logId) await supabaseClient.from('event_deletion_logs').update({ status: 'failed' }).eq('id', logId); } catch (e) { console.warn('Failed to update deletion log status in catch:', e); }
    alert('❌ Failed to delete event and/or related data. Check console for details.');
  }
}


async function loadEvents() {
  const { data, error } = await supabaseClient
    .from("event_info")
    .select("idevent_info, event_name, date, time_start, time_end, late_until, status, closed")
    .order("date", { ascending: false });

  if (error) {
    console.error("❌ Error loading events:", error);
    return;
  }

  // ✅ Table
  const table = document.getElementById("eventsTable");
  table.innerHTML = "";

  // ✅ Dropdowns
  const eventFilter = document.getElementById("eventFilter");
  const attendanceEvent = document.getElementById("attendanceEvent");
  const dashboardEventFilter = document.getElementById("dashboardEventFilter");

  if (eventFilter) eventFilter.innerHTML = '<option value="">Select Event</option>';
  if (attendanceEvent) attendanceEvent.innerHTML = '<option value="">Select Event</option>';
  if (dashboardEventFilter) dashboardEventFilter.innerHTML = '<option value="">Select Event</option>';

  data.forEach((event) => {
    // --- Table ---
    const row = `
      <tr>
      <td>${event.date}</td>
        <td>${event.event_name}</td>
        
        <td>${formatTimeTo12Hour(event.time_start)}</td>
        <td>${formatTimeTo12Hour(event.time_end)}</td>
        <td>${formatTimeTo12Hour(event.late_until)}</td>
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

    // --- Dropdown options ---
    const opt = document.createElement("option");
    opt.value = event.idevent_info;
    opt.textContent = event.event_name;

    if (eventFilter) eventFilter.appendChild(opt.cloneNode(true));
    if (attendanceEvent) attendanceEvent.appendChild(opt.cloneNode(true));
    if (dashboardEventFilter) dashboardEventFilter.appendChild(opt);
  });
  updateEventStats();
}


async function editEvent(eventId) {
  try {
    // fetch the event from Supabase
    const { data, error } = await supabaseClient
      .from("event_info")
      .select("idevent_info, event_name, date, time_start, time_end, late_until, status")
      .eq("idevent_info", eventId)
      .single();

    if (error) {
      console.error("❌ Error fetching event:", error);
      alert("Failed to load event details.");
      return;
    }

    // populate form fields
    document.getElementById("editEventId").value = data.idevent_info;
    document.getElementById("editEventName").value = data.event_name;
    document.getElementById("editEventDate").value = data.date;
    document.getElementById("editStartTime").value = data.time_start.slice(0, 5); // HH:MM
    document.getElementById("editEndTime").value = data.time_end.slice(0, 5);     // HH:MM
    document.getElementById("editEventStatus").value = data.status;
    document.getElementById("editLateUntil").value = data.late_until.slice(0, 5);


    // open your modal (depends on how you handle modals)
    openModal("editEventModal");

  } catch (err) {
    console.error("❌ Unexpected error in editEvent:", err);
  }
}
function openAddSanctionModal() {
  loadSanctionEventDropdown();   // ✅ load events
  openModal("addSanctionModal"); // ✅ show modal
}


// ✅ Universal status calculator
function getEventStatus(eventDate, startTime, lateUntil) {
  const now = new Date();
  const eventStart = new Date(`${eventDate}T${startTime}`);
  const eventLate = new Date(`${eventDate}T${lateUntil}`);

  if (now < eventStart) return "upcoming";
  if (now >= eventStart && now <= eventLate) return "ongoing";
  return "completed";
}





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



// -------------------- SCANNING + TESTING CONTROL --------------------
let scanning = false;
let testing = false;
let lastUID = null;

// ✅ Toggle scanning (start/stop)
function toggleScanning() {
  const btn = document.getElementById("scanToggleBtn");
  const input = document.getElementById("rfidInput");
  const status = document.getElementById("rfidStatus");
  const indicator = document.getElementById("rfidIndicator");

  // 🔴 If Test Scanner is ON, turn it OFF before starting scanning
  if (!scanning && testing) {
    stopTesting();
  }

  if (!scanning) {
    // Start scanning
    scanning = true;
    btn.classList.remove("start");
    btn.classList.add("stop");
    btn.innerHTML = `<i class="fas fa-stop"></i> Stop Scanning`;

    status.innerText = "Scanning...";
    indicator.classList.add("active");

    input.value = "";
    input.focus(); // RFID reader will type here
    document.getElementById("lastScannedInfo").innerText = "Waiting for scan...";
  } else {
    // Stop scanning
    scanning = false;
    btn.classList.remove("stop");
    btn.classList.add("start");
    btn.innerHTML = `<i class="fas fa-play"></i> Start Scanning`;

    status.innerText = "RFID Scanner Ready";
    indicator.classList.remove("active");

    input.blur();
    lastUID = null;
    document.getElementById("lastScannedInfo").innerText = "Scanner stopped";
  }
}
// ✅ Listen for Enter from RFID reader
document.getElementById("rfidInput").addEventListener("keydown", async function (e) {
  if (e.key === "Enter") {
    e.preventDefault();
    const uid = this.value.trim();
    this.value = ""; // clear after scan
    const info = document.getElementById("lastScannedInfo");

    if (!uid) return;

    if (testing) {
      // === TEST SCANNER MODE ===
      try {
        const { data: student } = await supabaseClient
          .from("student_info")
          .select("name")
          .eq("rfid", uid)
          .maybeSingle();

        if (student) {
          info.innerText = `🟢 Testing: ${student.name} (${uid})`;
        } else {
          info.innerText = `🟠 Testing: Unknown card (${uid})`;
        }
      } catch (err) {
        info.innerText = "❌ Error during test";
      }
    } else if (scanning) {
      // === ATTENDANCE SCANNING MODE ===
      checkRFID(uid);
    }
  }
});



async function exportSanctionsCSV() {
  const eventName = document.getElementById("sanctionEventFilter")?.value || "";
  const section = document.getElementById("sanctionSectionFilter")?.value || "";
  const teamId = document.getElementById("sanctionTeamFilter")?.value || "";
  const yearLevel = document.getElementById("sanctionYearFilter")?.value || "";
  const showResolved = document.getElementById("showResolvedCheckbox")?.checked || false;

  try {
    // ✅ Get readable team name for filename (not just ID)
    const teamSelect = document.getElementById("sanctionTeamFilter");
    const teamName =
      teamSelect && teamSelect.selectedIndex > 0
        ? teamSelect.options[teamSelect.selectedIndex].text
        : "";

    // ✅ Fetch ALL sanctions data in batches (bypasses 1000 limit)
    let allData = [];
    let from = 0;
    const batchSize = 1000;

    while (true) {
      let query = supabaseClient
        .from("sanctions")
        .select(`
          id,
          student_info (
            name,
            year_level,
            section,
            team_id
          ),
          event_name,
          penalty,
          fee,
          date_given,
          status
        `)
        .range(from, from + batchSize - 1);

      // ✅ Exclude resolved unless checkbox is ticked
      if (!showResolved) {
        query = query.neq("status", "resolved");
      }

      // ✅ Event filter
      if (eventName) {
        query = query.eq("event_name", eventName);
      }

      const { data, error } = await query;
      
      if (error) throw error;
      if (!data || data.length === 0) break;

      allData.push(...data);
      if (data.length < batchSize) break;
      from += batchSize;
    }

    if (allData.length === 0) {
      alert("❌ No sanctions data to export.");
      return;
    }

    console.log(`✅ Loaded ${allData.length} total sanctions records`);

    // ✅ Apply filters client-side
    let filtered = allData;

    if (yearLevel) {
      filtered = filtered.filter(s => String(s.student_info?.year_level) === String(yearLevel));
    }

    if (section) {
      filtered = filtered.filter(s => s.student_info?.section === section);
    }

    if (teamId) {
      filtered = filtered.filter(s => String(s.student_info?.team_id) === String(teamId));
    }

    if (!filtered.length) {
      alert("❌ No sanctions found for selected filters.");
      return;
    }

    // ✅ Sort alphabetically by student name
    filtered.sort((a, b) => (a.student_info?.name || "").localeCompare(b.student_info?.name || ""));

    // ✅ Build CSV header
    let csv = "Name,Year Level,Section,Event,Penalty,Fee,Date Given,Status\n";

    // ✅ Add CSV rows
    filtered.forEach(row => {
      const formattedDate = row.date_given
        ? new Date(row.date_given + "T00:00:00").toLocaleDateString("en-PH", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        })
        : "-";

      csv += `"${row.student_info?.name ?? "-"}",` +
        `"${row.student_info?.year_level ?? "-"}",` +
        `"${row.student_info?.section ?? "-"}",` +
        `"${row.event_name ?? "-"}",` +
        `"${row.penalty ?? "-"}",` +
        `"${row.fee ? Number(row.fee).toLocaleString() : "-"}",` +
        `"${formattedDate}",` +
        `"${row.status ?? "-"}"\n`;
    });

    // ✅ Build filename (include year level & team name)
    const dateStr = new Date().toISOString().split("T")[0];
    let fileName = "Sanctions";
    fileName += eventName ? `-${eventName}` : "-AllEvents";
    fileName += yearLevel ? `-${yearLevel}` : "-AllYears";
    fileName += teamName ? `-${teamName}` : "-AllTeams";
    fileName += section ? `-Section${section}` : "-AllSections";
    fileName += `-${dateStr}`;

    // ✅ Create downloadable CSV (UTF-8 BOM fixes ñ/é/ü)
    const bom = "\uFEFF";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log(`✅ Exported ${filtered.length} records to ${fileName}.csv`);

  } catch (err) {
    console.error("❌ Failed to export CSV:", err);
    alert("❌ Failed to export sanctions.");
  }
}






function testScanner(button) {
  const input = document.getElementById("rfidInput");
  const info = document.getElementById("lastScannedInfo");

  // 🔴 If Start Scanning is ON, turn it OFF before testing
  if (!testing && scanning) {
    toggleScanning(); // stop scanning first
  }

  if (!testing) {
    // Enable testing
    testing = true;
    button.style.backgroundColor = "gold";
    document.getElementById("lastScanned").querySelector("h3").innerText = "Testing Scan";
    info.innerText = "🟡 Waiting for card...";
    input.value = "";
    input.focus(); // CRITICAL: Focus the input for RFID reader
  } else {
    // Disable testing
    testing = false;
    button.style.backgroundColor = "";
    document.getElementById("lastScanned").querySelector("h3").innerText = "Last Scanned";
    info.innerText = "Stopped testing";
  }
}

// ✅ Optimized RFID reader input listener
document.getElementById("rfidInput").addEventListener("keydown", async function (e) {
  // Handle Enter key (card scan complete)
  if (e.key === "Enter") {
    e.preventDefault();
    const uid = this.value.trim();

    // 🛡️ CRITICAL FIX: Ignore empty scans
    if (uid === "") {
      return; // Don't process empty scans
    }

    // Only process if in testing mode
    if (!testing) return;

    const info = document.getElementById("lastScannedInfo");
    info.innerText = `🔄 Processing: ${uid}`;

    try {
      // Query Supabase directly
      const { data: student, error } = await supabaseClient
        .from("student_info")
        .select("name")
        .eq("rfid", uid)
        .maybeSingle();

      if (error) {
        info.innerText = "❌ Database error during test";
        return;
      }

      if (student) {
        info.innerText = `🟢 Testing: ${student.name} (${uid})`;
      } else {
        info.innerText = `🟠 Testing: Unknown card (${uid})`;
      }

    } catch (err) {
      console.error("Database error:", err);
      info.innerText = "❌ Unexpected error during test";
    }

    // ✅ CRITICAL FIX: Clear input AND re-focus for next scan
    setTimeout(() => {
      this.value = "";
      this.focus(); // Re-focus for continuous scanning
    }, 2000);
  }
});

// 🎯 CRITICAL FIX: Auto re-focus if input loses focus during testing
setInterval(() => {
  const input = document.getElementById("rfidInput");
  if (testing && document.activeElement !== input) {
    input.focus(); // Automatically re-focus
  }
}, 500); // Check every 500ms for faster response

// 🔄 BONUS: Focus on page load if testing is already enabled
document.addEventListener("DOMContentLoaded", function () {
  if (typeof testing !== 'undefined' && testing) {
    document.getElementById("rfidInput").focus();
  }
});



function stopTesting() {
  testing = false;
  const button = document.getElementById("testScannerBtn");
  if (button) button.style.backgroundColor = "";
  document.getElementById("lastScanned").querySelector("h3").innerText = "Last Scanned";
  document.getElementById("lastScannedInfo").innerText = "Stopped testing";
}



// ✅ Update only upcoming or ongoing events
async function updateAllEvents() {
  try {
    const { data: events, error } = await supabaseClient
      .from("event_info")
      .select("idevent_info, event_name, date, time_start, time_end, late_until, status, closed")
      .in("status", ["upcoming", "ongoing"]);  // ⬅️ only active ones

    if (error) {
      console.error("❌ Error fetching events:", error);
      return;
    }

    let updatedCount = 0;

    for (const event of events) {
      if (!event.date) continue;

      const newStatus = getEventStatus(event.date, event.time_start, event.late_until);
      const newClosed = (newStatus === "completed");

      // ✅ Update DB only if something changed
      if (newStatus !== event.status || newClosed !== event.closed) {
        const { error: updateErr } = await supabaseClient
          .from("event_info")
          .update({ status: newStatus, closed: newClosed })
          .eq("idevent_info", event.idevent_info);

        if (updateErr) {
          console.error(`❌ Failed to update event ${event.event_name}:`, updateErr);
        } else {
          updatedCount++;
          console.log(`✅ Event ${event.event_name} updated to ${newStatus}`);

          if (newClosed && !event.closed) {
            try {
              await markAbsenteesWithRetry(event);
            } catch (err) {
              if (!navigator.onLine) {
                enqueueRetry(() => markAbsenteesWithRetry(event));
              } else {
                console.error("❌ Failed to mark absentees for event:", event.event_name, err);
              }
            }
          }

        }
      }
    }

    console.log(`🔄 ${updatedCount}/${events.length} events updated`);
    loadEvents(); // Refresh your events table UI
  } catch (err) {
    console.error("❌ updateAllEvents failed:", err);
  }
}




// ✅ Test function to check specific event
async function testSpecificEvent(eventId) {
  try {
    const { data: event, error } = await supabaseClient
      .from("event_info")
      .select("*")
      .eq("idevent_info", eventId)
      .single();

    if (error) {
      console.error("Error fetching event:", error);
      return;
    }

    console.log("📋 Event Details:");
    console.log(event);

    const now = new Date();
    const start = new Date(`${event.date}T${event.time_start}`);
    const end = new Date(`${event.date}T${event.time_end}`);
    const lateUntil = new Date(`${event.date}T${event.late_until}`);

    console.log("\n⏰ Time Comparison:");
    console.log(`Now:        ${now.toISOString()}`);
    console.log(`Start:      ${start.toISOString()}`);
    console.log(`End:        ${end.toISOString()}`);
    console.log(`Late Until: ${lateUntil.toISOString()}`);

    console.log("\n🔍 Conditions:");
    console.log(`now < start:           ${now < start}`);
    console.log(`now >= start && now <= end: ${now >= start && now <= end}`);
    console.log(`now > end && now <= lateUntil: ${now > end && now <= lateUntil}`);
    console.log(`now > lateUntil:       ${now > lateUntil}`);

  } catch (error) {
    console.error("Test failed:", error);
  }
}

// ✅ Update just one event (skip if completed already)
async function forceUpdateEventStatus(eventId) {
  const { data: events, error } = await supabaseClient
    .from("event_info")
    .select("*")
    .eq("idevent_info", eventId);

  if (error || !events || events.length === 0) {
    console.error("❌ Event not found:", error);
    return;
  }

  const event = events[0];
  if (event.status === "completed") {
    console.log(`⏭ Event ${event.event_name} already completed — no update needed`);
    return;
  }

  const newStatus = getEventStatus(event.date, event.time_start, event.late_until);
  const newClosed = (newStatus === "completed");

  if (newStatus !== event.status || newClosed !== event.closed) {
    const { error: updateError } = await supabaseClient
      .from("event_info")
      .update({ status: newStatus, closed: newClosed })
      .eq("idevent_info", eventId);

    if (updateError) {
      console.error("❌ Update failed:", updateError);
    } else {
      console.log(`✅ Event ${event.event_name} updated to ${newStatus}`);
    }
  }
}


//  Utility: Get Philippines time as ISO string
function getPhilippinesISOTime() {
  const nowPH = new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" });
  return new Date(nowPH).toISOString();
}

//  Optimized Main Check RFID Function
async function checkRFID(uid) {
  const info = document.getElementById("lastScannedInfo");

  //  Input validation
  if (!uid || uid.trim() === "") {
    console.warn("Empty UID provided to checkRFID");
    return;
  }

  const cleanUID = uid.trim();
  console.log("🔍 Processing RFID:", cleanUID);

  // Show processing state immediately
  info.innerText = `🔄 Processing card: ${cleanUID}`;

  try {
    //  Step 1: Get student by RFID (optimized query)
    console.log("Step 1: Fetching student data...");
    const { data: student, error: studentErr } = await supabaseClient
      .from("student_info")
      .select("idstudent_info, student_id, name, rfid") // Only select needed fields
      .eq("rfid", cleanUID)
      .maybeSingle(); // Use maybeSingle instead of single for better error handling

    if (studentErr) {
      console.error("❌ Student query error:", studentErr);
      info.innerText = `❌ Database error while checking card`;
      return;
    }

    if (!student) {
      console.log("⚠️ Unknown RFID:", cleanUID);
      info.innerText = `❌ Unknown card (${cleanUID})`;
      return;
    }

    console.log("✅ Student found:", student.name);

    // 📅 Step 2: Validate event selection
    const eventId = document.getElementById("eventFilter").value;
    if (!eventId || eventId === "") {
      info.innerText = "⚠️ Please select an event before scanning!";
      return;
    }

    console.log("Step 2: Fetching event data for ID:", eventId);

    // 📅 Step 3: Get event info (optimized query)
    const { data: event, error: eventErr } = await supabaseClient
      .from("event_info")
      .select("event_name, date, time_start, time_end, late_until, closed")
      .eq("idevent_info", eventId)
      .maybeSingle();

    if (eventErr) {
      console.error("❌ Event query error:", eventErr);
      info.innerText = "❌ Error fetching event details";
      return;
    }

    if (!event) {
      info.innerText = "❌ Event not found";
      return;
    }

    console.log("✅ Event found:", event.event_name);

    // 🚫 Step 4: Check if event is closed
    if (event.closed) {
      info.innerText = `⛔ Event "${event.event_name}" is closed. No more scanning allowed.`;
      return;
    }

    // ⏰ Step 5: Time validation (optimized)
    const now = new Date();
    const philippinesTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Manila" }));
    const todayDate = philippinesTime.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }); // ✅ PH local date
    const currentTime = philippinesTime.toTimeString().split(" ")[0]; // HH:MM:SS

    // Create event time boundaries
    const eventStart = new Date(`${event.date}T${event.time_start}`);
    const eventEnd = new Date(`${event.date}T${event.time_end}`);
    const lateLimit = new Date(`${event.date}T${event.late_until}`);

    console.log("⏰ Time check:", {
      now: philippinesTime.toISOString(),
      eventStart: eventStart.toISOString(),
      eventEnd: eventEnd.toISOString(),
      lateLimit: lateLimit.toISOString()
    });

    // Time boundary checks
    if (philippinesTime < eventStart) {
      info.innerText = `⚠️ Too early! Scanning opens at ${event.time_start} for "${event.event_name}"`;
      return;
    }

    if (philippinesTime > lateLimit) {
      info.innerText = `⛔ Attendance closed at ${event.late_until} (manual entry required)`;
      return;
    }

    // Determine status
    let status = "present";
    if (philippinesTime > eventEnd && philippinesTime <= lateLimit) {
      status = "late";
      console.log("📝 Student will be marked as LATE");
    }

    // 🔍 Step 6: Check for duplicate attendance (optimized)
    console.log("Step 6: Checking for existing attendance...");
    const { data: existing, error: existingErr } = await supabaseClient
      .from("attendance")
      .select("idattendance, status, scan_time")
      .eq("student_id", student.idstudent_info)
      .eq("event_id", eventId)
      .maybeSingle();

    if (existingErr) {
      console.error("❌ Existing attendance check error:", existingErr);
      info.innerText = "❌ Error checking existing attendance";
      return;
    }

    if (existing) {
      console.log("⚠️ Duplicate scan detected");
      info.innerText = `⚠️ ${student.name} already scanned (${existing.status} at ${existing.scan_time})`;
      return;
    }

    //  Step 7: Insert attendance record
    console.log("Step 7: Recording attendance...");
    // inside checkRFID() where you insert attendance
    const { error: insertErr } = await supabaseClient
      .from("attendance")
      .insert({
        student_id: student.idstudent_info,
        event_id: eventId,
        status,
        date: todayDate,
        scan_time: currentTime,
        // NEW cached fields:
        student_name_cached: student.name,
        student_school_id_cached: student.student_id
      });


    if (insertErr) {
      console.error("❌ Failed to log attendance:", insertErr);
      info.innerText = `❌ Failed to record attendance for ${student.name}`;
      return;
    }

    console.log("✅ Attendance recorded successfully");

    // ⚖️ Step 8: Handle late sanctions
    if (status === "late") {
      console.log("Step 8: Recording late sanction...");
      const { error: sanctionErr } = await supabaseClient
        .from("sanctions")
        .insert({
          idstudent_info: student.idstudent_info,
          student_id: student.student_id,
          student_name: student.name,
          event_name: event.event_name,
          penalty: "Late",
          fee: 500,
          date_given: todayDate,
          status: "pending",
        });

      if (sanctionErr) {
        console.error(" Failed to insert sanction:", sanctionErr);
        // Don't return here - attendance was successful
      } else {
        console.log("✅ Late sanction recorded");
      }
    }

    // Success feedback
    const statusEmoji = status === "late" ? "🟡" : "✅";
    info.innerText = `${statusEmoji} ${student.name} marked ${status.toUpperCase()}`;


    //  Refresh attendance table (with error handling)
    try {
      if (typeof filterAttendance === 'function') {
        filterAttendance(attendanceCurrentPage);
      }
    } catch (refreshErr) {
      console.warn("⚠️ Failed to refresh attendance table:", refreshErr);
    }

    console.log("🎉 checkRFID completed successfully for:", student.name);

  } catch (err) {
    console.error("💥 Unexpected error in checkRFID:", err);
    info.innerText = `❌ System error occurred - please try again`;
  }
}


// Helper: Insert data in chunks with retry
async function insertInChunks(table, data, chunkSize = 50, maxRetries = 3) {
  const totalItems = data.length;
  const chunks = [];

  // Split data into chunks
  for (let i = 0; i < totalItems; i += chunkSize) {
    chunks.push(data.slice(i, i + chunkSize));
  }

  console.log(`Split ${totalItems} items into ${chunks.length} chunks of ${chunkSize}`);

  let successCount = 0;
  let failedChunks = [];

  // Insert each chunk with retry
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    let attempt = 0;
    let success = false;

    while (attempt < maxRetries && !success) {
      try {
        attempt++;
        console.log(`Inserting chunk ${i + 1}/${chunks.length} (${chunk.length} items, attempt ${attempt}/${maxRetries})...`);

        const { error } = await supabaseClient
          .from(table)
          .insert(chunk);

        if (error) throw error;

        successCount += chunk.length;
        success = true;
        console.log(`Chunk ${i + 1} inserted successfully`);

        // Small delay between chunks to avoid overwhelming the connection
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (err) {
        console.error(`Chunk ${i + 1} failed (attempt ${attempt}):`, err.message);

        if (attempt === maxRetries) {
          failedChunks.push({ chunkIndex: i, chunk, error: err.message });
          console.error(`Chunk ${i + 1} failed after ${maxRetries} attempts`);
        } else {
          // Exponential backoff before retry
          const waitTime = Math.pow(2, attempt) * 1000;
          console.log(`Waiting ${waitTime / 1000}s before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
  }

  return { successCount, failedChunks, totalItems };
}

// Mark absentees with chunked inserts + duplicate protection
async function markAbsenteesForEvent(event) {
  console.log(`Starting absentee marking for event: ${event.event_name}`);

  try {
    // 1. Get all students in batches (fixes 1000 limit)
    let students = [];
    let from = 0;
    const batchSize = 1000;

    while (true) {
      const { data, error } = await supabaseClient
        .from("student_info")
        .select("idstudent_info, student_id, name")
        .range(from, from + batchSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      students.push(...data);
      if (data.length < batchSize) break;
      from += batchSize;
    }

    console.log(`Total students in database: ${students.length}`);

    // 2. Get students who already attended this event
    const { data: attendance, error: attErr } = await supabaseClient
      .from("attendance")
      .select("student_id")
      .eq("event_id", event.idevent_info);

    if (attErr) throw attErr;
    const attendedIds = attendance.map((a) => a.student_id);

    console.log(`Students who attended: ${attendedIds.length}`);

    // 3. Find absentees
    const absentees = students.filter(
      (s) => !attendedIds.includes(s.idstudent_info)
    );

    if (absentees.length === 0) {
      console.log("No absentees found - everyone attended!");
      return { success: true, message: "No absentees found" };
    }

    console.log(`Absentees found: ${absentees.length}`);

    // 4. Prepare date/time (Philippine timezone)
    const phNow = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" })
    );
    const phDate = phNow.toISOString().split("T")[0];
    const phTime = phNow.toTimeString().split(" ")[0];

    // 5. Prepare sanctions data
    const sanctionsToInsert = absentees.map((student) => ({
      idstudent_info: student.idstudent_info,
      student_id: student.student_id,
      student_name: student.name,
      event_name: event.event_name,
      penalty: "Absent",
      fee: 1500,
      date_given: phDate,
      status: "pending",
    }));

    // 6. Insert sanctions safely (avoid duplicates)
    const { error: sanctionErr } = await supabaseClient
      .from("sanctions")
      .upsert(sanctionsToInsert, {
        onConflict: ["idstudent_info", "event_name"],
        ignoreDuplicates: true,
      });

    if (sanctionErr) throw sanctionErr;
    console.log(`✅ ${sanctionsToInsert.length} sanctions inserted or skipped.`);

    // 7. Prepare attendance data for absentees
    const attendanceToInsert = absentees.map((student) => ({
      event_id: event.idevent_info,
      student_id: student.idstudent_info,
      date: phDate,
      scan_time: phTime,
      status: "absent",
    }));

    // 8. Insert attendance safely
    const { error: attendanceErr } = await supabaseClient
      .from("attendance")
      .upsert(attendanceToInsert, {
        onConflict: ["student_id", "event_id"],
        ignoreDuplicates: true,
      });

    if (attendanceErr) throw attendanceErr;
    console.log(`✅ ${attendanceToInsert.length} absences inserted or skipped.`);

    console.log(`🎉 Absentee marking completed for "${event.event_name}"`);

    return {
      success: true,
      sanctionsInserted: sanctionsToInsert.length,
      attendanceInserted: attendanceToInsert.length,
    };
  } catch (err) {
    console.error("❌ markAbsenteesForEvent failed:", err);
    throw err;
  }
}


// Auto-fix missing absentees for all completed events

// ✅ autoFixMissingAbsentees — fully fixed with >1000 attendance handling
async function autoFixMissingAbsentees() {
  try {
    console.log("🔄 Starting auto-fix for missing absentees...");

    // 1️⃣ Get all completed & closed events
    const { data: completedEvents, error } = await supabaseClient
      .from("event_info")
      .select("*")
      .eq("closed", true)
      .eq("status", "completed");

    if (error) {
      console.error("❌ Error fetching completed events:", error);
      return;
    }

    if (!completedEvents || completedEvents.length === 0) {
      console.log("ℹ️ No completed events to process");
      return;
    }

    console.log(`📅 Found ${completedEvents.length} completed events to check`);

    let processedCount = 0;
    let skippedCount = 0;

    // 2️⃣ Process each completed event
    for (const event of completedEvents) {
      try {
        console.group(`📘 Checking event: ${event.event_name}`);

        // Get all students (handles >1000)
        let students = [];
        let from = 0;
        const batchSize = 1000;

        while (true) {
          const { data, error } = await supabaseClient
            .from("student_info")
            .select("idstudent_info")
            .range(from, from + batchSize - 1);

          if (error) throw error;
          if (!data || data.length === 0) break;

          students.push(...data);
          if (data.length < batchSize) break;
          from += batchSize;
        }

        const totalStudents = students.length;

        if (totalStudents === 0) {
          console.warn(`⚠️ Event "${event.event_name}" - No students found, skipping`);
          skippedCount++;
          console.groupEnd();
          continue;
        }

        // ✅ Get attendance in batches (fixes 1000 cap)
        let attendance = [];
        from = 0;

        while (true) {
          const { data, error } = await supabaseClient
            .from("attendance")
            .select("student_id, status")
            .eq("event_id", event.idevent_info)
            .range(from, from + batchSize - 1);

          if (error) throw error;
          if (!data || data.length === 0) break;

          attendance.push(...data);
          if (data.length < batchSize) break;
          from += batchSize;
        }

        const totalAttendance = attendance.length;
        const missingCount = totalStudents - totalAttendance;

        if (totalAttendance >= totalStudents) {
          console.log(
            `✅ Event "${event.event_name}" already complete (${totalAttendance}/${totalStudents})`
          );
          skippedCount++;
          console.groupEnd();
          continue;
        }

        console.log(
          `📝 Processing "${event.event_name}" (${totalAttendance}/${totalStudents} marked) - ${missingCount} missing`
        );

        // Revalidate attendance & sanctions
        console.log(`🔁 Revalidating attendance + sanctions for "${event.event_name}"`);
        await markAbsenteesWithRetry(event);

        processedCount++;
        console.groupEnd();
      } catch (err) {
        console.error(`❌ Failed to process "${event.event_name}":`, err.message);
        console.groupEnd();
        continue;
      }
    }

    // Summary
    console.log("🧾 AUTO-FIX COMPLETED");
    console.log(`Total Events: ${completedEvents.length}`);
    console.log(`Processed (Revalidated): ${processedCount}`);
    console.log(`Already Complete: ${skippedCount}`);
  } catch (err) {
    console.error("❌ Auto-fix failed:", err);
  }
}



// ✅ markAbsenteesWithRetry — fully fixed and safe version
async function markAbsenteesWithRetry(event) {
  try {
    console.log(`📝 Processing "${event.event_name}" (${event.event_name})...`);

    // 1️⃣ Fetch all students (handles >1000)
    let students = [];
    let from = 0;
    const batchSize = 1000;

    while (true) {
      const { data, error } = await supabaseClient
        .from("student_info")
        .select("idstudent_info, student_id, name")
        .range(from, from + batchSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      students.push(...data);
      if (data.length < batchSize) break;
      from += batchSize;
    }

    console.log(`👥 Total students loaded: ${students.length}`);

    // 2️⃣ Get existing attendance (handles >1000)
    let attendance = [];
    from = 0;

    while (true) {
      const { data, error } = await supabaseClient
        .from("attendance")
        .select("student_id, status")
        .eq("event_id", event.idevent_info)
        .range(from, from + batchSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      attendance.push(...data);
      if (data.length < batchSize) break;
      from += batchSize;
    }

    const attendedIds = new Set(attendance.map((a) => a.student_id));
    const absentees = students.filter((s) => !attendedIds.has(s.idstudent_info));

    console.log(
      `✅ Total: ${students.length}, Attended: ${attendedIds.size}, Missing: ${absentees.length}`
    );

    if (absentees.length === 0) {
      console.log(`🎉 Event "${event.event_name}" already complete.`);
      return;
    }

    // 3️⃣ Prepare PH time
    const phNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
    const phDate = phNow.toISOString().split("T")[0];
    const phTime = phNow.toTimeString().split(" ")[0];

    // 4️⃣ Prepare sanction data
    const sanctionData = absentees.map((a) => ({
      idstudent_info: a.idstudent_info,
      student_id: a.student_id,
      student_name: a.name,
      event_name: event.event_name,
      penalty: "Absent",
      fee: 1500,
      date_given: phDate,
      status: "pending",
    }));

    // 5️⃣ Upsert sanctions safely (avoid duplicates)
    const { error: sanctionErr } = await supabaseClient
      .from("sanctions")
      .upsert(sanctionData, {
        onConflict: ["idstudent_info", "event_name"],
        ignoreDuplicates: true,
      });

    if (sanctionErr) throw sanctionErr;
    console.log(`✅ ${sanctionData.length} sanctions inserted or skipped.`);

    // 6️⃣ Prepare attendance data
    const absentAttendance = absentees.map((a) => ({
      student_id: a.idstudent_info,
      event_id: event.idevent_info,
      status: "absent",
      scan_time: phTime,
      date: phDate,
    }));

    // 7️⃣ Upsert attendance safely (avoid duplicates)
    const { error: attendanceErr } = await supabaseClient
      .from("attendance")
      .upsert(absentAttendance, {
        onConflict: ["student_id", "event_id"],
        ignoreDuplicates: true,
      });

    if (attendanceErr) throw attendanceErr;
    console.log(`✅ ${absentAttendance.length} absences inserted or skipped.`);

    // 8️⃣ Completion message
    const completionRate = ((attendedIds.size / students.length) * 100).toFixed(1);
    const missingRate = ((absentees.length / students.length) * 100).toFixed(1);

    alert(
      `✅ Auto Absent Complete for "${event.event_name}"\n\n` +
      `Present: ${completionRate}% (${attendedIds.size}/${students.length})\n` +
      `Absent: ${missingRate}% (${absentees.length} students)`
    );

    console.log(`✅ Absentees marked successfully for "${event.event_name}"`);
  } catch (err) {
    console.error(`❌ markAbsenteesWithRetry failed for "${event.event_name}":`, err);
    if (!navigator.onLine) {
      enqueueRetry(() => markAbsenteesWithRetry(event));
    } else {
      alert(`⚠️ Failed to auto-mark absentees for "${event.event_name}". Check console.`);
    }
  }
}







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
  // ✅ Refresh with current page and filters
  filterAttendance(attendanceCurrentPage);
}

// Open Edit modal and prefill

async function editStudent(id) {
  // Fetch student first
  const { data: student, error } = await supabaseClient
    .from("student_info")
    .select("idstudent_info, student_id, name, rfid, year_level, section, team_id, password")
    .eq("idstudent_info", id)
    .single();

  if (error || !student) {
    console.error("Error fetching student:", error);
    alert("Failed to load student.");
    return;
  }

  // Populate form fields
  document.getElementById("editStudentId").value = student.idstudent_info;
  document.getElementById("editStudentSchoolId").value = student.student_id || "";
  document.getElementById("editStudentName").value = student.name || "";
  document.getElementById("editStudentRfid").value = student.rfid || "";
  document.getElementById("editStudentYear").value = student.year_level || "";
  document.getElementById("editStudentSection").value = student.section || "";
  document.getElementById("editStudentPassword").value = student.password || "";

  // Load teams into dropdown and preselect student's team
  await loadEditStudentTeams(student.team_id);

  // Finally, open modal
  openModal("editStudentModal");
}

// ✅ Save student edits safely
async function saveStudentEdit() {
  const idField = document.getElementById("editStudentId");
  const schoolIdField = document.getElementById("editStudentSchoolId");
  const nameField = document.getElementById("editStudentName");
  const rfidField = document.getElementById("editStudentRfid");
  const yearField = document.getElementById("editStudentYear");
  const sectionField = document.getElementById("editStudentSection");
  const teamField = document.getElementById("editStudentTeam");
  const passField = document.getElementById("editStudentPassword");

  if (!idField || !schoolIdField || !nameField || !rfidField || !yearField || !sectionField || !teamField || !passField) {
    console.error("One or more editStudent fields not found in DOM");
    alert("Form error: some fields are missing. Check your modal HTML IDs.");
    return;
  }

  const id = idField.value;
  const schoolId = schoolIdField.value.trim();
  const name = nameField.value.trim();
  const rfid = rfidField.value.trim();
  const year = yearField.value;
  const section = sectionField.value.trim();
  const teamId = teamField.value;
  const password = passField.value;

  if (!id || !schoolId || !name || !rfid || !year || !section || !teamId || !password) {
    alert("Please fill in all fields.");
    return;
  }

  try {
    const { error } = await supabaseClient
      .from("student_info")
      .update({
        student_id: schoolId,
        name,
        rfid,
        year_level: year,
        section: section,
        team_id: teamId,
        password,
      })
      .eq("idstudent_info", id);

    if (error) throw error;

    alert("Student updated successfully!");
    closeModal("editStudentModal");
    loadStudents();
  } catch (err) {
    console.error("Error updating student:", err);
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
  document.getElementById("editStudentSection").value = student.section;
  document.getElementById("editStudentPassword").value = student.password;

  loadTeamsIntoEditModal(student.team_id); // ✅ load teams with proper ID

  openModal('editStudentModal');
}

// Open and close modal
function openModal(modalId) {
  const modalEl = document.getElementById(modalId);
  if (!modalEl) {
    console.warn('openModal: element not found', modalId);
    return;
  }
  try {
    console.log('DEBUG: openModal called for', modalId, 'current display=', getComputedStyle(modalEl).display);
  } catch (e) {
    console.log('DEBUG: openModal called for', modalId);
  }

  // Prefer flex so the modal centers (CSS uses flex layout)
  modalEl.classList.remove('hidden');
  modalEl.style.display = 'flex';
  modalEl.setAttribute('aria-hidden', 'false');

  // Load teams when opening add student modal
  if (modalId === 'addStudentModal') {
    loadTeams('studentTeam');
  }
}
function closeModal(modalId) {
  const modalEl = document.getElementById(modalId);
  if (!modalEl) {
    console.warn('closeModal: element not found', modalId);
    return;
  }
  console.log('DEBUG: closeModal called for', modalId);
  modalEl.style.display = 'none';
  modalEl.classList.add('hidden');
  modalEl.setAttribute('aria-hidden', 'true');
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
window.onclick = function (event) {
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
  const lateUntil = document.getElementById("editLateUntil").value + ":00";
  const status = document.getElementById("editEventStatus").value;

  const { error } = await supabaseClient
    .from("event_info")
    .update({
      event_name: eventName,
      date: eventDate,
      time_start: startTime,
      time_end: endTime,
      late_until: lateUntil,
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
  
  // Recalculate attendance statuses for this event after editing times (run in background)
  recalculateAttendanceStatuses(id, eventDate, startTime, endTime, lateUntil).catch(err => {
    console.error("Error in background reconciliation:", err);
  });
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

let sanctionCurrentPage = 1;
const sanctionRowsPerPage = 100;

async function fetchSanctions(page = 1) {
  const loader = document.getElementById("sanctionLoading");
  if (loader) {
    loader.classList.add("active");
    await new Promise(requestAnimationFrame);
  }

  try {
    // --- Filters from dropdowns ---
    const showResolved = document.getElementById("showResolvedCheckbox")?.checked || false;
    const eventName = document.getElementById("sanctionEventFilter")?.value || "";
    const section = document.getElementById("sanctionSectionFilter")?.value || "";
    const teamId = document.getElementById("sanctionTeamFilter")?.value || "";
    const yearLevel = document.getElementById("sanctionYearFilter")?.value || "";

    // 🔍 ADDED: Get search query
    const searchQuery = document.getElementById("searchInput")?.value.trim().toLowerCase() || "";


    // --- Load all sanctions (bypassing pagination limit) ---
    let allSanctions = [];
    let from = 0;
    const batch = 1000;

    if (!eventName) {
      const table = document.getElementById("sanctionTable");
      table.innerHTML = `<tr><td colspan="9">Please select an event to view sanctions.</td></tr>`;
      document.getElementById("sanctionTotalRecords").textContent = 0;
      document.getElementById("sanctionCurrentPage").textContent = 1;
      document.getElementById("sanctionTotalPages").textContent = 1;
      document.getElementById("totalSanctionFee").textContent = "₱0";
      document.getElementById("noOfAbsent").textContent = 0;
      document.getElementById("noOfLate").textContent = 0;
      document.getElementById("resolvedSanctionStudents").textContent = 0;
      document.getElementById("totalSanctionStudents").textContent = 0;
      if (loader) loader.classList.remove("active");
      return;
    }

    while (true) {
      const { data, error } = await supabaseClient
        .from("sanctions")
        .select(`
          id,
          student_info (
            name,
            year_level,
            section,
            team_id
          ),
          event_name,
          penalty,
          fee,
          date_given,
          status
        `)
        .eq("event_name", eventName)
        .order("date_given", { ascending: false })
        .range(from, from + batch - 1);

      if (error) {
        console.error("❌ Error loading sanctions:", error);
        throw error;
      }

      if (!data || data.length === 0) break;
      allSanctions = allSanctions.concat(data);
      if (data.length < batch) break;
      from += batch;
    }

    console.log(`✅ Loaded ${allSanctions.length} total sanctions for event: ${eventName}`);

    // --- Client-side filtering ---
    let filtered = allSanctions;

    if (!showResolved) filtered = filtered.filter((s) => s.status !== "resolved");
    if (yearLevel) filtered = filtered.filter((s) => String(s.student_info?.year_level) === String(yearLevel));
    if (section) filtered = filtered.filter((s) => s.student_info?.section === section);
    if (teamId) filtered = filtered.filter((s) => String(s.student_info?.team_id) === String(teamId));

    // 🔍 ADDED: Global search across all pages
    if (searchQuery) {
      filtered = filtered.filter((s) => {
        const name = s.student_info?.name?.toLowerCase() || "";
        const penalty = s.penalty?.toLowerCase() || "";
        const status = s.status?.toLowerCase() || "";
        return name.includes(searchQuery) || penalty.includes(searchQuery) || status.includes(searchQuery);
      });
      page = 1; // always reset to first page when searching
    }

    // --- Sort alphabetically ---
    filtered.sort((a, b) => (a.student_info?.name || "").localeCompare(b.student_info?.name || ""));

    // --- Pagination ---
    const totalRecords = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / sanctionRowsPerPage));
    const currentPage = Math.min(Math.max(1, page || 1), totalPages);
    sanctionCurrentPage = currentPage;

    const startIndex = (currentPage - 1) * sanctionRowsPerPage;
    const pageData = filtered.slice(startIndex, startIndex + sanctionRowsPerPage);

    // --- Render Table ---
    const table = document.getElementById("sanctionTable");
    table.innerHTML = "";

    if (!pageData.length) {
      table.innerHTML = `<tr><td colspan="9">No sanctions found for this event and filter combination.</td></tr>`;
    } else {
      for (const sanction of pageData) {
        const student = sanction.student_info || {};
        const formattedDate = sanction.date_given
          ? new Date(sanction.date_given + "T00:00:00").toLocaleDateString("en-PH", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          })
          : "-";

        const row = `
          <tr>
            <td>${student.name || "-"}</td>
            <td>${student.year_level || "-"}</td>
            <td>${student.section || "-"}</td>
            <td>${sanction.event_name || "-"}</td>
            <td>${sanction.penalty || "-"}</td>
            <td>₱${Number(sanction.fee || 0).toLocaleString()}</td>
            <td>${formattedDate}</td>
            <td><span class="status-badge ${sanction.status}">${sanction.status.toUpperCase()}</span></td>
            <td>
              <button class="btn btn-success"
                onclick="confirmResolve(${sanction.id})"
                ${sanction.status === "resolved" ? "disabled style='opacity:0.5;cursor:not-allowed;'" : ""}>
                Paid
              </button>
            </td>
          </tr>`;
        table.innerHTML += row;
      }
    }

    // --- Update pagination counters ---
    document.getElementById("sanctionTotalRecords").textContent = totalRecords;
    document.getElementById("sanctionCurrentPage").textContent = currentPage;
    document.getElementById("sanctionTotalPages").textContent = totalPages;

    // --- Update stat cards (no changes below) ---
    const resolvedSanctions = filtered.filter((s) => s.status === "resolved");
    const unresolvedSanctions = filtered.filter((s) => s.status !== "resolved");
    const absentSanctions = filtered.filter((s) => s.penalty?.toLowerCase() === "absent");
    const lateSanctions = filtered.filter((s) => s.penalty?.toLowerCase() === "late");


    const totalStudents = filtered.length;
    const resolvedStudents = resolvedSanctions.length;
    const noOfAbsent = absentSanctions.length;
    const noOfLate = lateSanctions.length;

    const totalFee = filtered.reduce((sum, s) => sum + (Number(s.fee) || 0), 0);
    const resolvedFee = resolvedSanctions.reduce((sum, s) => sum + (Number(s.fee) || 0), 0);
    const unresolvedFee = unresolvedSanctions.reduce((sum, s) => sum + (Number(s.fee) || 0), 0);

    document.getElementById("totalSanctionStudents").textContent = totalStudents;
    document.getElementById("resolvedSanctionStudents").textContent = resolvedStudents;
    document.getElementById("noOfLate").textContent = noOfLate;
    document.getElementById("noOfAbsent").textContent = noOfAbsent;

    document.getElementById("totalSanctionFee").textContent = `₱${totalFee.toLocaleString()}`;
    document.getElementById("unresolvedFee").textContent = `₱${unresolvedFee.toLocaleString()}`;
    document.getElementById("resolvedFee").textContent = `₱${resolvedFee.toLocaleString()}`;

  } catch (err) {
    console.error("❌ fetchSanctions failed:", err);
    const table = document.getElementById("sanctionTable");
    if (table)
      table.innerHTML = `<tr><td colspan="9">⚠️ Error loading sanctions. Check console.</td></tr>`;

    if (!navigator.onLine) enqueueRetry(() => fetchSanctions(page));
  } finally {
    if (loader) loader.classList.remove("active");
  }
}


// ✅ Pagination helper
function changeSanctionPage(direction) {
  const totalPages = parseInt(document.getElementById("sanctionTotalPages").textContent);
  let newPage = sanctionCurrentPage + direction;

  if (newPage < 1) newPage = 1;
  if (newPage > totalPages) newPage = totalPages;

  fetchSanctions(newPage);
}


async function loadYearLevelsForSanctions() {
  try {
    const { data, error } = await supabaseClient
      .from("student_info")
      .select("year_level")
      .not("year_level", "is", null);

    if (error) throw error;

    const filter = document.getElementById("sanctionYearFilter");
    if (!filter) return;

    const uniqueYears = [...new Set(data.map(s => s.year_level).filter(Boolean))].sort();
    filter.innerHTML = `<option value="">All Year Levels</option>`;
    uniqueYears.forEach(y => {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = y;
      filter.appendChild(opt);
    });
  } catch (err) {
    console.error("❌ Error loading year levels for sanctions:", err);
  }
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
function confirmResolve(id) {
  if (confirm("⚠️ Are you sure you want to mark this sanction as PAID?")) {
    resolveSanction(id);
    alert("✅ Sanction marked as resolved.");
  }
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

  // ✅ Insert sanction if late
  if (status === "late") {
    const { error: sanctionErr } = await supabaseClient.from("sanctions").insert({
      idstudent_info: student.idstudent_info, // <-- NEW FK column
      student_id: student.student_id,        // <-- keep school ID for display
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


  alert(`Attendance marked: ${penalty}`);
}



// -------------------- INIT --------------------
document.addEventListener("DOMContentLoaded", async () => {
  const pageLoader = document.getElementById("pageLoader");
  if (pageLoader) pageLoader.classList.remove("hidden");

  const isAuthenticated = await checkAuthAndInit();
  if (!isAuthenticated) {
    if (pageLoader) pageLoader.classList.add("hidden");
    return;
  }

  await new Promise(requestAnimationFrame);
  await loadAdminInfo();

  await updateAllEvents();

  autoFixMissingAbsentees().catch(err => {
    console.error("Auto-fix encountered an error:", err);
  });

  // Fetch everything in parallel for speed
  await Promise.all([
    loadStudents(),
    loadEvents(),
    populateAttendanceFilters(),
    populateAttendanceYearFilter(),
    fetchSanctions(),
    loadSections(),
    loadYearLevelsForSanctions(),
    loadTeamsForStudents(),
    loadSectionsForSanctions(),      // ✅ ADD THIS
    loadTeamsForSanctions(),          // ✅ ADD THIS
    loadSanctionEventFilter(),        // ✅ ADD THIS
    loadDashboardEvents(),            // ✅ ADD THIS (for dashboard)
    loadYearLevels(),
  ]);

  if (pageLoader) pageLoader.classList.add("hidden");
});



// Debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Get the appropriate loader based on active section
function getActiveLoader() {
  const activeSection = document.querySelector(".content-section.active");
  if (!activeSection) return null;

  const sectionId = activeSection.id;
  const loaderMap = {
    'students': 'studentsLoading',
    'events': 'eventsLoading',
    'attendance': 'attendanceLoading',
    'sanctions': 'sanctionLoading',
    'dashboard': 'dashboardLoading'
  };

  const loaderId = loaderMap[sectionId];
  return loaderId ? document.getElementById(loaderId) : null;
}

// Search function with loading overlay
async function performSearch(query) {
  const activeSection = document.querySelector(".content-section.active");
  if (!activeSection) return;

  const loader = getActiveLoader();
  const table = activeSection.querySelector("table tbody");

  if (!table) return;

  // Show loader
  if (loader) {
    loader.classList.add("active");
    await new Promise(requestAnimationFrame);
  }

  try {
    // Small delay to make loading visible (optional, adjust as needed)
    await new Promise(resolve => setTimeout(resolve, 200));

    // Perform search
    const queryLower = query.toLowerCase();
    Array.from(table.getElementsByTagName("tr")).forEach((row) => {
      const text = row.innerText.toLowerCase();
      row.style.display = text.includes(queryLower) ? "" : "none";
    });
  } finally {
    // Always hide loader
    if (loader) {
      loader.classList.remove("active");
    }
  }
}

// Debounced search (300ms delay)
const debouncedSearch = debounce(performSearch, 300);

// Search input listener
document.getElementById("searchInput").addEventListener("input", function () {
  const query = this.value.toLowerCase();
  debouncedSearch(query);
});



let sanctionAccessGranted = false;

// Update your nav-link click handler
document.querySelectorAll(".nav-link").forEach(link => {
  link.addEventListener("click", async (e) => {
    const section = link.dataset.section;

    // Check if trying to access sanctions
    if (section === "sanctions" && !sanctionAccessGranted) {
      e.preventDefault(); // Prevent navigation
      openModal("sanctionPasswordModal");
      document.getElementById("sanctionPasswordInput").focus();
      return;
    }

    // Normal navigation for other sections or if access already granted
    document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
    link.classList.add("active");

    document.querySelectorAll(".content-section").forEach(s => s.classList.remove("active"));
    document.getElementById(section).classList.add("active");

    // Update page title
    const titles = {
      dashboard: "Dashboard",
      attendance: "Attendance",
      students: "Students",
      events: "Events",
      sanctions: "Sanctions"
    };
    document.getElementById("pageTitle").textContent = titles[section] || "Dashboard";

    // Reset search
    const searchInput = document.getElementById("searchInput");
    searchInput.value = "";
    const activeSection = document.querySelector(".content-section.active");
    if (activeSection) {
      const table = activeSection.querySelector("table tbody");
      if (table) {
        Array.from(table.getElementsByTagName("tr")).forEach(row => {
          row.style.display = "";
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

// ✅ Fetch student name by ID
async function fetchStudentName() {
  const studentId = document.getElementById("attendanceStudentId").value.trim();
  if (!studentId) {
    alert("Enter Student ID first!");
    return;
  }

  const { data: student, error } = await supabaseClient
    .from("student_info")
    .select("idstudent_info, name")
    .eq("student_id", studentId)
    .single();

  if (error || !student) {
    alert("❌ Student not found!");
    document.getElementById("attendanceStudentName").value = "";
    return;
  }

  document.getElementById("attendanceStudentName").value = student.name;
  document.getElementById("attendanceStudentId").dataset.internalId = student.idstudent_info;
}

async function addManualAttendance() {
  const studentIdInput = document.getElementById("attendanceStudentId");
  const studentInternalId = studentIdInput.dataset.internalId; // fetched when clicking Find
  const studentId = studentIdInput.value.trim();
  const studentName = document.getElementById("attendanceStudentName").value;

  const eventSelect = document.getElementById("attendanceEvent");
  const eventId = eventSelect.value; // foreign key for attendance
  const eventName = eventSelect.options[eventSelect.selectedIndex].text; // use text for sanctions

  const status = document.getElementById("attendanceStatus").value;
  const time = document.getElementById("attendanceTime").value;
  const dateGiven = document.getElementById("attendanceDate").value;

  // Validate fields
  if (!studentInternalId || !studentId || !studentName || !eventId || !status || !time || !dateGiven) {
    alert("⚠️ Please fill in all fields and fetch student name.");
    return;
  }

  // Validate allowed statuses (match attendance table constraints)
  const allowedStatuses = ['present', 'absent', 'late', 'excused'];
  if (!allowedStatuses.includes(status)) {
    alert(`⚠️ Status must be one of: ${allowedStatuses.join(', ')}`);
    return;
  }

  // Prevent duplicate attendance for the same event
  const { data: existing } = await supabaseClient
    .from("attendance")
    .select("idattendance")
    .eq("student_id", studentInternalId)
    .eq("event_id", Number(eventId))
    .maybeSingle();

  if (existing) {
    alert(`⚠️ ${studentName} already has attendance for this event.`);
    return;
  }

  const { error: insertErr } = await supabaseClient.from("attendance").insert({
    student_id: studentInternalId,
    event_id: Number(eventId),
    status: status,
    scan_time: `${time}:00`,
    date: dateGiven,
    // NEW cached fields
    student_name_cached: studentName,
    student_school_id_cached: studentId
  });


  if (insertErr) {
    console.error("❌ Error inserting attendance:", insertErr);
    alert("Failed to record attendance.");
    return;
  }

  // Insert sanction if late or absent
  if (status === "late" || status === "absent") {
    let fee = 0;
    let penalty = "";

    if (status === "late") {
      fee = 500;
      penalty = "Late";
    } else if (status === "absent") {
      fee = 1500;
      penalty = "Absent";
    }

    const { error: sanctionErr } = await supabaseClient.from("sanctions").insert({
      idstudent_info: studentInternalId,
      student_id: studentId,
      student_name: studentName,
      event_name: eventName, // use combo box text
      penalty: penalty,
      fee: fee,
      date_given: dateGiven,
      status: "pending",
    });

    if (sanctionErr) {
      console.error("❌ Error inserting sanction:", sanctionErr);
      alert("Attendance recorded, but failed to record sanction.");
      return;
    }
  }

  alert(`✅ Attendance recorded for ${studentName}`);
  closeModal("manualAttendanceModal");
  document.getElementById("manualAttendanceForm").reset();
  delete studentIdInput.dataset.internalId;
  filterAttendance(attendanceCurrentPage); // ✅ Use filterAttendance instead

}






// ✅ Init when page loads
document.addEventListener("DOMContentLoaded", () => {
  loadManualEventOptions(); // fill dropdown
});

// ================= Dashboard Logic =================

// Populate event dropdown for dashboard
async function loadDashboardEvents() {
  const { data: events, error } = await supabaseClient
    .from("event_info")
    .select("idevent_info, event_name, status")
    .order("date", { ascending: false });

  const filter = document.getElementById("dashboardEventFilter");
  filter.innerHTML = `<option value="">Select Event</option>`;

  if (error) {
    console.error("❌ Error fetching events for dashboard:", error);
    return;
  }

  events.forEach((event) => {
    const opt = document.createElement("option");
    opt.value = event.idevent_info;
    opt.textContent = `${event.event_name} (${event.status})`;
    filter.appendChild(opt);
  });
}

// Handle dashboard event change
document.getElementById("dashboardEventFilter").addEventListener("change", async (e) => {
  const eventId = e.target.value;
  if (!eventId) {
    resetDashboard();
    return;
  }
  await loadDashboardStats(eventId);
  await loadRecentActivity(eventId);
});

// Reset stats when no event selected
function resetDashboard() {
  document.getElementById("statTotalStudents").textContent = "0";
  document.getElementById("activeEventsInfo").textContent = "Ongoing: 0 | Upcoming: 0";
  document.getElementById("statAttendance").textContent = "0";
  document.getElementById("lateAbsentInfo").textContent = "Late: 0 | Absent: 0";
  document.getElementById("recentActivityTable").innerHTML =
    `<tr><td colspan="4">Select an event to view activity...</td></tr>`;
}


// Load stats for selected event

async function loadDashboardStats(eventId) {
  const loader = document.getElementById("dashboardLoading");

  // Show loader immediately and let browser repaint
  if (loader) {
    loader.classList.add("active");
    await new Promise(requestAnimationFrame);
  }

  try {
    // ✅ Total Students (server-side count)
    const { count: totalStudents } = await supabaseClient
      .from("student_info")
      .select("*", { count: "exact", head: true });

    document.getElementById("statTotalStudents").textContent = totalStudents ?? 0;

    // ✅ Active Events (ongoing + upcoming, not closed)
    const { data: events, error: eventsError } = await supabaseClient
      .from("event_info")
      .select("status, closed");

    if (eventsError) {
      console.error("Error fetching events for dashboard stats:", eventsError);
    } else {
      const ongoing = events.filter(
        (ev) => ev.status?.toLowerCase() === "ongoing" && ev.closed === false
      ).length;
      const upcoming = events.filter(
        (ev) => ev.status?.toLowerCase() === "upcoming" && ev.closed === false
      ).length;

      document.getElementById("activeEventsInfo").textContent =
        `Ongoing: ${ongoing} | Upcoming: ${upcoming}`;
    }

    // ✅ Attendance stats for this event (use COUNT instead of fetching 1000 rows)
    const { count: presentCount } = await supabaseClient
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("status", "present");

    const { count: lateCount } = await supabaseClient
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("status", "late");

    const { count: absentCount } = await supabaseClient
      .from("attendance")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("status", "absent");

    // ✅ Update dashboard UI
    document.getElementById("statAttendance").textContent =
      (presentCount ?? 0) + (lateCount ?? 0);

    document.getElementById("lateAbsentInfo").textContent =
      `Late: ${lateCount ?? 0} | Absent: ${absentCount ?? 0}`;

  } catch (err) {
    console.error("❌ loadDashboardStats failed:", err);
  } finally {
    if (loader) loader.classList.remove("active");
  }
}


async function updateEventStats() {
  const { data: events, error } = await supabaseClient
    .from("event_info")
    .select("idevent_info, status, closed");

  if (error) {
    console.error("❌ Error fetching event stats:", error);
    return;
  }

  // Total events
  const totalEvents = events.length;

  // Convert all status values to lowercase to avoid mismatch
  const ongoing = events.filter(ev => ev.status?.toLowerCase() === "ongoing" && ev.closed === false).length;
  const upcoming = events.filter(ev => ev.status?.toLowerCase() === "upcoming" && ev.closed === false).length;

  // Active = ongoing + upcoming
  const activeEvents = ongoing + upcoming;

  // Update Total Events card
  document.getElementById("totalEvents").textContent = totalEvents;
  document.getElementById("totalEventsInfo").textContent = `All recorded events`;

  // Update Active Events card
  document.getElementById("activeEvents").textContent = activeEvents;
  document.getElementById("activeEventsInfo").textContent = `Ongoing: ${ongoing} | Upcoming: ${upcoming}`;
}

let attendanceCurrentPage = 1;
const attendanceRowsPerPage = 100;



function changeAttendancePage(direction) {
  const totalPages = parseInt(document.getElementById("attendanceTotalPages").textContent);
  let newPage = attendanceCurrentPage + direction;

  if (newPage < 1) newPage = 1;
  if (newPage > totalPages) newPage = totalPages;

  const yearLevel = document.getElementById("attendanceYearFilter")?.value || "";
  const section = document.getElementById("sectionFilter")?.value || "";
  const team = document.getElementById("teamFilter")?.value || "";
  const searchValue = document.getElementById("searchInput")?.value?.trim().toLowerCase() || "";

  filterAttendance(newPage, yearLevel, section, team, searchValue);
}




async function exportAttendanceCSV() {
  const eventId = document.getElementById("eventFilter")?.value || "";
  const section = document.getElementById("sectionFilter")?.value || "";
  const teamId = document.getElementById("teamFilter")?.value || "";
  const yearLevel = document.getElementById("attendanceYearFilter")?.value || "";

  try {
    if (!eventId) {
      alert("⚠️ Please select an event first.");
      return;
    }

    // ✅ Get readable names for filename
    const eventSelect = document.getElementById("eventFilter");
    const eventName =
      eventSelect && eventSelect.selectedIndex > 0
        ? eventSelect.options[eventSelect.selectedIndex].text
        : "Selected Event";

    const teamSelect = document.getElementById("teamFilter");
    const teamName =
      teamSelect && teamSelect.selectedIndex > 0
        ? teamSelect.options[teamSelect.selectedIndex].text
        : "";

    // ✅ Fetch ALL attendance data in batches (bypasses 1000 limit)
    let allData = [];
    let from = 0;
    const batchSize = 1000;

    while (true) {
      const { data, error } = await supabaseClient
        .from("attendance")
        .select(`
          idattendance,
          scan_time,
          status,
          student_info (
            student_id,
            name,
            year_level,
            section,
            team_id,
            teams (team_name)
          ),
          event_info (event_name)
        `)
        .eq("event_id", eventId)
        .order("scan_time", { ascending: true })
        .range(from, from + batchSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      allData.push(...data);
      if (data.length < batchSize) break;
      from += batchSize;
    }

    if (allData.length === 0) {
      alert("❌ No attendance records found.");
      return;
    }

    console.log(`✅ Loaded ${allData.length} total attendance records`);

    // ✅ Apply client-side filters
    let filtered = allData;

    if (yearLevel) {
      filtered = filtered.filter(
        att => String(att.student_info?.year_level) === String(yearLevel)
      );
    }

    if (section) {
      filtered = filtered.filter(
        att => String(att.student_info?.section) === String(section)
      );
    }

    if (teamId) {
      filtered = filtered.filter(
        att => String(att.student_info?.team_id) === String(teamId)
      );
    }

    if (!filtered.length) {
      alert("❌ No attendance data for selected filters.");
      return;
    }

    // ✅ Sort alphabetically by student name
    filtered.sort((a, b) =>
      (a.student_info?.name || "").localeCompare(b.student_info?.name || "")
    );

    // ✅ Build CSV header
    let csv = "Student ID,Name,Year Level,Section,Team,Event,Time,Status\n";

    // ✅ Add CSV rows
    filtered.forEach(row => {
      const student = row.student_info || {};
      const team = student.teams?.team_name ?? "-";
      let formattedTime = row.scan_time || "-";

      if (row.scan_time && row.scan_time.includes(":")) {
        const [hours, minutes] = row.scan_time.split(":");
        let h = parseInt(hours, 10);
        const ampm = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        formattedTime = `${h}:${minutes} ${ampm}`;
      }

      csv += `"${student.student_id ?? "-"}",` +
        `"${student.name ?? "-"}",` +
        `"${student.year_level ?? "-"}",` +
        `"${student.section ?? "-"}",` +
        `"${team}",` +
        `"${row.event_info?.event_name ?? "-"}",` +
        `"${formattedTime}",` +
        `"${row.status ?? "-"}"\n`;
    });

    // ✅ Build filename with Year Level, Team Name, Section, and Date
    const dateStr = new Date().toISOString().split("T")[0];
    let fileName = "Attendance";
    fileName += eventName ? `-${eventName}` : "-AllEvents";
    fileName += yearLevel ? `-${yearLevel}` : "-AllYears";
    fileName += teamName ? `-${teamName}` : "-AllTeams";
    fileName += section ? `-Section${section}` : "-AllSections";
    fileName += `-${dateStr}`;

    // ✅ Create downloadable CSV with UTF-8 BOM (for ñ, é, ü)
    const bom = "\uFEFF";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log(`✅ Exported ${filtered.length} records to ${fileName}.csv`);

  } catch (err) {
    console.error("❌ Failed to export attendance CSV:", err);
    alert("❌ Failed to export attendance.");
  }
}




// ✅ Load recent attendance activity for a selected event
async function loadRecentActivity(eventId) {
  const loader = document.getElementById("dashboardLoading");
  const table = document.getElementById("recentActivityTable");
  const title = document.getElementById("recentActivityTitle");

  if (loader) {
    loader.classList.add("active");
    await new Promise(requestAnimationFrame);
  }

  if (!eventId) {
    table.innerHTML = `<tr><td colspan="6">Select an event to view activity...</td></tr>`;
    title.textContent = "Recent Activity"; // ✅ Default title
    if (loader) loader.classList.remove("active");
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from("attendance")
      .select(`
        idattendance,
        date,
        scan_time,
        status,
        student_info (
          name,
          year_level,
          section
        )
      `)
      .eq("event_id", eventId)
      .order("date", { ascending: false })
      .order("scan_time", { ascending: false })
      .limit(20);

    if (error) {
      console.error("❌ Error loading recent activity:", error);
      table.innerHTML = `<tr><td colspan="6">Error loading data</td></tr>`;
      title.textContent = "Recent Activity";
      return;
    }

    // ✅ Update title when event is selected
    title.textContent = "Recent Activity: Latest 20 Scans";

    table.innerHTML = "";

    if (data.length === 0) {
      table.innerHTML = `<tr><td colspan="6">No attendance records found for this event.</td></tr>`;
      return;
    }

    data.forEach((att) => {
      let formattedTime = att.scan_time;
      if (formattedTime) {
        const [hours, minutes] = att.scan_time.split(":");
        let h = parseInt(hours, 10);
        const ampm = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        formattedTime = `${h}:${minutes} ${ampm}`;
      }

      const row = `
        <tr>
          <td>${att.date}</td>
          <td>${formattedTime}</td>
          <td>${att.student_info?.name || "Unknown"}</td>
          <td>${att.student_info?.year_level || "-"}</td>
          <td>${att.student_info?.section || "-"}</td>
          <td><span class="status-badge ${att.status}">${att.status}</span></td>
        </tr>
      `;
      table.innerHTML += row;
    });
  } catch (err) {
    console.error("❌ loadRecentActivity failed:", err);
    table.innerHTML = `<tr><td colspan="6">Error loading data</td></tr>`;
    title.textContent = "Recent Activity";
  } finally {
    if (loader) loader.classList.remove("active");
  }
}






// 🔹 Load sections into Sanctions filter
async function loadSectionsForSanctions() {
  try {
    const { data, error } = await supabaseClient
      .from("student_info")
      .select("section")
      .not("section", "is", null);

    if (error) throw error;

    const sectionFilter = document.getElementById("sanctionSectionFilter");
    if (!sectionFilter) return;

    const uniqueSections = [...new Set(data.map(s => s.section).filter(Boolean))].sort();
    sectionFilter.innerHTML = `<option value="">All Sections</option>`;
    uniqueSections.forEach(sec => {
      const opt = document.createElement("option");
      opt.value = sec;
      opt.textContent = sec;
      sectionFilter.appendChild(opt);
    });
  } catch (err) {
    console.error("❌ Error loading sections for sanctions:", err);
  }
}

// 🔹 Load teams into Sanctions filter
async function loadTeamsForSanctions() {
  try {
    const { data, error } = await supabaseClient
      .from("teams")
      .select("idteam, team_name")
      .order("team_name", { ascending: true });

    if (error) throw error;

    const teamFilter = document.getElementById("sanctionTeamFilter");
    if (!teamFilter) return;

    teamFilter.innerHTML = `<option value="">All Teams</option>`;
    data.forEach(team => {
      const opt = document.createElement("option");
      opt.value = team.idteam;
      opt.textContent = team.team_name;
      teamFilter.appendChild(opt);
    });
  } catch (err) {
    console.error("❌ Error loading teams for sanctions:", err);
  }
}


async function loadSanctionEventFilter() {
  try {
    const { data, error } = await supabaseClient
      .from("event_info")
      .select("event_name")
      .order("event_name", { ascending: true });

    if (error) throw error;

    const eventFilter = document.getElementById("sanctionEventFilter");
    if (!eventFilter) return;

    eventFilter.innerHTML = `<option value="">Select Event</option>`;
    data.forEach(ev => {
      const opt = document.createElement("option");
      opt.value = ev.event_name;
      opt.textContent = ev.event_name;
      eventFilter.appendChild(opt);
    });
  } catch (err) {
    console.error("❌ Error loading sanction events:", err);
  }
}


function renderStudentTable(data) {
  const table = document.getElementById("studentsTable");
  if (!table) return;
  table.innerHTML = "";

  if (!data || data.length === 0) {
    table.innerHTML = `<tr><td colspan="8">No students found</td></tr>`;
    return;
  }

  data.forEach(student => {
    const row = `
      <tr>
      <td>${student.student_id}</td>
        <td>${student.name}</td>
        <td>${student.year_level}</td>
        <td>${student.section}</td>
        <td>
          <div class="password-cell">
            <span class="masked-password" data-password="${student.password || ''}">••••••••</span>
            <button type="button" class="password-toggle-btn" onclick="togglePasswordRow(this)">
              <i class="fas fa-eye"></i>
            </button>
          </div>
        </td>
        <td>${student.teams ? student.teams.team_name : "-"}</td>
        
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

async function loadSections() {
  const { data, error } = await supabaseClient
    .from("student_info")
    .select("section");

  if (error) {
    console.error("❌ Error loading sections:", error);
    return;
  }

  const sectionFilter = document.getElementById("studentSectionFilter");
  if (!sectionFilter) {
    console.warn("⚠️ studentSectionFilter not found.");
    return;
  }

  const uniqueSections = [...new Set(data.map(s => s.section).filter(Boolean))].sort();
  console.log("✅ Loaded Sections:", uniqueSections);

  sectionFilter.innerHTML = `<option value="">All Sections</option>`;
  uniqueSections.forEach(sec => {
    const opt = document.createElement("option");
    opt.value = sec;
    opt.textContent = sec;
    sectionFilter.appendChild(opt);
  });
}


// ✅ Load Teams Dropdown
async function loadTeamsForStudents() {
  try {
    // ✅ Fetch both ID and name so we can use ID for filtering
    const { data, error } = await supabaseClient
      .from("teams")
      .select("idteam, team_name")
      .order("team_name", { ascending: true });

    if (error) throw error;

    const teamFilter = document.getElementById("studentTeamFilter");
    if (!teamFilter) {
      console.warn("⚠️ studentTeamFilter not found.");
      return;
    }

    // ✅ Clear and re-add default option
    teamFilter.innerHTML = `<option value="">All Teams</option>`;

    // ✅ Add each team as <option value="idteam">Team Name</option>
    data.forEach(team => {
      const opt = document.createElement("option");
      opt.value = team.idteam;              // use ID for filtering
      opt.textContent = team.team_name;     // display team name
      teamFilter.appendChild(opt);
    });

    console.log("✅ Loaded Teams:", data.map(t => t.team_name));
  } catch (error) {
    console.error("❌ Error loading teams:", error);
  }
}



// ✅ Populate Section and Team filters for Attendance panel
async function populateAttendanceFilters() {
  // Load sections
  const { data: students, error: sectErr } = await supabaseClient
    .from("student_info")
    .select("section");

  if (!sectErr && students) {
    const sectionFilter = document.getElementById("sectionFilter");
    if (sectionFilter) {
      const uniqueSections = [...new Set(students.map(s => s.section).filter(Boolean))].sort();
      sectionFilter.innerHTML = `<option value="">All Sections</option>`;
      uniqueSections.forEach(sec => {
        sectionFilter.innerHTML += `<option value="${sec}">${sec}</option>`;
      });
    }
  }

  // Load teams
  const { data: teams, error: teamErr } = await supabaseClient
    .from("teams")
    .select("idteam, team_name")
    .order("team_name", { ascending: true });

  if (!teamErr && teams) {
    const teamFilter = document.getElementById("teamFilter");
    if (teamFilter) {
      teamFilter.innerHTML = `<option value="">All Teams</option>`;
      teams.forEach(team => {
        teamFilter.innerHTML += `<option value="${team.idteam}">${team.team_name}</option>`;
      });
    }
  }
}


async function populateAttendanceYearFilter() {
  try {
    const { data, error } = await supabaseClient
      .from("student_info")
      .select("year_level")
      .not("year_level", "is", null);

    if (error) throw error;

    const dropdown = document.getElementById("attendanceYearFilter");
    if (!dropdown) return;

    const uniqueYears = [...new Set(data.map(s => s.year_level))].sort();
    dropdown.innerHTML = `<option value="">All Year Levels</option>`;
    uniqueYears.forEach(y => {
      dropdown.innerHTML += `<option value="${y}">${y}</option>`;
    });
  } catch (err) {
    console.error("⚠️ Failed to populate year levels:", err);
  }
}

// Verify sanction password (using admin_info table)
async function verifySanctionPassword(event) {
  event.preventDefault();

  const passwordInput = document.getElementById("sanctionPasswordInput");
  const errorDiv = document.getElementById("sanctionPasswordError");
  const enteredPassword = passwordInput.value.trim();

  try {
    // ✅ Get current logged-in admin session
    const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !session) {
      alert("⚠️ Session expired. Please log in again.");
      window.location.href = "index.html";
      return;
    }

    // ✅ Fetch the admin's stored password and username
    const { data: admin, error: adminError } = await supabaseClient
      .from("admin_info")
      .select("admin_username, password")
      .eq("auth_id", session.user.id)
      .single();

    if (adminError || !admin) {
      alert("❌ Admin record not found.");
      return;
    }

    // ✅ Compare entered password with stored admin password
    if (enteredPassword === admin.password) {
      // Log successful access
      await logSanctionAccess(session.user.id, admin.admin_username, "granted");

      sanctionAccessGranted = true;
      closeModal("sanctionPasswordModal");
      passwordInput.value = "";
      errorDiv.style.display = "none";

      // Show the Sanctions section
      document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
      document.querySelector('[data-section="sanctions"]').classList.add("active");

      document.querySelectorAll(".content-section").forEach(s => s.classList.remove("active"));
      document.getElementById("sanctions").classList.add("active");

      document.getElementById("pageTitle").textContent = "Sanctions";

      // Load sanctions data
      fetchSanctions();
    } else {
      // Log failed access
      await logSanctionAccess(session.user.id, admin.admin_username, "denied");

      errorDiv.style.display = "block";
      passwordInput.value = "";
      passwordInput.focus();
    }
  } catch (err) {
    console.error("Error verifying sanction password:", err);
    alert("⚠️ An unexpected error occurred. Please try again.");
  }
}


// Cancel sanction access
function cancelSanctionAccess() {
  closeModal("sanctionPasswordModal");
  document.getElementById("sanctionPasswordInput").value = "";
  document.getElementById("sanctionPasswordError").style.display = "none";

  // Stay on current section or go to dashboard
  const currentActive = document.querySelector(".nav-link.active");
  if (!currentActive || currentActive.dataset.section === "sanctions") {
    document.querySelector('[data-section="dashboard"]').click();
  }
}

// Log sanction access attempts

// Log sanction access attempts
async function logSanctionAccess(adminId, adminUsername, status) {
  try {
    const { error } = await supabaseClient
      .from('sanction_access_logs')
      .insert({
        admin_id: adminId,
        admin_username: adminUsername,
        // Remove access_time - let database default handle it
        status: status,
        ip_address: null // Can add IP detection if needed
      });

    if (error) {
      console.error("Failed to log sanction access:", error);
    } else {
      console.log(`Sanction access ${status} for ${adminUsername}`);
    }
  } catch (err) {
    console.error("Error logging sanction access:", err);
  }
}

// Reset sanction access on logout
async function logout() {
  const confirmLogout = confirm("Are you sure you want to log out?");
  if (!confirmLogout) return;

  try {
    sanctionAccessGranted = false; // Reset access flag

    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      console.error("Logout failed:", error);
      alert("Failed to log out.");
      return;
    }

    window.location.href = "index.html";
  } catch (err) {
    console.error("Unexpected error during logout:", err);
    alert("Something went wrong while logging out.");
  }
}


document.getElementById("searchInput").addEventListener("input", () => {
  const currentPage = document.getElementById("pageTitle")?.textContent.trim().toLowerCase();

  if (currentPage === "students") {
    filterStudents(1); // Reset to page 1 when searching
  } else if (currentPage === "attendance") {
    filterAttendance(1); // Reset to page 1 when searching
  } else if (currentPage === "sanctions") {
    fetchSanctions(1); // ✅ Refresh sanctions immediately as you type
  }
});



function switchPage(newPageTitle) {
  document.getElementById("pageTitle").textContent = newPageTitle;
  document.getElementById("searchInput").value = ""; // clear search input
}

async function loadYearLevels() {
  try {
    const { data, error } = await supabaseClient
      .from("student_info")
      .select("year_level", { count: "exact" });

    if (error) throw error;

    // Get unique year levels (filter out nulls)
    const uniqueYears = [...new Set(data.map((item) => item.year_level).filter(Boolean))].sort();

    const yearSelect = document.getElementById("studentYearFilter");
    yearSelect.innerHTML = `<option value="">All Year Levels</option>`;

    uniqueYears.forEach((year) => {
      yearSelect.innerHTML += `<option value="${year}">${year}</option>`;
    });
  } catch (err) {
    console.error("❌ Error loading year levels:", err);
  }
}

