// Toggle sidebar for mobile view
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

// Navigation section switching
const navLinks = document.querySelectorAll('.nav-link');
const contentSections = document.querySelectorAll('.content-section');

navLinks.forEach(link => {
  link.addEventListener('click', function () {
    // Remove 'active' from all links and sections
    navLinks.forEach(l => l.classList.remove('active'));
    contentSections.forEach(section => section.classList.remove('active'));

    // Add 'active' to clicked link
    this.classList.add('active');

    // Show the matching section
    const sectionId = this.getAttribute('data-section');
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
      targetSection.classList.add('active');
      document.getElementById('pageTitle').textContent = this.querySelector('span').textContent;
    }
  });
});

// Show notifications (for bell icon)
function showNotifications() {
  alert("You have 3 new notifications.");
}

// Dummy logout function
function logout() {
  alert("Logging out...");
  // Redirect to login.html if needed
  // window.location.href = 'login.html';
}

// FIXED: Modal functions with proper content clearing
function openModal(id) {
  // Clear all modal content first
  clearModalContent();
  
  // Show the modal
  document.getElementById(id).style.display = 'flex';
  
  // Load specific content based on modal type
  loadModalContent(id);
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
  // Clear content when closing
  clearModalContent();
}

// NEW: Function to clear modal content
function clearModalContent() {
  // Hide all modal-specific content sections
  const modalSections = document.querySelectorAll('.modal-section');
  modalSections.forEach(section => {
    section.style.display = 'none';
  });
  
  // Clear any dynamic content
  const dynamicContent = document.querySelector('.modal-dynamic-content');
  if (dynamicContent) {
    dynamicContent.innerHTML = '';
  }
}

// NEW: Function to load specific modal content
function loadModalContent(modalId) {
  const modal = document.getElementById(modalId);
  
  switch(modalId) {
    case 'studentModal':
      loadStudentModalContent(modal);
      break;
    case 'eventModal':
      loadEventModalContent(modal);
      break;
    case 'paymentModal':
      loadPaymentModalContent(modal);
      break;
    case 'settingsModal':
      loadSettingsModalContent(modal);
      break;
    default:
      loadDefaultModalContent(modal);
  }
}

// NEW: Content loading functions for different modal types
function loadStudentModalContent(modal) {
  // Show only student-related fields
  const studentFields = modal.querySelector('.student-fields');
  if (studentFields) {
    studentFields.style.display = 'block';
  }
  
  // Hide settings-specific fields
  const settingsFields = modal.querySelector('.settings-fields');
  if (settingsFields) {
    settingsFields.style.display = 'none';
  }
}

function loadEventModalContent(modal) {
  // Show only event-related fields
  const eventFields = modal.querySelector('.event-fields');
  if (eventFields) {
    eventFields.style.display = 'block';
  }
  
  // Hide other fields
  const settingsFields = modal.querySelector('.settings-fields');
  if (settingsFields) {
    settingsFields.style.display = 'none';
  }
}

function loadPaymentModalContent(modal) {
  // Show only payment-related fields
  const paymentFields = modal.querySelector('.payment-fields');
  if (paymentFields) {
    paymentFields.style.display = 'block';
  }
  
  // Hide other fields
  const settingsFields = modal.querySelector('.settings-fields');
  if (settingsFields) {
    settingsFields.style.display = 'none';
  }
}

function loadSettingsModalContent(modal) {
  // Show only settings-related fields (like Attendance Timeout)
  const settingsFields = modal.querySelector('.settings-fields');
  if (settingsFields) {
    settingsFields.style.display = 'block';
  }
  
  // Hide other fields
  const studentFields = modal.querySelector('.student-fields');
  if (studentFields) {
    studentFields.style.display = 'none';
  }
}

function loadDefaultModalContent(modal) {
  // Hide all specific field sections
  const allFieldSections = modal.querySelectorAll('.modal-section');
  allFieldSections.forEach(section => {
    section.style.display = 'none';
  });
}

// Placeholder functions for button actions
function addStudent() {
  
  openModal('studentModal');
}

function importStudents() {
  alert("Importing student CSV...");
}

function exportAttendance() {
  alert("Exporting attendance data...");
}

function refreshAttendance() {
  alert("Refreshing attendance list...");
}

function createEvent() {
  openModal('eventModal');
}

function viewEvent(id) {
  alert(`Viewing event details for: ${id}`);
}




function generateReport() {
  alert("Generating report...");
}

function viewReport(type) {
  alert(`Viewing ${type} report...`);
}



function viewStudent(id) {
  alert(`Viewing student profile: ${id}`);
}

function deleteStudent(id) {
  if (confirm(`Are you sure you want to delete student ${id}?`)) {
    alert(`Student ${id} deleted.`);
  }
}

// NEW: Function to open settings modal specifically
function openSettings() {
  openModal('settingsModal');
}