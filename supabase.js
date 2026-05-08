// ✅ Supabase client initialization with session check
const SUPABASE_URL = "https://ofrngrggkgtfnfdlbmum.supabase.co";
const SUPABASE_PROJECT_REF = "ofrngrggkgtfnfdlbmum";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mcm5ncmdna2d0Zm5mZGxibXVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3ODYxOTYsImV4cCI6MjA3MjM2MjE5Nn0.qgYkiUmesBQCoSUkrLhMuCmO2IxDSahQUZPKHhUGjnE";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ✅ Global variable to track sanction access permission
let sanctionAccessGranted = false;
let pendingProtectedSection = "sanctions";
let selectedSuperManualStudent = null;
let superManualEventsCache = [];
let pendingSuperManualAttendanceUpdate = null;
let isRedirectingToLogin = false;
const FORCE_LOGOUT_VERSION_KEY = "force_logout_version";
const LOCAL_FORCE_LOGOUT_VERSION_KEY = "edutag_force_logout_version";
const filterOptionsCache = {
  events: null,
  studentMeta: null,
};

function invalidateFilterOptionsCache(options = {}) {
  const { events = false, students = false } = options;
  if (events) filterOptionsCache.events = null;
  if (students) filterOptionsCache.studentMeta = null;
}

async function getCachedEvents(force = false) {
  if (!force && filterOptionsCache.events) return filterOptionsCache.events;

  const { data, error } = await supabaseClient
    .from("event_info")
    .select("idevent_info, event_name, status, date, closed")
    .order("date", { ascending: false });

  if (error) throw error;
  filterOptionsCache.events = data || [];
  return filterOptionsCache.events;
}

async function getCachedStudentMeta(force = false) {
  if (!force && filterOptionsCache.studentMeta) return filterOptionsCache.studentMeta;

  const { data, error } = await supabaseClient
    .from("student_info")
    .select("year_level, section");

  if (error) throw error;

  filterOptionsCache.studentMeta = {
    years: [...new Set((data || []).map((row) => row.year_level).filter(Boolean))].sort(),
    sections: [...new Set((data || []).map((row) => row.section).filter(Boolean))].sort(),
  };
  return filterOptionsCache.studentMeta;
}

function populateSelectOptions(selectId, placeholder, values) {
  const dropdown = document.getElementById(selectId);
  if (!dropdown) return null;

  dropdown.innerHTML = `<option value="">${placeholder}</option>`;
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    dropdown.appendChild(option);
  });

  return dropdown;
}

function normalizeStudentRole(role) {
  return role === "officer" ? "officer" : "student";
}

function formatStudentRole(role) {
  return normalizeStudentRole(role) === "officer" ? "Officer" : "Student";
}

function clearSupabaseAuthStorage() {
  const prefix = `sb-${SUPABASE_PROJECT_REF}-`;

  Object.keys(localStorage)
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => localStorage.removeItem(key));
}

function isInvalidRefreshTokenError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("invalid refresh token") ||
    message.includes("refresh token not found")
  );
}

async function resetBrokenAuthSession(redirectMessage) {
  if (isRedirectingToLogin) return;
  isRedirectingToLogin = true;

  clearSupabaseAuthStorage();

  try {
    await supabaseClient.auth.signOut({ scope: "local" });
  } catch (signOutError) {
    console.warn("Failed to clear local Supabase session:", signOutError);
  }

  if (redirectMessage) {
    showNotification(redirectMessage, "warning");
  }

  setTimeout(() => {
    window.location.href = "index.html";
  }, 1200);
}

async function getValidAdminSession() {
  try {
    const { data, error } = await supabaseClient.auth.getSession();

    if (isInvalidRefreshTokenError(error)) {
      await resetBrokenAuthSession("Your session expired. Please sign in again.");
      return null;
    }

    return data?.session ?? null;
  } catch (error) {
    if (isInvalidRefreshTokenError(error)) {
      await resetBrokenAuthSession("Your session expired. Please sign in again.");
      return null;
    }

    throw error;
  }
}

async function getSystemSettingValue(key) {
  const { data, error } = await supabaseClient
    .from("system_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error) throw error;
  return data?.value ?? null;
}

async function enforceForceLogoutVersion(redirectMessage = "EduTag was updated. Please sign in again.") {
  try {
    const currentVersion = await getSystemSettingValue(FORCE_LOGOUT_VERSION_KEY);
    if (!currentVersion) return false;

    const savedVersion = localStorage.getItem(LOCAL_FORCE_LOGOUT_VERSION_KEY);
    const hasExistingLogin =
      Boolean(localStorage.getItem("studentId")) ||
      Object.keys(localStorage).some((key) => key.startsWith(`sb-${SUPABASE_PROJECT_REF}-`));

    if (savedVersion === currentVersion) return false;
    if (!savedVersion && !hasExistingLogin) {
      localStorage.setItem(LOCAL_FORCE_LOGOUT_VERSION_KEY, currentVersion);
      return false;
    }

    try {
      await supabaseClient.auth.signOut({ scope: "local" });
    } catch (signOutError) {
      console.warn("Force logout sign out failed:", signOutError);
    }

    localStorage.clear();
    localStorage.setItem(LOCAL_FORCE_LOGOUT_VERSION_KEY, currentVersion);
    await resetBrokenAuthSession(redirectMessage);
    return true;
  } catch (error) {
    console.warn("Force logout version check failed:", error);
    return false;
  }
}

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
      const localRecord = attendance.find(att => att.idattendance === upd.idattendance);
      if (localRecord) localRecord.status = upd.status;
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
      showNotification(`Attendance statuses updated for ${updates.length} record(s) based on new event times.`, "success");
    } else {
      console.log('[DEBUG] No attendance statuses needed updating.');
    }
  } catch (err) {
    console.error('[DEBUG] Error recalculating attendance statuses:', err);
  }
}



// ✅ Check authentication on page load

