// ✅ Supabase client initialization (with proper auth config)
const SUPABASE_URL = "https://ofrngrggkgtfnfdlbmum.supabase.co";
const SUPABASE_PROJECT_REF = "ofrngrggkgtfnfdlbmum";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mcm5ncmdna2d0Zm5mZGxibXVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3ODYxOTYsImV4cCI6MjA3MjM2MjE5Nn0.qgYkiUmesBQCoSUkrLhMuCmO2IxDSahQUZPKHhUGjnE";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,        // ✅ keeps user logged in after refresh
    autoRefreshToken: true,      // ✅ automatically refreshes expired tokens
    detectSessionInUrl: true,    // ✅ detects session tokens from redirects
  },
});


// ✅ Role selection toggle
document.querySelectorAll('.role-option').forEach(option => {
  option.addEventListener('click', function() {
    document.querySelectorAll('.role-option').forEach(opt => opt.classList.remove('active'));
    this.classList.add('active');

    const role = this.dataset.role;
    const usernameLabel = document.querySelector("label[for='username']");
    const usernameInput = document.getElementById("username");

    if (role === "student") {
      usernameLabel.textContent = "Student ID";
      usernameInput.placeholder = "Enter your Student ID";
    } else {
      usernameLabel.textContent = "Admin Email";
      usernameInput.placeholder = "Enter Admin Email";
    }
  });
});

// ✅ Toggle password visibility
document.getElementById("togglePassword").addEventListener("click", () => {
  const passwordInput = document.getElementById("password");
  const toggleIcon = document.getElementById("passwordToggleIcon");
  if (passwordInput.type === "password") {
    passwordInput.type = "text";
    toggleIcon.classList.replace("fa-eye", "fa-eye-slash");
  } else {
    passwordInput.type = "password";
    toggleIcon.classList.replace("fa-eye-slash", "fa-eye");
  }
});

// ✅ Show error message
function showError(message) {
  const errorDiv = document.getElementById("errorMessage");
  const errorText = document.getElementById("errorText");
  errorText.textContent = message;
  errorDiv.style.display = "block";
  setTimeout(() => (errorDiv.style.display = "none"), 5000);
}

// ✅ Loading state
function setLoading(isLoading) {
  const loginBtn = document.getElementById("loginBtn");
  const btnLoading = document.getElementById("btnLoading");
  const btnText = document.getElementById("btnText");

  if (isLoading) {
    loginBtn.disabled = true;
    btnLoading.style.display = "inline-block";
    btnText.textContent = "Signing in...";
  } else {
    loginBtn.disabled = false;
    btnLoading.style.display = "none";
    btnText.textContent = "Sign In";
  }
}

// ✅ Login form submit
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();
  const role = document.querySelector(".role-option.active").dataset.role;

  if (!username || !password) {
    showError("Please fill in all fields");
    return;
  }

  setLoading(true);

  try {
    if (role === "student") {
      // 🎓 Student login — lookup from student_info
      const maintenanceEnabled = await isStudentMaintenanceEnabled();
      if (maintenanceEnabled) {
        showError("Student portal is temporarily unavailable for maintenance. Please try again later.");
        return;
      }

      const { data, error } = await supabaseClient
        .from("student_info")
        .select("idstudent_info, student_id, name, password")
        .eq("student_id", username)
        .single();

      if (error || !data) {
        showError("Invalid student ID or password");
        return;
      }

      if (password === data.password) {
        // ✅ Store student ID in localStorage for StudentPage to access
        localStorage.setItem("studentId", data.student_id);
        window.location.href = "StudentPage.html";
      } else {
        showError("Invalid student ID or password");
      }

    } else {
      // 👨‍💼 Admin login (Supabase Auth)
      const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
        email: username,
        password: password
      });

      if (authError || !authData.user) {
        showError("Invalid admin email or password");
      } else {
        // 🔎 Fetch admin_info record linked to this Auth user
        const { data: adminInfo, error: adminError } = await supabaseClient
          .from("admin_info")
          .select("admin_username")
          .eq("auth_id", authData.user.id)
          .single();

        if (adminError || !adminInfo) {
          showError("Admin profile not found");
        } else {
          window.location.href = `AdminPage.html?admin_username=${encodeURIComponent(adminInfo.admin_username)}`;
        }
      }
    }
  } catch (err) {
    console.error("❌ Login failed:", err);
    showError("Login error. Please try again.");
  } finally {
    setLoading(false);
  }
});

function clearSupabaseAuthStorage() {
  const prefix = `sb-${SUPABASE_PROJECT_REF}-`;

  Object.keys(localStorage)
    .filter((key) => key.startsWith(prefix))
    .forEach((key) => localStorage.removeItem(key));
}

const STUDENT_MAINTENANCE_KEY = "student_maintenance";
const FORCE_LOGOUT_VERSION_KEY = "force_logout_version";
const LOCAL_FORCE_LOGOUT_VERSION_KEY = "edutag_force_logout_version";

async function getSystemSettingValue(key) {
  const { data, error } = await supabaseClient
    .from("system_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();

  if (error) throw error;
  return data?.value ?? null;
}

async function isStudentMaintenanceEnabled() {
  try {
    const value = await getSystemSettingValue(STUDENT_MAINTENANCE_KEY);
    return String(value || "").toLowerCase() === "true";
  } catch (error) {
    console.warn("Student maintenance check failed:", error);
    return false;
  }
}

async function enforceForceLogoutVersion() {
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
    showError("EduTag was updated. Please sign in again.");
    return true;
  } catch (error) {
    console.warn("Force logout version check failed:", error);
    return false;
  }
}

function isInvalidRefreshTokenError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("invalid refresh token") ||
    message.includes("refresh token not found")
  );
}

async function resetBrokenAuthSession() {
  clearSupabaseAuthStorage();

  try {
    await supabaseClient.auth.signOut({ scope: "local" });
  } catch (signOutError) {
    console.warn("Failed to clear local Supabase session:", signOutError);
  }
}

async function warmUpSupabaseSession() {
  try {
    const forceLoggedOut = await enforceForceLogoutVersion();
    if (forceLoggedOut) return;

    const { error } = await supabaseClient.auth.getSession();
    if (isInvalidRefreshTokenError(error)) {
      await resetBrokenAuthSession();
    }
  } catch (error) {
    if (isInvalidRefreshTokenError(error)) {
      await resetBrokenAuthSession();
    }
  }
}

warmUpSupabaseSession();
