// ✅ Supabase client initialization
const SUPABASE_URL = "https://ofrngrggkgtfnfdlbmum.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mcm5ncmdna2d0Zm5mZGxibXVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3ODYxOTYsImV4cCI6MjA3MjM2MjE5Nn0.qgYkiUmesBQCoSUkrLhMuCmO2IxDSahQUZPKHhUGjnE";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ✅ Role selection toggle
document.querySelectorAll('.role-option').forEach(option => {
  option.addEventListener('click', function() {
    document.querySelectorAll('.role-option').forEach(opt => opt.classList.remove('active'));
    this.classList.add('active');
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
      // Check student_info
      const { data, error } = await supabaseClient
        .from("student_info")
        .select("student_id, password")
        .eq("student_id", username)
        .eq("password", password)
        .single();

      if (error || !data) {
        showError("Invalid student ID or password");
      } else {
        window.location.href = `StudentPage.html?student_id=${encodeURIComponent(data.student_id)}`;
      }

    } else {
      // Check admin_info
      const { data, error } = await supabaseClient
        .from("admin_info")
        .select("admin_username, password")
        .eq("admin_username", username)
        .eq("password", password)
        .single();

      if (error || !data) {
        showError("Invalid admin username or password");
      } else {
        window.location.href = `AdminPage.html?admin_username=${encodeURIComponent(data.admin_username)}`;
      }
    }
  } catch (err) {
    console.error("❌ Login failed:", err);
    showError("Login error. Please try again.");
  } finally {
    setLoading(false);
  }
});