async function checkAuthAndInit() {
  const session = await getValidAdminSession();

  if (!session) {
    showNotification("⚠️ You are not logged in. Redirecting to login page.", "warning");
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
    showNotification("⚠️ Access denied. Admin account not found.", "error");
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
    const session = await getValidAdminSession();

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

const STUDENT_MAINTENANCE_KEY = "student_maintenance";
let studentMaintenanceEnabled = false;
let pendingStudentMaintenanceState = null;

function parseSettingBoolean(value) {
  return String(value || "").toLowerCase() === "true";
}

async function getStudentMaintenanceSetting() {
  const { data, error } = await supabaseClient
    .from("system_settings")
    .select("value")
    .eq("key", STUDENT_MAINTENANCE_KEY)
    .maybeSingle();

  if (error) throw error;
  return parseSettingBoolean(data?.value);
}

function updateStudentMaintenanceUI(isEnabled) {
  studentMaintenanceEnabled = isEnabled;

  const statusEl = document.getElementById("studentMaintenanceStatus");
  const toggleBtn = document.getElementById("studentMaintenanceToggleBtn");

  if (statusEl) {
    statusEl.textContent = isEnabled ? "Maintenance" : "Live";
    statusEl.classList.toggle("active", isEnabled);
    statusEl.classList.toggle("live", !isEnabled);
  }

  if (toggleBtn) {
    toggleBtn.disabled = false;
    toggleBtn.textContent = isEnabled ? "Disable" : "Enable";
    toggleBtn.classList.toggle("btn-danger", !isEnabled);
    toggleBtn.classList.toggle("btn-secondary", isEnabled);
  }
}

async function loadStudentMaintenanceStatus() {
  const toggleBtn = document.getElementById("studentMaintenanceToggleBtn");

  try {
    const isEnabled = await getStudentMaintenanceSetting();
    updateStudentMaintenanceUI(isEnabled);
  } catch (error) {
    console.error("Failed to load student maintenance setting:", error?.message || error);
    if (toggleBtn) {
      toggleBtn.disabled = true;
      toggleBtn.textContent = "Setup Needed";
    }
    showNotification("Maintenance setup needed: run maintenance_setup.sql in Supabase.", "warning");
  }
}

function openStudentMaintenanceModal() {
  pendingStudentMaintenanceState = !studentMaintenanceEnabled;

  const title = document.getElementById("studentMaintenanceModalTitle");
  const message = document.getElementById("studentMaintenanceModalMessage");
  const passwordInput = document.getElementById("studentMaintenancePasswordInput");
  const errorDiv = document.getElementById("studentMaintenancePasswordError");
  const confirmBtn = document.getElementById("studentMaintenanceConfirmBtn");

  if (title) {
    title.textContent = pendingStudentMaintenanceState
      ? "Enable Student Maintenance"
      : "Disable Student Maintenance";
  }

  if (message) {
    message.textContent = pendingStudentMaintenanceState
      ? "Students will be blocked from the portal and shown a maintenance notice. Admin access will stay open."
      : "Students will be allowed to use the portal again.";
  }

  if (confirmBtn) {
    confirmBtn.textContent = pendingStudentMaintenanceState ? "Enable Maintenance" : "Disable Maintenance";
  }

  if (passwordInput) {
    passwordInput.value = "";
    passwordInput.type = "password";
  }

  const icon = document.getElementById("studentMaintenancePasswordIcon");
  if (icon) {
    icon.classList.add("fa-eye");
    icon.classList.remove("fa-eye-slash");
  }

  if (errorDiv) errorDiv.style.display = "none";

  const modal = document.getElementById("studentMaintenanceModal");
  if (modal) {
    modal.style.display = "flex";
    setTimeout(() => passwordInput?.focus(), 50);
  }
}

function closeStudentMaintenanceModal() {
  const modal = document.getElementById("studentMaintenanceModal");
  if (modal) modal.style.display = "none";
  pendingStudentMaintenanceState = null;
}

async function confirmStudentMaintenanceToggle(event) {
  event.preventDefault();

  if (pendingStudentMaintenanceState === null) return;

  const passwordInput = document.getElementById("studentMaintenancePasswordInput");
  const errorDiv = document.getElementById("studentMaintenancePasswordError");
  const confirmBtn = document.getElementById("studentMaintenanceConfirmBtn");
  const enteredPassword = passwordInput?.value.trim();
  const targetState = pendingStudentMaintenanceState;

  if (!enteredPassword) return;

  try {
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Verifying...";
    }

    const session = await getValidAdminSession();
    const adminEmail = session?.user?.email;

    if (!adminEmail) {
      showNotification("Admin session expired. Please sign in again.", "warning");
      window.location.href = "index.html";
      return;
    }

    const { error: reAuthError } = await supabaseClient.auth.signInWithPassword({
      email: adminEmail,
      password: enteredPassword,
    });

    if (reAuthError) {
      if (errorDiv) errorDiv.style.display = "block";
      return;
    }

    const { error: saveError } = await supabaseClient
      .from("system_settings")
      .upsert({
        key: STUDENT_MAINTENANCE_KEY,
        value: String(targetState),
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });

    if (saveError) throw saveError;

    updateStudentMaintenanceUI(targetState);
    closeStudentMaintenanceModal();
    showNotification(
      targetState
        ? "Student portal maintenance is now enabled."
        : "Student portal maintenance is now disabled.",
      "success"
    );
  } catch (error) {
    console.error("Failed to update student maintenance mode:", error);
    showNotification("Could not update student maintenance mode.", "error");
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = targetState ? "Enable Maintenance" : "Disable Maintenance";
    }
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
  const role = document.getElementById("studentRoleFilter")?.value || "";
  const searchValue = document.getElementById("searchInput")?.value?.trim().toLowerCase() || "";

  // ✅ Pass all filters explicitly when paginating
  filterStudents(newPage, yearLevel, section, role, searchValue);
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
    const role = document.getElementById("attendanceRoleFilter")?.value || "";
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
          student_info (student_id, name, section, role, year_level),
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

    if (role) {
      filtered = filtered.filter(att => {
        const studentRole = normalizeStudentRole(att.student_info?.role);
        return studentRole === role;
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

    if (!pageData?.length) {
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
            <td>${escapeHTML(att.student_info.student_id ?? "")}</td>
            <td>${escapeHTML(att.student_info.name ?? "")}</td>
            <td>${escapeHTML(att.event_info?.event_name ?? "")}</td>
            <td>${formattedTime}</td>
            <td><span class="status-badge ${escapeHTML(att.status)}">${escapeHTML(att.status)}</span></td>
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
  const role = document.getElementById("studentRoleFilter")?.value || "";
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
        role
      `, { count: "exact" })
      .order("name", { ascending: true })
      .range(start, end);

    if (yearLevel) query = query.eq("year_level", yearLevel);
    if (section) query = query.eq("section", section);
    if (role) query = query.eq("role", role);
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
    span.innerText = span.dataset.password;
    icon.classList.remove("fa-eye");
    icon.classList.add("fa-eye-slash");
  } else {
    span.innerText = "••••••••";
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
  invalidateFilterOptionsCache({ students: true });
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
  const sanctionEventSelect = document.getElementById("sanctionEvent");
  const eventId = sanctionEventSelect?.value || "";
  const eventName = sanctionEventSelect?.selectedOptions?.[0]?.dataset?.eventName || "";
  const penalty = document.getElementById("sanctionPenalty").value;
  const fee = document.getElementById("sanctionFee").value;

  if (!studentId || !studentName || !eventId || !eventName || !penalty || !fee) {
    showNotification(" Please fill in all fields.", "warning");
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
        event_id: Number(eventId),
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
  try {
    const data = await getCachedEvents();
    const dropdown = document.getElementById("sanctionEvent");
    if (!dropdown) return;

    dropdown.innerHTML = `<option value="">Select Event</option>`;
    data.forEach(ev => {
      const option = document.createElement("option");
      option.value = ev.idevent_info;
      option.dataset.eventName = ev.event_name;
      option.textContent = `${ev.event_name} (${ev.status})`;
      dropdown.appendChild(option);
    });
  } catch (error) {
    console.error("Error loading events:", error);
  }
  return;

  const { data, error } = await supabaseClient
    .from("event_info")
    .select("idevent_info, event_name, status, date")
    .order("date", { ascending: false });

  if (error) {
    console.error("❌ Error loading events:", error);
    return;
  }

  const dropdown = document.getElementById("sanctionEvent");
  dropdown.innerHTML = `<option value="">Select Event</option>`;
  data.forEach(ev => {
    const option = document.createElement("option");
    option.value = ev.idevent_info;
    option.dataset.eventName = ev.event_name;
    option.textContent = `${ev.event_name} (${ev.status})`;
    dropdown.appendChild(option);
  });
}

async function addStudent() {
  const studentId = document.getElementById("studentId").value.trim();
  const studentName = document.getElementById("studentName").value.trim();
  const studentYear = document.getElementById("studentYear").value;
  const studentPassword = document.getElementById("studentPassword").value.trim();
  const studentRfid = document.getElementById("studentRfid").value.trim();
  const studentRole = normalizeStudentRole(document.getElementById("studentRole")?.value);
  const studentSection = document.getElementById("studentSection").value.trim();

  if (!studentId || !studentName || !studentPassword || !studentRfid || !studentYear || !studentSection || !studentRole) {
    showNotification("Please fill in all required fields.", "warning");
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
      role: studentRole,
      status: "active"
    }
  ]);

  if (error) {
    console.error("Error adding student:", error);
    showNotification("Error adding student. Check console for details.", "error");
    return;
  }

  showNotification("Student added successfully!", "success");
  invalidateFilterOptionsCache({ students: true });
  loadStudents();
  closeModal("addStudentModal");
  document.getElementById("addStudentForm").reset();
}




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
    const session = await getValidAdminSession();
    if (!session) {
      showNotification('⚠️ Session expired. Please log in again.', "error");
      window.location.href = 'index.html';
      return;
    }

    // ✅ Re-authenticate admin via Supabase Auth (no plain-text password fetch)
    const { error: reAuthError } = await supabaseClient.auth.signInWithPassword({
      email: session.user.email,
      password: enteredPassword,
    });

    if (!reAuthError) {
      // password verified — perform deletion
      closeModal('eventDeletePasswordModal');
      passwordInput.value = '';
      if (errorDiv) errorDiv.style.display = 'none';

      const idToDelete = pendingDeleteEventId;
      pendingDeleteEventId = null;
      if (idToDelete) await performDeleteEvent(idToDelete);
    } else {
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

      const session = await getValidAdminSession();
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

    // 2) delete sanctions which reference this event
    const { error: delSanErr } = await supabaseClient
      .from('sanctions')
      .delete()
      .eq('event_id', eventId);

    if (delSanErr) {
      console.error('Error deleting sanctions for event:', delSanErr);
      alert('❌ Failed to delete related sanctions. See console.');
      try { if (logId) await supabaseClient.from('event_deletion_logs').update({ status: 'failed' }).eq('id', logId); } catch (e) { console.warn('Failed to update deletion log status:', e); }
      return;
    }
    console.log('DEBUG: sanctions deleted for event id=', eventId);

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

    showNotification(' Event and related records deleted successfully!', "success");
    invalidateFilterOptionsCache({ events: true });
    loadEvents(); // refresh table
  } catch (err) {
    console.error('❌ Error deleting event and related data:', err);
    try { if (logId) await supabaseClient.from('event_deletion_logs').update({ status: 'failed' }).eq('id', logId); } catch (e) { console.warn('Failed to update deletion log status in catch:', e); }
    showNotification('Failed to delete event and/or related data. Check console for details.', "error");
  }
}


async function loadEvents() {
  const { data, error } = await supabaseClient
    .from("event_info")
    .select("idevent_info, event_name, date, time_start, time_end, late_until, status, closed")
    .order("date", { ascending: false });
  if (!error) filterOptionsCache.events = data || [];

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
    // ✅ Conditionally show buttons based on event status
    let actionButtons = '';
    if (event.status === 'completed') {
      // ✅ Completed events: finalize intentionally, or delete
      actionButtons = `
        <td>
          <button class="btn btn-primary" onclick="openFinalizeEventModal(${event.idevent_info})" title="Finalize event and mark missing students absent">
            <i class="fas fa-clipboard-check"></i>
          </button>
          <button class="btn btn-danger" onclick="deleteEvent(${event.idevent_info})">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      `;
    } else if (event.status === 'ongoing') {
      // ⚠️ Ongoing events: edit/delete with confirmation
      actionButtons = `
        <td>
          <button class="btn btn-secondary" onclick="editEventWithConfirm(${event.idevent_info})" title="Warning: Event is still ongoing!">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn btn-danger" onclick="deleteEvent(${event.idevent_info})" title="Warning: Event is still ongoing!">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      `;
    } else {
      // ✅ Upcoming events: normal edit/delete
      actionButtons = `
        <td>
          <button class="btn btn-secondary" onclick="editEvent(${event.idevent_info})">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn btn-danger" onclick="deleteEvent(${event.idevent_info})">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      `;
    }

    const row = `
      <tr>
      <td>${escapeHTML(event.date)}</td>
        <td>${escapeHTML(event.event_name)}</td>

        <td>${formatTimeTo12Hour(event.time_start)}</td>
        <td>${formatTimeTo12Hour(event.time_end)}</td>
        <td>${formatTimeTo12Hour(event.late_until)}</td>
        <td><span class="status-badge ${escapeHTML(event.status)}">${escapeHTML(event.status)}</span></td>
        ${actionButtons}
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

async function loadEventOptions(selectId, valueColumn = "idevent_info", includeStatus = false) {
  try {
    const data = await getCachedEvents();
    const dropdown = document.getElementById(selectId);
    if (!dropdown) return;

    dropdown.innerHTML = `<option value="">Select Event</option>`;
    data.forEach((event) => {
      const option = document.createElement("option");
      option.value = valueColumn === "event_name" ? event.event_name : event.idevent_info;
      option.textContent = includeStatus ? `${event.event_name} (${event.status})` : event.event_name;
      dropdown.appendChild(option);
    });
  } catch (error) {
    console.error(`Error loading events for ${selectId}:`, error);
  }
  return;

  const { data, error } = await supabaseClient
    .from("event_info")
    .select("idevent_info, event_name, status")
    .order("date", { ascending: false });

  if (error) {
    console.error(`Error loading events for ${selectId}:`, error);
    return;
  }

  const dropdown = document.getElementById(selectId);
  if (!dropdown) return;

  dropdown.innerHTML = `<option value="">Select Event</option>`;
  data.forEach((event) => {
    const option = document.createElement("option");
    option.value = valueColumn === "event_name" ? event.event_name : event.idevent_info;
    option.textContent = includeStatus ? `${event.event_name} (${event.status})` : event.event_name;
    dropdown.appendChild(option);
  });
}


// ✅ New function: Edit event with confirmation for ongoing events
async function editEventWithConfirm(eventId) {
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

    // ⚠️ Show confirmation if event is ongoing
    if (data.status === 'ongoing') {
      const confirmed = confirm(
        `⚠️ WARNING: This event is still ONGOING!\n\n` +
        `Event: ${data.event_name}\n` +
        `Status: ${data.status}\n\n` +
        `Are you sure you want to edit this event?\n\n` +
        `(This will recalculate all attendance statuses)\n\n` +
        `Click OK to confirm or Cancel to go back.`
      );
      if (!confirmed) return; // User cancelled
    }

    // proceed with edit
    editEvent(eventId);

  } catch (err) {
    console.error("❌ Unexpected error in editEventWithConfirm:", err);
  }
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
    showNotification(" Please fill in all fields.", "warning");
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
    showNotification("Error creating event. Check console for details.", "error");
  } else {
    showNotification(" Event created successfully!", "success");
    closeModal("addEventModal");
    invalidateFilterOptionsCache({ events: true });
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
// ✅ Listen for Enter from RFID reader (only on AdminPage, not StudentPage)
const rfidInputElement = document.getElementById("rfidInput");
if (rfidInputElement) {
  rfidInputElement.addEventListener("keydown", async function (e) {
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
}



async function exportSanctionsCSV() {
  try {
    const filters = getSanctionFiltersFromUI();

    if (!filters.eventId) {
      showNotification("Please select an event before exporting sanctions.", "warning");
      return;
    }

    const roleName = filters.role ? formatStudentRole(filters.role) : "";
    let allData = [];
    let from = 0;
    const batchSize = 1000;

    while (true) {
      const { data, error } = await buildSanctionsQuery(`
        id,
        student_name,
        student_info!inner (
          name,
          year_level,
          section,
          role
        ),
        event_name,
        penalty,
        fee,
        date_given,
        status
      `, filters)
        .order("student_name", { ascending: true })
        .range(from, from + batchSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      allData = allData.concat(data);
      if (data.length < batchSize) break;
      from += batchSize;
    }

    if (!allData.length) {
      showNotification("No sanctions data to export for the selected filters.", "error");
      return;
    }

    let csv = "Name,Year Level,Section,Event,Penalty,Fee,Date Given,Status\n";
    const csvCell = (value) => `"${String(value ?? "-").replace(/"/g, '""')}"`;

    allData.forEach(row => {
      const student = row.student_info || {};
      const studentName = student.name || row.student_name || "-";
      const formattedDate = row.date_given
        ? new Date(row.date_given + "T00:00:00").toLocaleDateString("en-PH", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        })
        : "-";

      csv += [
        csvCell(studentName),
        csvCell(student.year_level),
        csvCell(student.section),
        csvCell(row.event_name || filters.eventName),
        csvCell(row.penalty),
        csvCell(row.fee ? Number(row.fee).toLocaleString() : "-"),
        csvCell(formattedDate),
        csvCell(row.status),
      ].join(",") + "\n";
    });

    const dateStr = new Date().toISOString().split("T")[0];
    const safeFilePart = (value, fallback) =>
      String(value || fallback)
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/\s+/g, "_")
        .slice(0, 80);

    let fileName = "Sanctions";
    fileName += `-${safeFilePart(filters.eventName, "SelectedEvent")}`;
    fileName += `-${safeFilePart(filters.yearLevel, "AllYears")}`;
    fileName += `-${safeFilePart(roleName, "AllRoles")}`;
    fileName += `-${safeFilePart(filters.section ? `Section${filters.section}` : "", "AllSections")}`;
    fileName += `-${dateStr}`;

    const bom = "\uFEFF";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log(`Exported ${allData.length} sanction records to ${fileName}.csv`);
    return;
  } catch (err) {
    console.error("Failed to export sanctions CSV:", err);
    showNotification("Failed to export sanctions.", "error");
    return;
  }

  const eventName = document.getElementById("sanctionEventFilter")?.value || "";
  const section = document.getElementById("sanctionSectionFilter")?.value || "";
  const role = document.getElementById("sanctionRoleFilter")?.value || "";
  const yearLevel = document.getElementById("sanctionYearFilter")?.value || "";
  const showResolved = document.getElementById("showResolvedCheckbox")?.checked || false;

  try {
    // ✅ Get readable role name for filename (not just ID)
    const roleName = role ? formatStudentRole(role) : "";

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
            role
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
      showNotification("❌ No sanctions data to export.", "error");
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

    if (role) {
      filtered = filtered.filter(s => normalizeStudentRole(s.student_info?.role) === role);
    }

    if (!filtered.length) {
      showNotification("❌ No sanctions found for selected filters.", "error");
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

    // ✅ Build filename (include year level & role)
    const dateStr = new Date().toISOString().split("T")[0];
    let fileName = "Sanctions";
    fileName += eventName ? `-${eventName}` : "-AllEvents";
    fileName += yearLevel ? `-${yearLevel}` : "-AllYears";
    fileName += roleName ? `-${roleName}` : "-AllRoles";
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
    showNotification("❌ Failed to export sanctions.", "error");
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

// ✅ Optimized RFID reader input listener (only on AdminPage)
const rfidInputElement2 = document.getElementById("rfidInput");
if (rfidInputElement2) {
  rfidInputElement2.addEventListener("keydown", async function (e) {
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
}

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
async function updateAllEvents(options = {}) {
  const { refreshEventsTable = true } = options;
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
      const newClosed = newStatus === "completed" ? Boolean(event.closed) : false;

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

        }
      }
    }

    console.log(`🔄 ${updatedCount}/${events.length} events updated`);
    if (updatedCount > 0) invalidateFilterOptionsCache({ events: true });
    if (refreshEventsTable) loadEvents(); // Refresh your events table UI
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
      info.innerText = `⛔ Event "${event.event_name}" is closed. Please contact the officers for assistance.`;
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
      info.innerText = `⛔ Event is closed (deadline was ${event.late_until}). Please contact the officers.`;
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
          event_id: Number(eventId),
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
      event_id: event.idevent_info,
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
            .eq("role", "student")
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
        .eq("role", "student")
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
      event_id: event.idevent_info,
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

    showNotification(
      `✅ Auto Absent Complete for "${event.event_name}" - Present: ${completionRate}%, Absent: ${missingRate}%`,
      "success"
    );

    console.log(`✅ Absentees marked successfully for "${event.event_name}"`);
  } catch (err) {
    console.error(`❌ markAbsenteesWithRetry failed for "${event.event_name}":`, err);
    if (!navigator.onLine) {
      enqueueRetry(() => markAbsenteesWithRetry(event));
    } else {
      showNotification(`⚠️ Failed to auto-mark absentees for "${event.event_name}". Check console.`, "error");
    }
    throw err;
  }
}







