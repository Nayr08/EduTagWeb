# EduTag - Student Attendance Management System

A web-based application for managing student attendance using RFID technology and NFC devices.

## Project Overview

This project demonstrates:
- Full-stack web development with HTML, CSS, and JavaScript
- Real-time database integration with Supabase
- Admin and student interface management
- RFID/NFC attendance tracking
- CSV data export functionality

## Setup Instructions

### 1. Get Supabase Credentials
- Go to [Supabase](https://supabase.com)
- Create a new project or use existing one
- Navigate to Settings → API Keys
- Copy your `SUPABASE_URL` and `SUPABASE_ANON_KEY`

### 2. Add Credentials
- Copy `supabase.example.js` to `supabase.js`
- Replace `YOUR_SUPABASE_URL_HERE` and `YOUR_SUPABASE_ANON_KEY_HERE` with your actual credentials

### 3. Install Dependencies
```bash
npm install
```

## Project Structure

- `AdminPage.html` - Admin dashboard
- `StudentPage.html` - Student interface
- `index.html` - Login page
- `admin-scripts.js` - Admin functionality
- `student.js` - Student functionality
- `login.js` - Authentication logic
- `supabase.js` - Database client configuration

## Key Features

- Student management and registration
- Attendance tracking via RFID/NFC
- Real-time data synchronization
- CSV export for reports
- Role-based access (Admin/Student)

## Security Notes

⚠️ **Important:** Never commit API keys or credentials to GitHub. Use environment variables in production.

## License

For OJT purposes - Educational use only