let pendingFinalizeEventId = null;

async function openFinalizeEventModal(eventId) {
  pendingFinalizeEventId = Number(eventId);
  const message = document.getElementById("finalizeEventMessage");
  const error = document.getElementById("finalizeEventError");

  if (error) error.style.display = "none";
  if (message) message.textContent = "Loading event details...";

  openModal("finalizeEventModal");

  try {
    const { data: event, error: eventError } = await supabaseClient
      .from("event_info")
      .select("idevent_info, event_name, status")
      .eq("idevent_info", pendingFinalizeEventId)
      .single();

    if (eventError || !event) throw eventError || new Error("Event not found");

    if (message) {
      message.textContent = `Finalize "${event.event_name}"? This will mark students with no attendance record as absent and create their matching sanctions.`;
    }
  } catch (err) {
    console.error("Failed to prepare finalize event modal:", err);
    if (message) message.textContent = "Could not load this event. Please try again.";
  }
}

function closeFinalizeEventModal() {
  pendingFinalizeEventId = null;
  const error = document.getElementById("finalizeEventError");
  if (error) error.style.display = "none";
  closeModal("finalizeEventModal");
}

async function confirmFinalizeEvent() {
  if (!pendingFinalizeEventId) {
    closeFinalizeEventModal();
    return;
  }

  const confirmBtn = document.getElementById("finalizeEventConfirmBtn");
  const error = document.getElementById("finalizeEventError");
  const eventId = pendingFinalizeEventId;

  try {
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Finalizing...";
    }
    if (error) error.style.display = "none";

    const { data: event, error: eventError } = await supabaseClient
      .from("event_info")
      .select("idevent_info, event_name, date, time_start, time_end, late_until, status, closed")
      .eq("idevent_info", eventId)
      .single();

    if (eventError || !event) throw eventError || new Error("Event not found");

    if (event.status !== "completed") {
      throw new Error("Only completed events can be finalized.");
    }

    await markAbsenteesWithRetry(event);
    await reconcileSanctionsForEvent(event.event_name, event.idevent_info);

    const { error: updateError } = await supabaseClient
      .from("event_info")
      .update({ closed: true })
      .eq("idevent_info", eventId);

    if (updateError) throw updateError;

    showNotification(`Finalized "${event.event_name}". Missing students were marked absent.`, "success");
    closeFinalizeEventModal();

    sectionLoadState.dashboard = false;
    sectionLoadState.attendance = false;
    sectionLoadState.sanctions = false;
    await loadEvents();
  } catch (err) {
    console.error("Failed to finalize event:", err);
    if (error) {
      error.textContent = err.message || "Could not finalize this event. Check console for details.";
      error.style.display = "block";
    } else {
      showNotification("Could not finalize this event. Check console for details.", "error");
    }
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Finalize Event";
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
    showNotification("Failed to delete attendance.", "error");
    return;
  }

  showNotification(" Attendance deleted successfully.", "success");
  // ✅ Refresh with current page and filters
  filterAttendance(attendanceCurrentPage);
}

// Open Edit modal and prefill

async function editStudent(id) {
  // Fetch student
  const { data: student, error } = await supabaseClient
    .from("student_info")
    .select("idstudent_info, student_id, name, rfid, year_level, section, role, password")
    .eq("idstudent_info", id)
    .single();

  if (error || !student) {
    console.error("Error fetching student:", error);
    showNotification("Failed to load student.", "error");
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
  document.getElementById("editStudentRole").value = normalizeStudentRole(student.role);

  // Finally, open modal
  openModal("editStudentModal");
}

function getStudentEditFormValues() {
  const idField = document.getElementById("editStudentId");
  const schoolIdField = document.getElementById("editStudentSchoolId");
  const nameField = document.getElementById("editStudentName");
  const rfidField = document.getElementById("editStudentRfid");
  const yearField = document.getElementById("editStudentYear");
  const sectionField = document.getElementById("editStudentSection");
  const roleField = document.getElementById("editStudentRole");
  const passField = document.getElementById("editStudentPassword");

  if (!idField || !schoolIdField || !nameField || !rfidField || !yearField || !sectionField || !roleField || !passField) {
    console.error("One or more editStudent fields not found in DOM");
    showNotification("Form error: some fields are missing. Check your modal HTML IDs.", "error");
    return null;
  }

  const id = idField.value;
  const schoolId = schoolIdField.value.trim();
  const name = nameField.value.trim();
  const rfid = rfidField.value.trim();
  const year = yearField.value;
  const section = sectionField.value.trim();
  const role = normalizeStudentRole(roleField.value);
  const password = passField.value;

  if (!id || !schoolId || !name || !rfid || !year || !section || !role || !password) {
    showNotification("Please fill in all fields.", "warning");
    return null;
  }

  return { id, schoolId, name, rfid, year, section, role, password };
}

function openStudentEditConfirm() {
  const values = getStudentEditFormValues();
  if (!values) return;

  const messageEl = document.getElementById("studentEditConfirmMessage");
  if (messageEl) {
    messageEl.textContent = `Save changes for ${values.name} (${values.schoolId}) with RFID ${values.rfid}?`;
  }

  openModal("studentEditConfirmModal");
}

async function confirmStudentEditSave() {
  closeModal("studentEditConfirmModal");
  await saveStudentEdit();
}

// ✅ Save student edits safely
async function saveStudentEdit() {
  const values = getStudentEditFormValues();
  if (!values) {
    return;
  }

  const { id, schoolId, name, rfid, year, section, role, password } = values;

  try {
    const { error } = await supabaseClient
      .from("student_info")
      .update({
        student_id: schoolId,
        name,
        rfid,
        year_level: year,
        section: section,
        role,
        password,
      })
      .eq("idstudent_info", id);

    if (error) throw error;

    showNotification("Student updated successfully!", "success");
    closeModal("editStudentModal");
    invalidateFilterOptionsCache({ students: true });
    loadStudents();
  } catch (err) {
    console.error("Error updating student:", err);
    showNotification("Failed to update student. Check console for details.", "error");
  }
}

function openEditStudentModal(student) {
  document.getElementById("editStudentId").value = student.idstudent_info;
  document.getElementById("editStudentName").value = student.name;
  document.getElementById("editStudentRfid").value = student.rfid;
  document.getElementById("editStudentYear").value = student.year_level;
  document.getElementById("editStudentSection").value = student.section;
  document.getElementById("editStudentPassword").value = student.password;
  document.getElementById("editStudentRole").value = normalizeStudentRole(student.role);

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

  // Keep new student default as student unless admin selects officer.
  if (modalId === 'addStudentModal') {
    const roleSelect = document.getElementById("studentRole");
    if (roleSelect) roleSelect.value = "student";
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

async function saveEventEdit() {
  const id = document.getElementById("editEventId").value;
  const eventName = document.getElementById("editEventName").value;
  const eventDate = document.getElementById("editEventDate").value;
  const startTime = document.getElementById("editStartTime").value + ":00";
  const endTime = document.getElementById("editEndTime").value + ":00";
  const lateUntil = document.getElementById("editLateUntil").value + ":00";
  const status = document.getElementById("editEventStatus").value;
  const closed = status === "completed";

  const { error } = await supabaseClient
    .from("event_info")
    .update({
      event_name: eventName,
      date: eventDate,
      time_start: startTime,
      time_end: endTime,
      late_until: lateUntil,
      status,
      closed
    })
    .eq("idevent_info", id);

  if (error) {
    console.error("❌ Error updating event:", error);
    showNotification("Failed to update event.", "error");
    return;
  }

  showNotification("✅ Event updated successfully!", "success");
  closeModal("editEventModal");
  invalidateFilterOptionsCache({ events: true });
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
  try {
    const data = await getCachedEvents();
    const filter = document.getElementById("eventFilter");
    if (!filter) return;

    filter.innerHTML = `<option value="">All Events</option>`;
    data.forEach((ev) => {
      filter.innerHTML += `<option value="${ev.idevent_info}">${escapeHTML(ev.event_name)}</option>`;
    });
  } catch (error) {
    console.error("Error loading events:", error);
  }
  return;

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
    filter.innerHTML += `<option value="${ev.idevent_info}">${escapeHTML(ev.event_name)}</option>`;
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

async function reconcileSanctionsForEvent(eventName, eventId = null) {
  if (!eventName && !eventId) return 0;

  try {
    let resolvedEventId = eventId ? Number(eventId) : null;
    if (!resolvedEventId) {
      const { data: event, error: eventError } = await supabaseClient
        .from("event_info")
        .select("idevent_info")
        .eq("event_name", eventName)
        .maybeSingle();

      if (eventError) throw eventError;
      resolvedEventId = event?.idevent_info || null;
    }

    if (!resolvedEventId) return 0;

    const { data: sanctions, error: sanctionError } = await supabaseClient
      .from("sanctions")
      .select("id, idstudent_info, penalty, status")
      .eq("event_id", resolvedEventId)
      .neq("status", "resolved");

    if (sanctionError) throw sanctionError;
    if (!sanctions?.length) return 0;

    const { data: attendance, error: attendanceError } = await supabaseClient
      .from("attendance")
      .select("student_id, status")
      .eq("event_id", resolvedEventId);

    if (attendanceError) throw attendanceError;

    const attendanceByStudent = new Map(
      (attendance || []).map((record) => [String(record.student_id), record.status])
    );

    const staleSanctionIds = sanctions
      .filter((sanction) => {
        const attendanceStatus = attendanceByStudent.get(String(sanction.idstudent_info));
        if (attendanceStatus === "present") return ["Late", "Absent"].includes(sanction.penalty);
        if (attendanceStatus === "late") return sanction.penalty === "Absent";
        return false;
      })
      .map((sanction) => sanction.id);

    if (!staleSanctionIds.length) return 0;

    const { error: deleteError } = await supabaseClient
      .from("sanctions")
      .delete()
      .in("id", staleSanctionIds);

    if (deleteError) throw deleteError;
    console.log(`Reconciled ${staleSanctionIds.length} stale sanction(s) for ${eventName}.`);
    return staleSanctionIds.length;
  } catch (error) {
    console.error("Failed to reconcile sanctions:", error);
    return 0;
  }
}

function getSanctionFiltersFromUI() {
  const eventFilter = document.getElementById("sanctionEventFilter");
  const selectedEventOption = eventFilter?.selectedOptions?.[0];
  const eventId = eventFilter?.value || "";
  const eventName = selectedEventOption?.dataset?.eventName || selectedEventOption?.textContent || "";

  return {
    showResolved: document.getElementById("showResolvedCheckbox")?.checked || false,
    eventId,
    eventName,
    section: document.getElementById("sanctionSectionFilter")?.value || "",
    role: document.getElementById("sanctionRoleFilter")?.value || "",
    yearLevel: document.getElementById("sanctionYearFilter")?.value || "",
    searchQuery: document.getElementById("searchInput")?.value.trim() || "",
  };
}

function buildSanctionsQuery(selectColumns, filters, options = {}) {
  let query = supabaseClient
    .from("sanctions")
    .select(selectColumns, options)
    .eq("event_id", Number(filters.eventId));

  if (!filters.showResolved) query = query.neq("status", "resolved");
  if (filters.yearLevel) query = query.eq("student_info.year_level", filters.yearLevel);
  if (filters.section) query = query.eq("student_info.section", filters.section);
  if (filters.role) query = query.eq("student_info.role", filters.role);

  if (filters.searchQuery) {
    const safeSearch = filters.searchQuery.replace(/[,%]/g, " ").trim();
    if (safeSearch) {
      const pattern = `%${safeSearch}%`;
      query = query.or(`student_name.ilike.${pattern},penalty.ilike.${pattern},status.ilike.${pattern}`);
    }
  }

  return query;
}

async function loadSanctionStats(filters) {
  let sanctions = [];
  let from = 0;
  const batchSize = 1000;

  while (true) {
    const { data, error } = await buildSanctionsQuery(`
      fee,
      penalty,
      status,
      student_info!inner (
        year_level,
        section,
        role
      )
    `, filters).range(from, from + batchSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    sanctions = sanctions.concat(data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  const resolvedSanctions = sanctions.filter((s) => s.status === "resolved");
  const unresolvedSanctions = sanctions.filter((s) => s.status !== "resolved");
  const absentSanctions = sanctions.filter((s) => s.penalty?.toLowerCase() === "absent");
  const lateSanctions = sanctions.filter((s) => s.penalty?.toLowerCase() === "late");

  return {
    totalStudents: sanctions.length,
    resolvedStudents: resolvedSanctions.length,
    noOfAbsent: absentSanctions.length,
    noOfLate: lateSanctions.length,
    totalFee: sanctions.reduce((sum, s) => sum + (Number(s.fee) || 0), 0),
    unresolvedFee: unresolvedSanctions.reduce((sum, s) => sum + (Number(s.fee) || 0), 0),
    resolvedFee: resolvedSanctions.reduce((sum, s) => sum + (Number(s.fee) || 0), 0),
  };
}

async function fetchSanctions(page = 1) {
  const loader = document.getElementById("sanctionLoading");
  if (loader) {
    loader.classList.add("active");
    await new Promise(requestAnimationFrame);
  }

  try {
    const filters = getSanctionFiltersFromUI();

    if (!filters.eventId) {
      const table = document.getElementById("sanctionTable");
      table.innerHTML = `<tr><td colspan="8">Please select an event to view sanctions.</td></tr>`;
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

    await reconcileSanctionsForEvent(filters.eventName, Number(filters.eventId));
    if (filters.searchQuery) page = 1;

    const totalQuery = buildSanctionsQuery(`
      id,
      student_info!inner (
        year_level,
        section,
        role
      )
    `, filters, { count: "exact", head: true });

    const { count, error: countError } = await totalQuery;
    if (countError) throw countError;

    const totalRecords = count || 0;
    const totalPages = Math.max(1, Math.ceil(totalRecords / sanctionRowsPerPage));
    const currentPage = Math.min(Math.max(1, page || 1), totalPages);
    sanctionCurrentPage = currentPage;

    const startIndex = (currentPage - 1) * sanctionRowsPerPage;
    const endIndex = startIndex + sanctionRowsPerPage - 1;

    const { data: pageData, error: pageError } = await buildSanctionsQuery(`
      id,
      student_name,
      student_info!inner (
        name,
        year_level,
        section,
        role
      ),
      event_name,
      penalty,
      fee,
      date_given,
      status
    `, filters)
      .order("student_name", { ascending: true })
      .range(startIndex, endIndex);

    if (pageError) throw pageError;

    // --- Render Table ---
    const table = document.getElementById("sanctionTable");
    table.innerHTML = "";

    if (!pageData.length) {
      table.innerHTML = `<tr><td colspan="8">No sanctions found for this event and filter combination.</td></tr>`;
    } else {
      for (const sanction of pageData) {
        const student = sanction.student_info || {};
        const studentName = student.name || sanction.student_name || "-";
        const formattedDate = sanction.date_given
          ? new Date(sanction.date_given + "T00:00:00").toLocaleDateString("en-PH", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          })
          : "-";

        const row = `
          <tr>
            <td>${escapeHTML(studentName)}</td>
            <td>${escapeHTML(student.year_level || "-")}</td>
            <td>${escapeHTML(student.section || "-")}</td>
            <td>${escapeHTML(sanction.penalty || "-")}</td>
            <td>₱${Number(sanction.fee || 0).toLocaleString()}</td>
            <td>${formattedDate}</td>
            <td><span class="status-badge ${escapeHTML(sanction.status)}">${escapeHTML(sanction.status).toUpperCase()}</span></td>
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

    const stats = await loadSanctionStats(filters);

    document.getElementById("totalSanctionStudents").textContent = stats.totalStudents;
    document.getElementById("resolvedSanctionStudents").textContent = stats.resolvedStudents;
    document.getElementById("noOfLate").textContent = stats.noOfLate;
    document.getElementById("noOfAbsent").textContent = stats.noOfAbsent;

    document.getElementById("totalSanctionFee").textContent = `₱${stats.totalFee.toLocaleString()}`;
    document.getElementById("unresolvedFee").textContent = `₱${stats.unresolvedFee.toLocaleString()}`;
    document.getElementById("resolvedFee").textContent = `₱${stats.resolvedFee.toLocaleString()}`;

  } catch (err) {
    console.error("❌ fetchSanctions failed:", err);
    const table = document.getElementById("sanctionTable");
    if (table)
      table.innerHTML = `<tr><td colspan="8">⚠️ Error loading sanctions. Check console.</td></tr>`;

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
    const { years } = await getCachedStudentMeta();
    populateSelectOptions("sanctionYearFilter", "All Year Levels", years);
  } catch (err) {
    console.error("Error loading year levels for sanctions:", err);
  }
  return;

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

  showNotification("✅ Sanction marked as resolved.", "success");
  fetchSanctions(); // refresh table and stats
}

function confirmResolve(id) {
  if (confirm("⚠️ Are you sure you want to mark this sanction as PAID?")) {
    resolveSanction(id);
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
    showNotification("Attendance is now closed. Please ask an officer for manual entry.", "warning");
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



const sectionLoadState = {
  dashboard: false,
  attendance: false,
  students: false,
  events: false,
  sanctions: false,
  superManual: false,
};

async function loadSectionData(section, options = {}) {
  const { force = false } = options;
  if (!force && sectionLoadState[section]) return;

  switch (section) {
    case "dashboard":
      await loadDashboardEvents();
      sectionLoadState.dashboard = true;
      break;

    case "attendance":
      await Promise.all([
        loadEventOptions("eventFilter"),
        loadManualEventOptions(),
        populateAttendanceFilters(),
        populateAttendanceYearFilter(),
      ]);
      sectionLoadState.attendance = true;
      break;

    case "students":
      await Promise.all([
        loadStudents(1),
        loadSections(),
        loadYearLevels(),
      ]);
      sectionLoadState.students = true;
      break;

    case "events":
      await updateAllEvents({ refreshEventsTable: true });
      sectionLoadState.events = true;
      sectionLoadState.dashboard = false;
      sectionLoadState.attendance = false;
      sectionLoadState.sanctions = false;
      break;

    case "sanctions":
      await Promise.all([
        loadYearLevelsForSanctions(),
        loadSectionsForSanctions(),
        loadSanctionEventFilter(),
      ]);
      await fetchSanctions(1);
      sectionLoadState.sanctions = true;
      break;

    case "superManual":
      sectionLoadState.superManual = true;
      break;

    default:
      break;
  }
}

// -------------------- INIT --------------------
document.addEventListener("DOMContentLoaded", async () => {
  const pageLoader = document.getElementById("pageLoader");
  if (pageLoader) pageLoader.classList.remove("hidden");

  const forceLoggedOut = await enforceForceLogoutVersion();
  if (forceLoggedOut) {
    if (pageLoader) pageLoader.classList.add("hidden");
    return;
  }

  const isAuthenticated = await checkAuthAndInit();
  if (!isAuthenticated) {
    if (pageLoader) pageLoader.classList.add("hidden");
    return;
  }

  await new Promise(requestAnimationFrame);
  await Promise.all([
    loadAdminInfo(),
    loadStudentMaintenanceStatus(),
  ]);
  await updateAllEvents({ refreshEventsTable: false });
  await loadSectionData("dashboard", { force: true });

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

// Search input listener (only on AdminPage)
const searchInput = document.getElementById("searchInput");
if (searchInput) {
  searchInput.addEventListener("input", function () {
    const query = this.value.toLowerCase();
    debouncedSearch(query);
  });
}



// ✅ Notifications with styled bar on top-right
function showNotification(message, type = "info") {
  // Create container if it doesn't exist
  let container = document.getElementById("notificationContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "notificationContainer";
    container.className = "notification-container";
    document.body.appendChild(container);
  }

  // Create notification element
  const notif = document.createElement("div");
  notif.className = `notification ${type}`;
  
  // Add icon based on type
  const iconMap = {
    success: "fa-check-circle",
    error: "fa-exclamation-circle",
    warning: "fa-exclamation-triangle",
    info: "fa-info-circle"
  };
  
  const icon = document.createElement("i");
  icon.className = `fas ${iconMap[type] || iconMap.info}`;
  
  const message_text = document.createElement("span");
  message_text.textContent = message;
  
  notif.appendChild(icon);
  notif.appendChild(message_text);
  container.appendChild(notif);
  
  // Auto-remove after 4 seconds
  setTimeout(() => {
    notif.classList.add("fade-out");
    setTimeout(() => notif.remove(), 300);
  }, 4000);
}

function activateAdminSection(section) {
  document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
  const activeLink = document.querySelector(`[data-section="${section}"]`);
  if (activeLink) activeLink.classList.add("active");

  document.querySelectorAll(".content-section").forEach(s => s.classList.remove("active"));
  const activeSection = document.getElementById(section);
  if (activeSection) activeSection.classList.add("active");

  const titles = {
    dashboard: "Dashboard",
    attendance: "Attendance",
    students: "Students",
    events: "Events",
    sanctions: "Sanctions",
    superManual: "Super Manual Entry"
  };
  document.getElementById("pageTitle").textContent = titles[section] || "Dashboard";
}

// Update your nav-link click handler
document.querySelectorAll(".nav-link").forEach(link => {
  link.addEventListener("click", async (e) => {
    const section = link.dataset.section;

    // Check if trying to access protected correction tools
    if ((section === "sanctions" || section === "superManual") && !sanctionAccessGranted) {
      e.preventDefault(); // Prevent navigation
      pendingProtectedSection = section;
      openModal("sanctionPasswordModal");
      document.getElementById("sanctionPasswordInput").focus();
      return;
    }

    // Normal navigation for other sections or if access already granted
    activateAdminSection(section);
    await loadSectionData(section);

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
  await loadEventOptions("attendanceEvent");
}

// ✅ Fetch student name by ID
async function fetchStudentName() {
  const studentId = document.getElementById("attendanceStudentId").value.trim();
  if (!studentId) {
    showNotification("Enter Student ID first!", "warning");
    return;
  }

  const { data: student, error } = await supabaseClient
    .from("student_info")
    .select("idstudent_info, name")
    .eq("student_id", studentId)
    .single();

  if (error || !student) {
    showNotification("❌ Student not found!", "error");
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
    showNotification(" Please fill in all fields and fetch student name.", "warning");
    return;
  }

  // Validate allowed statuses (match attendance table constraints)
  const allowedStatuses = ['present', 'absent', 'late', 'excused'];
  if (!allowedStatuses.includes(status)) {
    showNotification(`⚠️ Status must be one of: ${allowedStatuses.join(', ')}`, "warning");
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
    showNotification(`⚠️ ${studentName} already has attendance for this event.`, "warning");
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
    showNotification("Failed to record attendance.", "error");
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
      showNotification("Attendance recorded, but failed to record sanction.", "error");
      showNotification("Attendance recorded, but failed to record sanction.", "error");
      return;
    }
  }

  showNotification(`✅ Attendance recorded for ${studentName}`, "success");
  document.getElementById("manualAttendanceForm").reset();
  delete studentIdInput.dataset.internalId;
  filterAttendance(attendanceCurrentPage); // ✅ Use filterAttendance instead

}






// ✅ Init when page loads
function normalizeEventNameForMatch(eventName) {
  return String(eventName || "").replace(/\s+/g, " ").trim();
}

function getPhilippinesDateTimeParts() {
  const now = new Date();
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const dateMap = Object.fromEntries(dateParts.map((part) => [part.type, part.value]));
  const date = `${dateMap.year}-${dateMap.month}-${dateMap.day}`;
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);

  return { date, time };
}

async function searchSuperManualStudents() {
  const query = document.getElementById("superManualSearchInput")?.value.trim() || "";
  const table = document.getElementById("superManualStudentResults");
  const loader = document.getElementById("superManualLoading");

  if (!table) return;
  if (query.length < 2) {
    table.innerHTML = `<tr><td colspan="6">Type at least 2 characters to search.</td></tr>`;
    return;
  }

  if (loader) {
    loader.classList.add("active");
    await new Promise(requestAnimationFrame);
  }

  try {
    const columns = "idstudent_info, student_id, name, year_level, section, role, status";
    const [idResult, nameResult] = await Promise.all([
      supabaseClient.from("student_info").select(columns).ilike("student_id", `%${query}%`).limit(10),
      supabaseClient.from("student_info").select(columns).ilike("name", `%${query}%`).limit(10),
    ]);

    if (idResult.error) throw idResult.error;
    if (nameResult.error) throw nameResult.error;

    const studentsById = new Map();
    [...(idResult.data || []), ...(nameResult.data || [])].forEach((student) => {
      studentsById.set(student.idstudent_info, student);
    });

    const students = [...studentsById.values()]
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .slice(0, 20);

    if (!students.length) {
      table.innerHTML = `<tr><td colspan="6">No students found.</td></tr>`;
      return;
    }

    table.innerHTML = students.map((student) => `
      <tr>
        <td>${escapeHTML(student.student_id || "-")}</td>
        <td>${escapeHTML(student.name || "-")}</td>
        <td>${escapeHTML(student.year_level || "-")}</td>
        <td>${escapeHTML(student.section || "-")}</td>
        <td>${escapeHTML(formatStudentRole(student.role))}</td>
        <td>
          <button class="btn btn-primary" onclick="selectSuperManualStudent(${student.idstudent_info})">
            View Records
          </button>
        </td>
      </tr>
    `).join("");
  } catch (err) {
    console.error("Super manual search failed:", err);
    table.innerHTML = `<tr><td colspan="6">Search failed. Check console.</td></tr>`;
  } finally {
    if (loader) loader.classList.remove("active");
  }
}

async function selectSuperManualStudent(studentId) {
  const loader = document.getElementById("superManualLoading");
  if (loader) {
    loader.classList.add("active");
    await new Promise(requestAnimationFrame);
  }

  try {
    const { data: student, error } = await supabaseClient
      .from("student_info")
      .select("idstudent_info, student_id, name, year_level, section, role")
      .eq("idstudent_info", studentId)
      .single();

    if (error || !student) throw error || new Error("Student not found");

    selectedSuperManualStudent = student;
    document.getElementById("superManualDetails").style.display = "block";
    document.getElementById("superManualStudentTitle").textContent =
      `${student.name} (${student.student_id})`;
    document.getElementById("superManualRoleSelect").value = normalizeStudentRole(student.role);

    await loadSuperManualEventRecords();
  } catch (err) {
    console.error("Failed to load student records:", err);
    showNotification("Failed to load student records.", "error");
  } finally {
    if (loader) loader.classList.remove("active");
  }
}

async function loadSuperManualEventRecords() {
  if (!selectedSuperManualStudent) return;

  const table = document.getElementById("superManualEventRows");
  if (!table) return;

  table.innerHTML = `<tr><td colspan="6">Loading event records...</td></tr>`;

  try {
    const [eventsResult, attendanceResult, sanctionsResult] = await Promise.all([
      supabaseClient.from("event_info").select("idevent_info, event_name, date").order("date", { ascending: false }),
      supabaseClient.from("attendance").select("idattendance, event_id, status, scan_time, date").eq("student_id", selectedSuperManualStudent.idstudent_info),
      supabaseClient.from("sanctions").select("id, event_name, penalty, fee, status, date_given").eq("idstudent_info", selectedSuperManualStudent.idstudent_info),
    ]);

    if (eventsResult.error) throw eventsResult.error;
    if (attendanceResult.error) throw attendanceResult.error;
    if (sanctionsResult.error) throw sanctionsResult.error;

    superManualEventsCache = eventsResult.data || [];
    const attendanceByEvent = new Map((attendanceResult.data || []).map((row) => [Number(row.event_id), row]));
    const sanctionsByEventName = new Map();

    (sanctionsResult.data || []).forEach((sanction) => {
      const key = normalizeEventNameForMatch(sanction.event_name);
      const existing = sanctionsByEventName.get(key);
      if (!existing || existing.status === "resolved") sanctionsByEventName.set(key, sanction);
    });

    if (!superManualEventsCache.length) {
      table.innerHTML = `<tr><td colspan="6">No events found.</td></tr>`;
      return;
    }

    table.innerHTML = superManualEventsCache.map((event) => {
      const attendance = attendanceByEvent.get(Number(event.idevent_info));
      const sanction = sanctionsByEventName.get(normalizeEventNameForMatch(event.event_name));
      const attendanceStatus = attendance?.status || "missing";
      const sanctionText = sanction ? `${sanction.penalty || "-"} (${sanction.status || "pending"})` : "-";
      const feeText = sanction?.fee ? `₱${Number(sanction.fee).toLocaleString()}` : "-";

      return `
        <tr>
          <td>${escapeHTML(event.event_name || "-")}</td>
          <td>${escapeHTML(event.date || "-")}</td>
          <td><span class="status-badge ${escapeHTML(attendanceStatus)}">${escapeHTML(attendanceStatus.toUpperCase())}</span></td>
          <td>${escapeHTML(sanctionText)}</td>
          <td>${feeText}</td>
          <td>
            <button class="btn btn-primary" onclick="updateSuperManualAttendance(${event.idevent_info}, 'present')">Present</button>
            <button class="btn btn-secondary" onclick="updateSuperManualAttendance(${event.idevent_info}, 'late')">Late</button>
            <button class="btn btn-danger" onclick="updateSuperManualAttendance(${event.idevent_info}, 'absent')">Absent</button>
          </td>
        </tr>
      `;
    }).join("");
  } catch (err) {
    console.error("Failed to load super manual event records:", err);
    table.innerHTML = `<tr><td colspan="6">Failed to load event records.</td></tr>`;
  }
}

async function getAuditActor() {
  const session = await getValidAdminSession();
  const adminId = session?.user?.id || null;
  let adminUsername = document.getElementById("adminName")?.textContent?.trim() || session?.user?.email || "unknown";

  if (adminId) {
    const { data, error } = await supabaseClient
      .from("admin_info")
      .select("admin_username")
      .eq("auth_id", adminId)
      .maybeSingle();

    if (!error && data?.admin_username) adminUsername = data.admin_username;
  }

  return { adminId, adminUsername };
}

function normalizeAuditSanctions(sanctions) {
  return (sanctions || []).map((sanction) => ({
    id: sanction.id,
    event_id: sanction.event_id,
    event_name: sanction.event_name,
    penalty: sanction.penalty,
    fee: sanction.fee,
    status: sanction.status,
    date_given: sanction.date_given,
  }));
}

async function getSuperManualSanctionsForEvent(studentInternalId, eventName, eventId = null) {
  const { data, error } = await supabaseClient
    .from("sanctions")
    .select("id, event_id, event_name, penalty, fee, status, date_given")
    .eq("idstudent_info", studentInternalId);

  if (error) throw error;

  return (data || []).filter((sanction) => {
    if (eventId && Number(sanction.event_id) === Number(eventId)) return true;
    return normalizeEventNameForMatch(sanction.event_name) === normalizeEventNameForMatch(eventName);
  });
}

async function logSuperManualAudit(entry) {
  try {
    const { adminId, adminUsername } = await getAuditActor();
    const { error } = await supabaseClient
      .from("super_manual_audit_logs")
      .insert({
        admin_id: adminId,
        admin_username: adminUsername,
        action: entry.action,
        student_internal_id: entry.studentInternalId,
        student_id: entry.studentId,
        student_name: entry.studentName,
        event_id: entry.eventId || null,
        event_name: entry.eventName || null,
        old_attendance_status: entry.oldAttendanceStatus || null,
        new_attendance_status: entry.newAttendanceStatus || null,
        old_role: entry.oldRole || null,
        new_role: entry.newRole || null,
        old_sanction_state: entry.oldSanctionState ?? null,
        new_sanction_state: entry.newSanctionState ?? null,
      });

    if (error) throw error;
    return true;
  } catch (err) {
    console.error("Failed to write Super Manual audit log:", err);
    showNotification("Change saved, but audit log failed. Run the audit setup SQL if needed.", "warning");
    return false;
  }
}

async function updateSuperManualRole() {
  if (!selectedSuperManualStudent) {
    showNotification("Select a student first.", "warning");
    return;
  }

  const oldRole = normalizeStudentRole(selectedSuperManualStudent.role);
  const nextRole = normalizeStudentRole(document.getElementById("superManualRoleSelect")?.value);

  if (oldRole === nextRole) {
    showNotification(`${selectedSuperManualStudent.name} is already ${formatStudentRole(nextRole)}.`, "info");
    return;
  }

  const { error } = await supabaseClient
    .from("student_info")
    .update({ role: nextRole })
    .eq("idstudent_info", selectedSuperManualStudent.idstudent_info);

  if (error) {
    console.error("Failed to update student role:", error);
    showNotification("Failed to update role.", "error");
    return;
  }

  await logSuperManualAudit({
    action: "role_update",
    studentInternalId: selectedSuperManualStudent.idstudent_info,
    studentId: selectedSuperManualStudent.student_id,
    studentName: selectedSuperManualStudent.name,
    oldRole,
    newRole: nextRole,
  });

  selectedSuperManualStudent.role = nextRole;
  invalidateFilterOptionsCache({ students: true });
  showNotification(`Role updated to ${formatStudentRole(nextRole)}.`, "success");
  searchSuperManualStudents();
  if (sectionLoadState.students) loadStudents(studentsCurrentPage);
}

async function updateSuperManualAttendance(eventId, status) {
  if (!selectedSuperManualStudent) {
    showNotification("Select a student first.", "warning");
    return;
  }

  const allowedStatuses = ["present", "late", "absent"];
  if (!allowedStatuses.includes(status)) return;

  const event = superManualEventsCache.find((item) => Number(item.idevent_info) === Number(eventId));
  if (!event) {
    showNotification("Event not found. Reload the student details.", "error");
    return;
  }

  const label = status === "present" ? "Present" : status === "late" ? "Late" : "Absent";
  pendingSuperManualAttendanceUpdate = { eventId: Number(eventId), status };
  const message = document.getElementById("superManualConfirmMessage");
  if (message) {
    message.textContent = `Mark ${selectedSuperManualStudent.name} (${selectedSuperManualStudent.student_id}) as ${label} for "${event.event_name}"?`;
  }
  openModal("superManualConfirmModal");
}

function closeSuperManualConfirmModal() {
  pendingSuperManualAttendanceUpdate = null;
  closeModal("superManualConfirmModal");
}

async function confirmSuperManualAttendanceUpdate() {
  if (!pendingSuperManualAttendanceUpdate || !selectedSuperManualStudent) {
    closeSuperManualConfirmModal();
    return;
  }

  const { eventId, status } = pendingSuperManualAttendanceUpdate;
  const event = superManualEventsCache.find((item) => Number(item.idevent_info) === Number(eventId));
  if (!event) {
    closeSuperManualConfirmModal();
    showNotification("Event not found. Reload the student details.", "error");
    return;
  }

  const label = status === "present" ? "Present" : status === "late" ? "Late" : "Absent";
  closeModal("superManualConfirmModal");
  pendingSuperManualAttendanceUpdate = null;

  const { date: phDate, time: phTime } = getPhilippinesDateTimeParts();
  const recordDate = event.date || phDate;
  const recordTime = status === "absent" ? "23:59:00" : phTime;

  try {
    const { data: existingAttendance, error: findError } = await supabaseClient
      .from("attendance")
      .select("idattendance, status, scan_time, date")
      .eq("student_id", selectedSuperManualStudent.idstudent_info)
      .eq("event_id", Number(eventId))
      .maybeSingle();

    if (findError) throw findError;

    const oldAttendanceStatus = existingAttendance?.status || "missing";
    const oldSanctions = await getSuperManualSanctionsForEvent(
      selectedSuperManualStudent.idstudent_info,
      event.event_name,
      eventId
    );

    const attendancePayload = {
      student_id: selectedSuperManualStudent.idstudent_info,
      event_id: Number(eventId),
      status,
      scan_time: recordTime,
      date: recordDate,
      student_name_cached: selectedSuperManualStudent.name,
      student_school_id_cached: selectedSuperManualStudent.student_id,
    };

    if (existingAttendance) {
      const { error: updateError } = await supabaseClient
        .from("attendance")
        .update(attendancePayload)
        .eq("idattendance", existingAttendance.idattendance);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabaseClient
        .from("attendance")
        .insert(attendancePayload);
      if (insertError) throw insertError;
    }

    const sanctionIdsToDelete = oldSanctions.map((sanction) => sanction.id);

    if (sanctionIdsToDelete.length) {
      const { error: deleteError } = await supabaseClient
        .from("sanctions")
        .delete()
        .in("id", sanctionIdsToDelete);
      if (deleteError) throw deleteError;
    }

    if (status === "late" || status === "absent") {
      const { error: sanctionInsertError } = await supabaseClient
        .from("sanctions")
        .insert({
          idstudent_info: selectedSuperManualStudent.idstudent_info,
          student_id: selectedSuperManualStudent.student_id,
          student_name: selectedSuperManualStudent.name,
          event_id: Number(eventId),
          event_name: event.event_name,
          penalty: status === "late" ? "Late" : "Absent",
          fee: status === "late" ? 500 : 1500,
          date_given: recordDate,
          status: "pending",
        });
      if (sanctionInsertError) throw sanctionInsertError;
    }

    const newSanctions = await getSuperManualSanctionsForEvent(
      selectedSuperManualStudent.idstudent_info,
      event.event_name,
      eventId
    );

    await logSuperManualAudit({
      action: "attendance_correction",
      studentInternalId: selectedSuperManualStudent.idstudent_info,
      studentId: selectedSuperManualStudent.student_id,
      studentName: selectedSuperManualStudent.name,
      eventId: Number(eventId),
      eventName: event.event_name,
      oldAttendanceStatus,
      newAttendanceStatus: status,
      oldSanctionState: normalizeAuditSanctions(oldSanctions),
      newSanctionState: normalizeAuditSanctions(newSanctions),
    });

    showNotification(`${selectedSuperManualStudent.name} marked as ${label} for this event.`, "success");
    await loadSuperManualEventRecords();
    if (sectionLoadState.sanctions && typeof fetchSanctions === "function") fetchSanctions(sanctionCurrentPage);
    if (sectionLoadState.attendance && typeof filterAttendance === "function") filterAttendance(attendanceCurrentPage);
  } catch (err) {
    console.error("Super manual attendance update failed:", err);
    showNotification("Failed to update attendance/sanction. Check console.", "error");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const superManualSearchInput = document.getElementById("superManualSearchInput");
  if (superManualSearchInput) {
    superManualSearchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        searchSuperManualStudents();
      }
    });
  }
});

// ================= Dashboard Logic =================

// Populate event dropdown for dashboard
async function loadDashboardEvents() {
  try {
    const events = await getCachedEvents();
    const filter = document.getElementById("dashboardEventFilter");
    if (!filter) return;

    filter.innerHTML = `<option value="">Select Event</option>`;
    events.forEach((event) => {
      const opt = document.createElement("option");
      opt.value = event.idevent_info;
      opt.textContent = `${event.event_name} (${event.status})`;
      filter.appendChild(opt);
    });
  } catch (error) {
    console.error("Error fetching events for dashboard:", error);
  }
  return;

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

// Handle dashboard event change (only on AdminPage)
const dashboardEventFilter = document.getElementById("dashboardEventFilter");
if (dashboardEventFilter) {
  dashboardEventFilter.addEventListener("change", async (e) => {
    const eventId = e.target.value;
    if (!eventId) {
      resetDashboard();
      return;
    }
    await loadDashboardStats(eventId);
    await loadRecentActivity(eventId);
  });
}

// Reset stats when no event selected
function resetDashboard() {
  document.getElementById("statTotalStudents").textContent = "0";
  document.getElementById("activeEventsInfo").textContent = "Ongoing: 0 | Upcoming: 0";
  document.getElementById("statAttendance").textContent = "0";
  document.getElementById("lateAbsentInfo").textContent = "Late: 0 | Absent: 0";
  document.getElementById("statTotalRecorded").textContent = "0";
  document.getElementById("statMissing").textContent = "0";
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
    const { count: totalStudents } = await supabaseClient
      .from("student_info")
      .select("*", { count: "exact", head: true })
      .eq("role", "student");

    document.getElementById("statTotalStudents").textContent = totalStudents ?? 0;

    const events = await getCachedEvents();
    const ongoing = events.filter(
      (ev) => ev.status?.toLowerCase() === "ongoing" && ev.closed === false
    ).length;
    const upcoming = events.filter(
      (ev) => ev.status?.toLowerCase() === "upcoming" && ev.closed === false
    ).length;
    document.getElementById("activeEventsInfo").textContent =
      `Ongoing: ${ongoing} | Upcoming: ${upcoming}`;

    const [presentResult, lateResult, absentResult] = await Promise.all([
      supabaseClient
        .from("attendance")
        .select("*", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("status", "present"),
      supabaseClient
        .from("attendance")
        .select("*", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("status", "late"),
      supabaseClient
        .from("attendance")
        .select("*", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("status", "absent"),
    ]);

    const presentCount = presentResult.count ?? 0;
    const lateCount = lateResult.count ?? 0;
    const absentCount = absentResult.count ?? 0;
    const totalRecorded = presentCount + lateCount + absentCount;
    const missingCount = Math.max((totalStudents ?? 0) - totalRecorded, 0);

    document.getElementById("statAttendance").textContent = presentCount;
    document.getElementById("lateAbsentInfo").textContent =
      `Late: ${lateCount} | Absent: ${absentCount}`;
    document.getElementById("statTotalRecorded").textContent = totalRecorded;
    document.getElementById("statMissing").textContent = missingCount;
  } catch (err) {
    console.error("loadDashboardStats failed:", err);
  } finally {
    if (loader) loader.classList.remove("active");
  }
  return;
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
    document.getElementById("statAttendance").textContent = presentCount ?? 0;

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
  const role = document.getElementById("attendanceRoleFilter")?.value || "";
  const searchValue = document.getElementById("searchInput")?.value?.trim().toLowerCase() || "";

  filterAttendance(newPage, yearLevel, section, role, searchValue);
}




async function exportAttendanceCSV() {
  const eventId = document.getElementById("eventFilter")?.value || "";
  const yearLevel = document.getElementById("attendanceYearFilter")?.value || "";
  const section = document.getElementById("sectionFilter")?.value || "";
  const role = document.getElementById("attendanceRoleFilter")?.value || "";
  try {
    if (!eventId) {
      showNotification("⚠️ Please select an event first.", "warning");
      return;
    }

    // ✅ Get readable names for filename
    const eventSelect = document.getElementById("eventFilter");
    const eventName =
      eventSelect && eventSelect.selectedIndex > 0
        ? eventSelect.options[eventSelect.selectedIndex].text
        : "Selected Event";

    const roleName = role ? formatStudentRole(role) : "";

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
            role
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
      showNotification("❌ No attendance records found.", "error");
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

    if (role) {
      filtered = filtered.filter(
        att => normalizeStudentRole(att.student_info?.role) === role
      );
    }

    if (!filtered.length) {
      showNotification("❌ No attendance data for selected filters.", "error");
      return;
    }

    // ✅ Sort alphabetically by student name
    filtered.sort((a, b) =>
      (a.student_info?.name || "").localeCompare(b.student_info?.name || "")
    );

    // ✅ Build CSV header
    let csv = "Student ID,Name,Year Level,Section,Role,Event,Time,Status\n";

    // ✅ Add CSV rows
    filtered.forEach(row => {
      const student = row.student_info || {};
      const studentRole = formatStudentRole(student.role);
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
        `"${studentRole}",` +
        `"${row.event_info?.event_name ?? "-"}",` +
        `"${formattedTime}",` +
        `"${row.status ?? "-"}"\n`;
    });

    // ✅ Build filename with Year Level, Role, Section, and Date
    const dateStr = new Date().toISOString().split("T")[0];
    const safeFilePart = (value, fallback) =>
      String(value || fallback)
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/\s+/g, "_")
        .slice(0, 80);

    let fileName = "Attendance";
    fileName += `-${safeFilePart(eventName, "AllEvents")}`;
    fileName += `-${safeFilePart(yearLevel, "AllYears")}`;
    fileName += `-${safeFilePart(roleName, "AllRoles")}`;
    fileName += `-${safeFilePart(section ? `Section${section}` : "", "AllSections")}`;
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
    showNotification("❌ Failed to export attendance.", "error");
    showNotification("❌ Failed to export attendance.", "error");
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
      .in("status", ["present", "late"])
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
      table.innerHTML = `<tr><td colspan="6">No recent scans found for this event.</td></tr>`;
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
          <td>${escapeHTML(att.date)}</td>
          <td>${formattedTime}</td>
          <td>${escapeHTML(att.student_info?.name || "Unknown")}</td>
          <td>${escapeHTML(att.student_info?.year_level || "-")}</td>
          <td>${escapeHTML(att.student_info?.section || "-")}</td>
          <td><span class="status-badge ${escapeHTML(att.status)}">${escapeHTML(att.status)}</span></td>
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
    const { sections } = await getCachedStudentMeta();
    populateSelectOptions("sanctionSectionFilter", "All Sections", sections);
  } catch (err) {
    console.error("Error loading sections for sanctions:", err);
  }
  return;

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

async function loadSanctionEventFilter() {
  try {
    const data = await getCachedEvents();
    const eventFilter = document.getElementById("sanctionEventFilter");
    if (!eventFilter) return;

    eventFilter.innerHTML = `<option value="">Select Event</option>`;
    [...data]
      .sort((a, b) => String(a.event_name || "").localeCompare(String(b.event_name || "")))
      .forEach(ev => {
        const opt = document.createElement("option");
        opt.value = ev.idevent_info;
        opt.dataset.eventName = ev.event_name;
        opt.textContent = ev.event_name;
        eventFilter.appendChild(opt);
      });
  } catch (err) {
    console.error("Error loading sanction events:", err);
  }
  return;

  try {
    const { data, error } = await supabaseClient
      .from("event_info")
      .select("idevent_info, event_name")
      .order("event_name", { ascending: true });

    if (error) throw error;

    const eventFilter = document.getElementById("sanctionEventFilter");
    if (!eventFilter) return;

    eventFilter.innerHTML = `<option value="">Select Event</option>`;
    data.forEach(ev => {
      const opt = document.createElement("option");
      opt.value = ev.idevent_info;
      opt.dataset.eventName = ev.event_name;
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
      <td>${escapeHTML(student.student_id)}</td>
        <td>${escapeHTML(student.name)}</td>
        <td>${escapeHTML(student.year_level)}</td>
        <td>${escapeHTML(student.section)}</td>
        <td>
          <div class="password-cell">
            <span class="masked-password" data-password="${escapeHTML(student.password || '')}">••••••••</span>
            <button type="button" class="password-toggle-btn" onclick="togglePasswordRow(this)">
              <i class="fas fa-eye"></i>
            </button>
          </div>
        </td>
        <td>${escapeHTML(formatStudentRole(student.role))}</td>

        <td>
          <span class="status-badge ${student.status === "active" ? "present" : "inactive"}">
            ${escapeHTML(student.status)}
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
  try {
    const { sections } = await getCachedStudentMeta();
    populateSelectOptions("studentSectionFilter", "All Sections", sections);
  } catch (err) {
    console.error("Error loading sections:", err);
  }
  return;

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


async function populateAttendanceFilters() {
  try {
    const { sections } = await getCachedStudentMeta();
    populateSelectOptions("sectionFilter", "All Sections", sections);
  } catch (err) {
    console.error("Error loading attendance sections:", err);
  }
  return;

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
        sectionFilter.innerHTML += `<option value="${escapeHTML(sec)}">${escapeHTML(sec)}</option>`;
      });
    }
  }
}


async function populateAttendanceYearFilter() {
  try {
    const { years } = await getCachedStudentMeta();
    populateSelectOptions("attendanceYearFilter", "All Year Levels", years);
  } catch (err) {
    console.error("Failed to populate year levels:", err);
  }
  return;

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
      dropdown.innerHTML += `<option value="${escapeHTML(y)}">${escapeHTML(y)}</option>`;
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
    const session = await getValidAdminSession();
    if (!session) {
      alert("⚠️ Session expired. Please log in again.");
      window.location.href = "index.html";
      return;
    }

    // ✅ Fetch the admin's stored password and username
    // ✅ Re-authenticate admin via Supabase Auth (no plain-text password fetch)
    const { error: reAuthError } = await supabaseClient.auth.signInWithPassword({
      email: session.user.email,
      password: enteredPassword,
    });

    // Fetch admin username for logging
    const { data: admin } = await supabaseClient
      .from("admin_info")
      .select("admin_username")
      .eq("auth_id", session.user.id)
      .single();

    const adminUsername = admin?.admin_username || "unknown";

    if (!reAuthError) {
      // Log successful access
      await logSanctionAccess(session.user.id, adminUsername, "granted");

      sanctionAccessGranted = true;
      closeModal("sanctionPasswordModal");
      passwordInput.value = "";
      errorDiv.style.display = "none";

      const targetSection = pendingProtectedSection || "sanctions";
      activateAdminSection(targetSection);
      await loadSectionData(targetSection);
    } else {
      // Log failed access
      await logSanctionAccess(session.user.id, adminUsername, "denied");

      errorDiv.style.display = "block";
      passwordInput.value = "";
      passwordInput.focus();
    }
  } catch (err) {
    console.error("Error verifying sanction password:", err);
    showNotification("⚠️ An unexpected error occurred. Please try again.", "error");
  }
}


// Cancel sanction access
function cancelSanctionAccess() {
  closeModal("sanctionPasswordModal");
  document.getElementById("sanctionPasswordInput").value = "";
  document.getElementById("sanctionPasswordError").style.display = "none";

  // Stay on current section or go to dashboard
  const currentActive = document.querySelector(".nav-link.active");
  if (!currentActive || currentActive.dataset.section === "sanctions" || currentActive.dataset.section === "superManual") {
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
  const logoutModal = document.getElementById("logoutModal");
  logoutModal.classList.add("show");
}

function cancelLogout() {
  const logoutModal = document.getElementById("logoutModal");
  logoutModal.classList.remove("show");
}

async function confirmLogoutAction() {
  const logoutModal = document.getElementById("logoutModal");
  logoutModal.classList.remove("show");

  try {
    sanctionAccessGranted = false; // Reset access flag

    const { error } = await supabaseClient.auth.signOut();
    if (error) {
      console.error("Logout failed:", error);
      showNotification("Failed to log out.", "error");
      return;
    }

    showNotification("Logged out successfully.", "success");
    setTimeout(() => {
      window.location.href = "index.html";
    }, 1000);
  } catch (err) {
    console.error("Unexpected error during logout:", err);
    showNotification("Something went wrong while logging out.", "error");
  }
}


const searchInput2 = document.getElementById("searchInput");
if (searchInput2) {
  searchInput2.addEventListener("input", () => {
    const currentPage = document.getElementById("pageTitle")?.textContent.trim().toLowerCase();

    if (currentPage === "students") {
      filterStudents(1); // Reset to page 1 when searching
    } else if (currentPage === "attendance") {
      filterAttendance(1); // Reset to page 1 when searching
    } else if (currentPage === "sanctions") {
      fetchSanctions(1); // ✅ Refresh sanctions immediately as you type
    }
  });
}



function switchPage(newPageTitle) {
  document.getElementById("pageTitle").textContent = newPageTitle;
  document.getElementById("searchInput").value = ""; // clear search input
}

async function loadYearLevels() {
  try {
    const { years } = await getCachedStudentMeta();
    populateSelectOptions("studentYearFilter", "All Year Levels", years);
  } catch (err) {
    console.error("Error loading year levels:", err);
  }
  return;

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
      yearSelect.innerHTML += `<option value="${escapeHTML(year)}">${escapeHTML(year)}</option>`;
    });
  } catch (err) {
    console.error("❌ Error loading year levels:", err);
  }
}

